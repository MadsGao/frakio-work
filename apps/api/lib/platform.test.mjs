import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeNodeCandidate, runtimePlatformDir, runtimePythonCandidates } from './platform.mjs';

test('runtime platform names cover supported operating systems', () => {
  assert.equal(runtimePlatformDir('darwin', 'arm64'), 'mac-arm64');
  assert.equal(runtimePlatformDir('darwin', 'x64'), 'mac-x64');
  assert.equal(runtimePlatformDir('win32', 'x64'), 'win-x64');
  assert.equal(runtimePlatformDir('linux', 'arm64'), 'linux-arm64');
});

test('runtime executable paths use native Windows filenames', () => {
  assert.deepEqual(runtimePythonCandidates('C:\\runtime', 'win32'), ['C:\\runtime\\python\\python.exe']);
  assert.equal(runtimeNodeCandidate('C:\\runtime', 'win32'), 'C:\\runtime\\node\\node.exe');
  assert.deepEqual(runtimePythonCandidates('/runtime', 'darwin'), ['/runtime/python/bin/python3', '/runtime/python/bin/python']);
  assert.equal(runtimeNodeCandidate('/runtime', 'darwin'), '/runtime/node/bin/node');
});
