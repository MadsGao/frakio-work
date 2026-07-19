import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const officialRepo = 'https://github.com/NousResearch/hermes-agent.git';
const bridgeProtocolVersion = 2;
const pythonVersion = process.env.FRAKIO_PYTHON_VERSION || '3.12.12';
const nodeVersion = process.env.FRAKIO_NODE_VERSION || '24.16.0';
const pinnedHermesTag = process.env.HERMES_AGENT_TAG || 'v2026.7.7.2';
const aiohttpVersion = '3.14.1';

function platformName() {
  if (process.platform !== 'darwin') throw new Error('Bundled desktop runtimes are built on macOS runners.');
  return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
}

function nodePlatformName() {
  return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
}

async function command(commandName, args, options = {}) {
  const { stdout = '', stderr = '' } = await execFileAsync(commandName, args, {
    timeout: options.timeout || 30 * 60 * 1000,
    maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.log(stderr.trim());
  return stdout.trim();
}

async function download(url, destination) {
  await command('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', destination, url], { timeout: 10 * 60 * 1000 });
}

async function sha256(filePath) {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error('Unable to allocate a Runtime API self-test port.');
  return port;
}

async function verifyRuntimeApi(python, pythonRoot) {
  const selfTestHome = await mkdtemp(path.join(os.tmpdir(), 'frakio-runtime-self-test-'));
  const port = await freePort();
  const apiKey = `frakio_self_test_${randomUUID().replaceAll('-', '')}`;
  await writeFile(path.join(selfTestHome, 'config.yaml'), '{}\n', 'utf8');
  await writeFile(path.join(selfTestHome, '.env'), `API_SERVER_KEY=${apiKey}\n`, { encoding: 'utf8', mode: 0o600 });
  const child = spawn(python, ['-m', 'hermes_cli.main', 'gateway', 'run', '--replace', '--force'], {
    cwd: selfTestHome,
    env: {
      ...process.env,
      HERMES_HOME: selfTestHome,
      HERMES_AGENT_ROOT: pythonRoot,
      API_SERVER_ENABLED: 'true',
      API_SERVER_HOST: '127.0.0.1',
      API_SERVER_PORT: String(port),
      API_SERVER_KEY: apiKey,
      GATEWAY_ALLOW_ALL_USERS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    const deadline = Date.now() + 30_000;
    let response = null;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(1200),
        });
        if (response.ok) break;
      } catch {
        // The gateway needs a few seconds to initialize on clean CI runners.
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (!response?.ok) throw new Error(`Runtime API self-test failed (exit=${child.exitCode ?? 'running'}). ${(stderr || stdout).slice(-1200)}`);
    await response.json();
    console.log(`Runtime API self-test passed on 127.0.0.1:${port}.`);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await rm(selfTestHome, { recursive: true, force: true });
  }
}

async function installPortablePython(staging) {
  await command('uv', ['python', 'install', pythonVersion], { timeout: 15 * 60 * 1000 });
  const executable = await command('uv', ['python', 'find', pythonVersion, '--managed-python']);
  const sourceRoot = path.dirname(path.dirname(executable));
  const destination = path.join(staging, 'python');
  await cp(sourceRoot, destination, { recursive: true, dereference: true, preserveTimestamps: true });
  await unlink(path.join(destination, 'lib', `python${pythonVersion.split('.').slice(0, 2).join('.')}`, 'EXTERNALLY-MANAGED')).catch(() => null);
  const bin = path.join(destination, 'bin');
  const versionedName = `python${pythonVersion.split('.').slice(0, 2).join('.')}`;
  for (const name of ['python', 'python3']) {
    await unlink(path.join(bin, name)).catch(() => null);
    await symlink(versionedName, path.join(bin, name));
  }
  return path.join(bin, 'python3');
}

async function installPortableNode(staging, downloadsRoot) {
  const platform = nodePlatformName();
  const archiveName = `node-v${nodeVersion}-${platform}.tar.gz`;
  const baseUrl = `https://nodejs.org/dist/v${nodeVersion}`;
  const archivePath = path.join(downloadsRoot, archiveName);
  const checksumsPath = path.join(downloadsRoot, 'SHASUMS256.txt');
  await Promise.all([download(`${baseUrl}/${archiveName}`, archivePath), download(`${baseUrl}/SHASUMS256.txt`, checksumsPath)]);
  const expected = (await readFile(checksumsPath, 'utf8')).split('\n').find((line) => line.trim().endsWith(`  ${archiveName}`))?.trim().split(/\s+/)[0];
  if (!expected) throw new Error(`Node checksum is missing for ${archiveName}.`);
  const actual = await sha256(archivePath);
  if (actual !== expected) throw new Error(`Node checksum mismatch for ${archiveName}.`);
  const extracted = path.join(downloadsRoot, `node-v${nodeVersion}-${platform}`);
  await command('tar', ['-xzf', archivePath, '-C', downloadsRoot]);
  await cp(extracted, path.join(staging, 'node'), { recursive: true, dereference: true, preserveTimestamps: true });
}

async function checkoutHermes(sourceDir) {
  try {
    await command('git', ['-C', sourceDir, 'rev-parse', '--is-inside-work-tree'], { timeout: 5000 });
    await command('git', ['-C', sourceDir, 'fetch', 'origin', '--tags', '--prune'], { timeout: 4 * 60 * 1000 });
  } catch {
    await rm(sourceDir, { recursive: true, force: true });
    await command('git', ['clone', '--filter=blob:none', '--no-checkout', officialRepo, sourceDir], { timeout: 4 * 60 * 1000 });
  }
  await command('git', ['-C', sourceDir, 'checkout', '--detach', '--force', pinnedHermesTag], { timeout: 2 * 60 * 1000 });
  return command('git', ['-C', sourceDir, 'rev-parse', 'HEAD']);
}

async function rewritePythonEntrypoints(runtimeDir) {
  const bin = path.join(runtimeDir, 'python', 'bin');
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(bin, { withFileTypes: true });
  const launcher = `#!/bin/sh\n'''exec' "$(dirname "$0")/python3" "$0" "$@"\n' '''`;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(bin, entry.name);
    const raw = await readFile(filePath, 'utf8').catch(() => '');
    if (!raw.startsWith('#!')) continue;
    let next = raw;
    if (raw.startsWith("#!/bin/sh\n'''exec' ")) next = raw.replace(/^#!\/bin\/sh\n'''exec' [^\n]+\n' '''/, launcher);
    else if (/^#![^\n]*python[^\n]*\n/.test(raw)) next = raw.replace(/^#![^\n]*python[^\n]*\n/, `${launcher}\n`);
    if (next !== raw) await writeFile(filePath, next, { encoding: 'utf8', mode: 0o755 });
  }
}

const platform = platformName();
const buildRoot = path.join(projectRoot, '.runtime-build');
const sourceDir = path.join(buildRoot, 'hermes-agent');
const downloadsRoot = path.join(buildRoot, 'downloads', platform);
const staging = path.join(buildRoot, `runtime-${randomUUID()}`);
await mkdir(downloadsRoot, { recursive: true });
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

try {
  const commit = await checkoutHermes(sourceDir);
  const pyproject = await readFile(path.join(sourceDir, 'pyproject.toml'), 'utf8');
  const version = pyproject.match(/^version\s*=\s*"([^"]+)"/m)?.[1] || '';
  if (!version) throw new Error(`Cannot read Hermes Agent version from ${pinnedHermesTag}.`);
  const python = await installPortablePython(staging);
  await installPortableNode(staging, downloadsRoot);
  await command(python, ['-m', 'ensurepip', '--upgrade'], { cwd: staging });
  await command(python, ['-m', 'pip', 'install', '--upgrade', '--force-reinstall', '--no-cache-dir', sourceDir, `aiohttp==${aiohttpVersion}`], {
    cwd: sourceDir,
    env: { HERMES_AGENT_ROOT: path.join(staging, 'python') },
  });
  await rewritePythonEntrypoints(staging);
  const versionOutput = await command(python, ['-m', 'hermes_cli.main', '--version'], { cwd: staging, timeout: 30000, env: { HERMES_AGENT_ROOT: path.join(staging, 'python') } });
  if (!versionOutput.includes(version)) throw new Error(`Built runtime version mismatch: ${versionOutput}`);
  await command(python, ['-c', `import aiohttp, hermes_cli, hermes_cli.main; assert aiohttp.__version__ == "${aiohttpVersion}"; print("Hermes and aiohttp imports ready")`], { cwd: staging, timeout: 30000 });
  const bridgeScript = path.join(projectRoot, 'runtime', 'agent-bridge', 'python', 'hermes_bridge.py');
  await command(python, ['-m', 'py_compile', bridgeScript], { cwd: staging, timeout: 30000 });
  await verifyRuntimeApi(python, path.join(staging, 'python'));
  const manifest = {
    schema: 1,
    platform,
    targetOs: process.platform,
    targetArch: process.arch,
    hermesAgentVersion: version,
    sourceRepo: officialRepo,
    sourceTag: pinnedHermesTag,
    sourceCommit: commit,
    pythonVersion,
    nodeVersion,
    pythonDependencies: { aiohttp: aiohttpVersion },
    builtAt: new Date().toISOString(),
    bridgeProtocolVersion,
  };
  await writeFile(path.join(staging, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const destination = path.join(projectRoot, 'runtime', 'hermes', version, platform);
  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await rename(staging, destination);
  console.log(`Built standalone Hermes runtime: ${destination}`);
} catch (error) {
  await rm(staging, { recursive: true, force: true }).catch(() => null);
  throw error;
}
