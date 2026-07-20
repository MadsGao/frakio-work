import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Hermes Default stays hidden and protected while named profiles remain independently deletable', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-hermes-profile-api-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  const irisHome = path.join(hermesHome, 'profiles', 'iris');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(irisHome, { recursive: true });
  await writeFile(path.join(hermesHome, 'config.yaml'), '{}\n');
  await writeFile(path.join(hermesHome, 'root-marker'), 'keep\n');
  await writeFile(path.join(irisHome, 'config.yaml'), '{}\n');
  await writeFile(path.join(home, 'data', 'workbench-state.json'), `${JSON.stringify({
    agents: [
      { id: 'hermes-default', name: 'Hermes Default', profileName: 'default', source: 'hermes-profile' },
      { id: 'iris', name: 'Iris', profileName: 'iris', source: 'hermes-profile' },
    ],
  })}\n`);

  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';

  const module = await import(`./server.mjs?hermes-profile-api=${Date.now()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const writeHeaders = { cookie, 'x-frakio-request': '1' };

  const agentsResponse = await fetch(`${baseUrl}/api/agents`);
  assert.equal(agentsResponse.status, 200);
  assert.deepEqual((await agentsResponse.json()).agents.map((agent) => agent.id), ['iris']);

  const protectedResponse = await fetch(`${baseUrl}/api/agents/hermes-default`, { method: 'DELETE', headers: writeHeaders });
  assert.equal(protectedResponse.status, 409);
  assert.equal((await protectedResponse.json()).code, 'system_profile_protected');
  await access(path.join(hermesHome, 'root-marker'));
  await access(path.join(irisHome, 'config.yaml'));

  const deleteResponse = await fetch(`${baseUrl}/api/agents/iris`, { method: 'DELETE', headers: writeHeaders });
  assert.equal(deleteResponse.status, 200);
  await access(path.join(hermesHome, 'root-marker'));
  await assert.rejects(access(irisHome));
});
