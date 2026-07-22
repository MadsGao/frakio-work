import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { portablePythonRoot, runtimeBuildTarget } from './runtime-build-platform.mjs';

test('runtime build targets select native Node archives', () => {
  assert.deepEqual(runtimeBuildTarget('darwin', 'arm64', '24.16.0'), {
    runtimePlatform: 'mac-arm64',
    nodeArchiveName: 'node-v24.16.0-darwin-arm64.tar.gz',
    pythonExecutableParts: ['bin', 'python3'],
  });
  assert.deepEqual(runtimeBuildTarget('win32', 'x64', '24.16.0'), {
    runtimePlatform: 'win-x64',
    nodeArchiveName: 'node-v24.16.0-win-x64.zip',
    pythonExecutableParts: ['python.exe'],
  });
  assert.throws(() => runtimeBuildTarget('win32', 'arm64'), /not supported/);
});

test('portable Python roots match native managed layouts', () => {
  assert.equal(portablePythonRoot('/Users/runner/.local/share/uv/python/cpython/bin/python3', 'darwin'), '/Users/runner/.local/share/uv/python/cpython');
  assert.equal(portablePythonRoot(String.raw`C:\Users\runner\python\python.exe`, 'win32'), path.dirname(String.raw`C:\Users\runner\python\python.exe`));
});
