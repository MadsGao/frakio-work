import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('createApp initializes without opening a listening socket', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'frakio-create-app-'));
  process.env.FRAKIO_WORK_HOME = home;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  const module = await import(`./server.mjs?test=${Date.now()}`);
  const app = await module.createApp();
  assert.equal(typeof app, 'function');
  assert.equal(typeof app.listen, 'function');
});
