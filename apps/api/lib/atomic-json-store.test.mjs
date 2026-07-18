import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { atomicWriteJson, createSerialJsonWriter, readJsonWithRecovery } from './atomic-json-store.mjs';

test('atomic JSON writes preserve a valid backup and serialize callers', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'frakio-json-'));
  const filePath = path.join(directory, 'state.json');
  try {
    await atomicWriteJson(filePath, { value: 1 });
    const write = createSerialJsonWriter(filePath);
    await Promise.all([write({ value: 2 }), write({ value: 3 })]);
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), { value: 3 });
    assert.deepEqual(JSON.parse(await readFile(`${filePath}.bak`, 'utf8')), { value: 2 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('corrupt JSON recovers from the last valid backup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'frakio-json-'));
  const filePath = path.join(directory, 'state.json');
  try {
    await writeFile(filePath, '{broken', 'utf8');
    await writeFile(`${filePath}.bak`, '{"ready":true}\n', 'utf8');
    assert.deepEqual(await readJsonWithRecovery(filePath, () => null), { ready: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
