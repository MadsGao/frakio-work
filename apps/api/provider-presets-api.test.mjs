import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('relay compatibility entries stay hidden when an external preset source includes them', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-provider-presets-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  const presetSource = path.join(parent, 'provider-presets.ts');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(hermesHome, { recursive: true });
  await writeFile(presetSource, `export const PROVIDER_PRESETS: ProviderPreset[] = [
  { label: 'External Ikun', value: 'ikuncode', baseUrl: 'https://api.ikuncode.cc/v1', apiMode: 'codex_responses', models: ['gpt-5.6-sol'] },
  { label: 'External Codex Relay', value: 'fun-codex', baseUrl: 'https://api.apikey.fun/v1', apiMode: 'codex_responses', models: ['gpt-5.5'] },
  { label: 'External Claude Relay', value: 'fun-claude', baseUrl: 'https://api.apikey.fun', apiMode: 'anthropic_messages', models: ['claude-opus-4-8'] },
  { label: 'Anthropic', value: 'anthropic', baseUrl: 'https://api.anthropic.com', apiMode: 'anthropic_messages', models: ['claude-opus-4-8'] },
]
`);
  await writeFile(path.join(home, 'data', 'workbench-state.json'), `${JSON.stringify({
    models: [
      { id: 'model-ikun', name: 'IkunCode', provider: 'IkunCode', kind: 'relay', protocol: 'OpenAI Compatible', model: 'gpt-5.6-sol', models: ['gpt-5.6-sol'], baseUrl: 'https://api.ikuncode.cc/v1', providerKey: 'ikuncode', apiMode: 'codex_responses', source: 'manual' },
      { id: 'model-fun-codex', name: 'Codex relay', provider: 'Codex-apikey.fun', kind: 'relay', protocol: 'OpenAI Compatible', model: 'gpt-5.5', models: ['gpt-5.5'], baseUrl: 'https://api.apikey.fun/v1', providerKey: 'fun-codex', apiMode: 'codex_responses', source: 'manual' },
      { id: 'model-fun-claude', name: 'Claude relay', provider: 'Claude-apikey.fun', kind: 'relay', protocol: 'Anthropic Compatible', model: 'claude-opus-4-8', models: ['claude-opus-4-8'], baseUrl: 'https://api.apikey.fun', providerKey: 'fun-claude', apiMode: 'anthropic_messages', source: 'manual' },
    ],
    agents: [], threads: [], spaces: [], workspaces: [], vaults: [], integrations: {}, observability: {}, ui: {},
  })}\n`);

  const previous = {
    home: process.env.FRAKIO_WORK_HOME,
    hermesHome: process.env.HERMES_HOME,
    presets: process.env.FRAKIO_WORK_PROVIDER_PRESETS,
    disableAutostart: process.env.FRAKIO_WORK_DISABLE_AUTOSTART,
    port: process.env.PORT,
  };
  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_PROVIDER_PRESETS = presetSource;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';
  t.after(async () => {
    for (const [key, value] of Object.entries({
      FRAKIO_WORK_HOME: previous.home,
      HERMES_HOME: previous.hermesHome,
      FRAKIO_WORK_PROVIDER_PRESETS: previous.presets,
      FRAKIO_WORK_DISABLE_AUTOSTART: previous.disableAutostart,
      PORT: previous.port,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(parent, { recursive: true, force: true });
  });

  const module = await import(`./server.mjs?provider-presets-api=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const apiServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => apiServer.once('listening', resolve));
  t.after(() => apiServer.close());
  const baseUrl = `http://127.0.0.1:${apiServer.address().port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const headers = { cookie: sessionResponse.headers.get('set-cookie')?.split(';')[0] || '' };

  const presets = await fetch(`${baseUrl}/api/model-providers/presets`, { headers }).then((response) => response.json());
  assert.deepEqual(presets.providers.map((provider) => provider.value), ['anthropic']);
  assert.equal(Object.hasOwn(presets.providers[0], 'selectable'), false);

  const configured = await fetch(`${baseUrl}/api/models`, { headers }).then((response) => response.json());
  assert.deepEqual(configured.models.map((model) => model.providerKey), ['ikuncode', 'fun-codex', 'fun-claude']);
  assert.equal(configured.models[0].apiMode, 'codex_responses');
});
