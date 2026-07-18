import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const officialRepo = 'https://github.com/NousResearch/hermes-agent.git';
const bridgeProtocolVersion = 1;
const pythonVersion = process.env.FRAKIO_PYTHON_VERSION || '3.12.12';
const nodeVersion = process.env.FRAKIO_NODE_VERSION || '24.16.0';
const pinnedHermesTag = process.env.HERMES_AGENT_TAG || 'v2026.7.7.2';

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
  await command(python, ['-m', 'pip', 'install', '--upgrade', '--force-reinstall', '--no-cache-dir', sourceDir], {
    cwd: sourceDir,
    env: { HERMES_AGENT_ROOT: path.join(staging, 'python') },
  });
  await rewritePythonEntrypoints(staging);
  const versionOutput = await command(python, ['-m', 'hermes_cli.main', '--version'], { cwd: staging, timeout: 30000, env: { HERMES_AGENT_ROOT: path.join(staging, 'python') } });
  if (!versionOutput.includes(version)) throw new Error(`Built runtime version mismatch: ${versionOutput}`);
  await command(python, ['-c', 'import hermes_cli, hermes_cli.main; print("Hermes imports ready")'], { cwd: staging, timeout: 30000 });
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
