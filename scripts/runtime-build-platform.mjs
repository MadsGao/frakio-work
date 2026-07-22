import path from 'node:path';

export function runtimeBuildTarget(platform = process.platform, arch = process.arch, nodeVersion = '24.16.0') {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    const nodePlatform = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    return {
      runtimePlatform: arch === 'arm64' ? 'mac-arm64' : 'mac-x64',
      nodeArchiveName: `node-v${nodeVersion}-${nodePlatform}.tar.gz`,
      pythonExecutableParts: ['bin', 'python3'],
    };
  }
  if (platform === 'win32' && arch === 'x64') {
    return {
      runtimePlatform: 'win-x64',
      nodeArchiveName: `node-v${nodeVersion}-win-x64.zip`,
      pythonExecutableParts: ['python.exe'],
    };
  }
  throw new Error(`Bundled desktop runtimes are not supported on ${platform}-${arch}.`);
}

export function portablePythonRoot(executable, platform = process.platform) {
  return platform === 'win32' ? path.dirname(executable) : path.dirname(path.dirname(executable));
}
