import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimePlatformDir } from './platform.mjs';

test('runtime platform names cover supported operating systems', () => {
  assert.equal(runtimePlatformDir('darwin', 'arm64'), 'mac-arm64');
  assert.equal(runtimePlatformDir('darwin', 'x64'), 'mac-x64');
  assert.equal(runtimePlatformDir('win32', 'x64'), 'win-x64');
  assert.equal(runtimePlatformDir('linux', 'arm64'), 'linux-arm64');
});
