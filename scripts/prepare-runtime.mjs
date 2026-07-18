import { cp, mkdir, readFile, realpath, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const runtimeRoot = path.join(projectRoot, 'runtime', 'hermes');
const bridgeDest = path.join(projectRoot, 'runtime', 'agent-bridge', 'python');
const bridgeProtocolVersion = 1;

function platformDir() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'mac-arm64';
  if (process.platform === 'darwin') return 'mac-x64';
  if (process.platform === 'win32' && process.arch === 'arm64') return 'win-arm64';
  if (process.platform === 'win32') return 'win-x64';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64';
  return 'linux-x64';
}

function versionParts(value) {
  return String(value || '').match(/\d+/g)?.map(Number) || [];
}

function compareVersionDesc(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (right[index] || 0) - (left[index] || 0);
    if (diff) return diff;
  }
  return String(b || '').localeCompare(String(a || ''));
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(runtimeDir) {
  try {
    return JSON.parse(await readFile(path.join(runtimeDir, 'runtime-manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function newestProjectRuntime() {
  const candidates = [];
  const entries = await readdir(runtimeRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runtimeDir = path.join(runtimeRoot, entry.name, platformDir());
    if (await exists(path.join(runtimeDir, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3'))) {
      candidates.push({ version: entry.name, runtimeDir });
    }
  }
  candidates.sort((a, b) => compareVersionDesc(a.version, b.version));
  return candidates[0] || null;
}

async function resolveRuntimeSource() {
  const explicit = process.env.FRAKIO_WORK_HERMES_RUNTIME_SOURCE || process.env.FRAKIO_WORK_HERMES_RUNTIME;
  if (!explicit) {
    const bundled = await newestProjectRuntime();
    if (bundled) return bundled;
    throw new Error('Frakio Work does not contain a Hermes runtime. Run npm run runtime:build first.');
  }
  const runtimeDir = path.resolve(explicit);
  if (!(await exists(runtimeDir))) throw new Error(`Runtime source does not exist: ${runtimeDir}`);
  const manifest = await readManifest(runtimeDir);
  const version = String(manifest?.hermesAgentVersion || path.basename(path.dirname(runtimeDir))).trim();
  if (!version) throw new Error(`Runtime source has no version manifest: ${runtimeDir}`);
  return { version, runtimeDir };
}

async function assertContainedExecutable(runtimeDir, target) {
  if (!existsSync(target)) throw new Error(`Runtime executable is missing: ${target}`);
  const [resolvedRuntime, resolvedTarget] = await Promise.all([realpath(runtimeDir), realpath(target)]);
  if (resolvedTarget !== resolvedRuntime && !resolvedTarget.startsWith(`${resolvedRuntime}${path.sep}`)) {
    throw new Error(`Runtime is not standalone. ${target} resolves outside Frakio Work: ${resolvedTarget}`);
  }
}

async function validateRuntime(runtimeDir) {
  const manifest = await readManifest(runtimeDir);
  if (!manifest?.hermesAgentVersion) throw new Error(`Missing Hermes version in ${path.join(runtimeDir, 'runtime-manifest.json')}`);
  if (Number(manifest.bridgeProtocolVersion || 0) !== bridgeProtocolVersion) {
    throw new Error(`Runtime Bridge protocol ${manifest.bridgeProtocolVersion || 'missing'} is incompatible with Frakio Work ${bridgeProtocolVersion}.`);
  }
  const python = path.join(runtimeDir, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
  await assertContainedExecutable(runtimeDir, python);
  const node = path.join(runtimeDir, 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node');
  if (existsSync(node)) await assertContainedExecutable(runtimeDir, node);
  if (process.platform !== 'win32') {
    const binDir = path.join(runtimeDir, 'python', 'bin');
    const entries = await readdir(binDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const raw = await readFile(path.join(binDir, entry.name), 'utf8').catch(() => '');
      const firstLines = raw.split('\n').slice(0, 3).join('\n');
      if (/^#!\/(?:Users|home|opt)\//.test(firstLines) || firstLines.includes('.hermes-web-ui') || firstLines.includes('.runtime-build/')) {
        throw new Error(`Runtime entrypoint is not portable: ${path.join(binDir, entry.name)}`);
      }
    }
  }
  return manifest;
}

const runtime = await resolveRuntimeSource();
const runtimeDest = path.join(runtimeRoot, runtime.version, platformDir());
if (path.resolve(runtime.runtimeDir) !== path.resolve(runtimeDest)) {
  await mkdir(path.dirname(runtimeDest), { recursive: true });
  await rm(runtimeDest, { recursive: true, force: true });
  await cp(runtime.runtimeDir, runtimeDest, { recursive: true, dereference: true, preserveTimestamps: true });
}

const bridgeSource = process.env.FRAKIO_WORK_BRIDGE_SOURCE || '';
if (bridgeSource) {
  const source = path.resolve(bridgeSource);
  if (!(await exists(path.join(source, 'hermes_bridge.py')))) throw new Error(`Bridge source is invalid: ${source}`);
  if (source !== path.resolve(bridgeDest)) {
    await mkdir(path.dirname(bridgeDest), { recursive: true });
    await rm(bridgeDest, { recursive: true, force: true });
    await cp(source, bridgeDest, { recursive: true, dereference: true, preserveTimestamps: true });
  }
}
if (!(await exists(path.join(bridgeDest, 'hermes_bridge.py')))) {
  throw new Error('Frakio Work Bridge is missing from runtime/agent-bridge/python.');
}

const manifest = await validateRuntime(runtimeDest);
console.log(`Prepared standalone Hermes runtime ${manifest.hermesAgentVersion}: ${runtimeDest}`);
console.log(`Using Frakio Work Bridge protocol ${bridgeProtocolVersion}: ${bridgeDest}`);
