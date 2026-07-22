import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function runtimePlatformDir(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'mac-arm64';
  if (platform === 'darwin') return 'mac-x64';
  if (platform === 'win32' && arch === 'arm64') return 'win-arm64';
  if (platform === 'win32') return 'win-x64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
  return 'linux-x64';
}

export function runtimePythonCandidates(runtimeDir, platform = process.platform) {
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') return [platformPath.join(runtimeDir, 'python', 'python.exe')];
  return [platformPath.join(runtimeDir, 'python', 'bin', 'python3'), platformPath.join(runtimeDir, 'python', 'bin', 'python')];
}

export function runtimeNodeCandidate(runtimeDir, platform = process.platform) {
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  return platformPath.join(runtimeDir, 'node', platform === 'win32' ? 'node.exe' : 'bin/node');
}

export function runtimePythonSitePackagesCandidates(runtimeDir, platform = process.platform) {
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') return [platformPath.join(runtimeDir, 'python', 'Lib', 'site-packages')];
  return [];
}

export async function resolveCommand(command, { cwd = process.cwd(), env = process.env, platform = process.platform } = {}) {
  const clean = String(command || '').trim();
  if (!clean) return '';
  if (path.isAbsolute(clean)) return clean;
  if (clean.includes('/') || clean.includes('\\')) return path.resolve(cwd, clean);
  try {
    if (platform === 'win32') {
      const { stdout } = await execFileAsync('where.exe', [clean], { cwd, env, timeout: 2000 });
      return stdout.trim().split(/\r?\n/)[0] || '';
    }
    const { stdout } = await execFileAsync('/bin/sh', ['-lc', 'command -v -- "$1"', 'frakio-command', clean], { cwd, env, timeout: 2000 });
    return stdout.trim().split('\n')[0] || '';
  } catch {
    return '';
  }
}
