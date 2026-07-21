import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return server.address().port;
}

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

test('OAuth presets hide models before auth and Codex loads its account catalog after auth', async (t) => {
  const accountToken = jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-api-test' } });
  let catalogHeaders = null;
  const catalogServer = createServer((req, res) => {
    catalogHeaders = req.headers;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ models: [
      { slug: 'gpt-second', priority: 20 },
      { slug: 'gpt-hidden', priority: 1, visibility: 'hide' },
      { slug: 'gpt-first', priority: 10, supported_reasoning_levels: ['low', 'high'] },
    ] }));
  });
  const catalogPort = await listen(catalogServer);
  t.after(() => catalogServer.close());

  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-oauth-api-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(hermesHome, { recursive: true });
  t.after(() => rm(parent, { recursive: true, force: true }));
  await writeFile(path.join(home, 'data', 'workbench-state.json'), `${JSON.stringify({
    models: [], agents: [], threads: [], spaces: [], workspaces: [], vaults: [], integrations: {}, observability: {}, ui: {},
  })}\n`);

  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.FRAKIO_WORK_CODEX_MODELS_URL = `http://127.0.0.1:${catalogPort}/models`;
  process.env.PORT = '0';
  const module = await import(`./server.mjs?oauth-provider-api=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const apiServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => apiServer.once('listening', resolve));
  t.after(() => apiServer.close());
  const baseUrl = `http://127.0.0.1:${apiServer.address().port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-frakio-request': '1' };

  const initial = await fetch(`${baseUrl}/api/model-providers/presets`, { headers }).then((response) => response.json());
  for (const providerKey of ['ikuncode', 'fun-codex', 'fun-claude']) {
    assert.equal(initial.providers.some((provider) => provider.value === providerKey), false);
  }
  for (const providerKey of ['openai-codex', 'claude-oauth', 'google-gemini-cli']) {
    const preset = initial.providers.find((provider) => provider.value === providerKey);
    assert.equal(preset.authenticated, false);
    assert.deepEqual(preset.models, []);
  }
  assert.ok(initial.providers.find((provider) => provider.value === 'deepseek').models.length > 0);

  await writeFile(path.join(hermesHome, 'auth.json'), `${JSON.stringify({
    providers: {
      'openai-codex': { tokens: { access_token: accountToken } },
      'claude-oauth': { tokens: { access_token: 'claude-token' } },
      'google-gemini-cli': { access_token: 'gemini-token' },
    },
  })}\n`);

  const authorized = await fetch(`${baseUrl}/api/model-providers/presets`, { headers }).then((response) => response.json());
  assert.deepEqual(authorized.providers.find((provider) => provider.value === 'openai-codex').models, []);
  assert.ok(authorized.providers.find((provider) => provider.value === 'claude-oauth').models.length > 0);
  assert.equal(authorized.providers.find((provider) => provider.value === 'claude-oauth').catalog.source, 'frakio_builtin');
  assert.ok(authorized.providers.find((provider) => provider.value === 'google-gemini-cli').models.length > 0);

  const refreshedResponse = await fetch(`${baseUrl}/api/auth/codex/catalog`, { method: 'POST', headers, body: '{}' });
  assert.equal(refreshedResponse.status, 200);
  const refreshed = await refreshedResponse.json();
  assert.deepEqual(refreshed.models, ['gpt-first', 'gpt-second']);
  assert.equal(catalogHeaders['chatgpt-account-id'], 'acct-api-test');

  const afterRefresh = await fetch(`${baseUrl}/api/model-providers/presets`, { headers }).then((response) => response.json());
  assert.deepEqual(afterRefresh.providers.find((provider) => provider.value === 'openai-codex').models, ['gpt-first', 'gpt-second']);
});
