import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAppVersion } from './app-version.mjs';

test('desktop version takes precedence over package metadata', async () => {
  const version = await resolveAppVersion({
    envVersion: '0.1.1',
    packagePath: '/missing/package.json',
    readFileImpl: async () => JSON.stringify({ version: '9.9.9' }),
  });
  assert.equal(version, '0.1.1');
});

test('source builds read package metadata', async () => {
  const version = await resolveAppVersion({
    packagePath: '/workspace/package.json',
    readFileImpl: async () => JSON.stringify({ version: '0.1.1' }),
  });
  assert.equal(version, '0.1.1');
});

test('invalid or unavailable versions fall back safely', async () => {
  const version = await resolveAppVersion({
    envVersion: 'not-a-version',
    packagePath: '/missing/package.json',
    readFileImpl: async () => { throw new Error('missing'); },
  });
  assert.equal(version, '0.0.0');
});
