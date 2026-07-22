import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return server.address().port;
}

test('capability verification discovers an exact custom Responses route', async (t) => {
  const requests = [];
  const providerServer = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body || '{}');
    requests.push({ url: req.url, body: parsed });
    const effort = parsed.reasoning?.effort;
    const accepted = parsed.model !== 'gpt-fail' && (!effort || ['low', 'medium', 'high'].includes(effort) || parsed.service_tier === 'priority');
    res.writeHead(accepted ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify(accepted ? { id: 'response' } : { error: { message: `unsupported ${effort}` } }));
  });
  const providerPort = await listen(providerServer);
  t.after(() => providerServer.close());

  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-capability-api-'));
  const home = path.join(parent, '.frakio-work');
  await mkdir(path.join(home, 'data'), { recursive: true });
  t.after(() => rm(parent, { recursive: true, force: true }));
  await writeFile(path.join(home, 'data', 'workbench-state.json'), `${JSON.stringify({
    models: [{
      id: 'model-relay', name: 'Relay', provider: 'Custom', providerKey: 'custom:relay', kind: 'relay',
      protocol: 'OpenAI Compatible', apiMode: 'chat_completions', baseUrl: `http://127.0.0.1:${providerPort}/v1`,
      model: 'gpt-test', models: ['gpt-test'], source: 'manual', capabilityMode: 'auto', capabilityOverrides: {},
    }, {
      id: 'model-secure', name: 'Secure relay', provider: 'Custom', providerKey: 'custom:secure', kind: 'relay',
      protocol: 'OpenAI Compatible', apiMode: 'codex_responses', baseUrl: 'https://relay.example/v1', apiKeyState: 'provided',
      model: 'gpt-secure', models: ['gpt-secure'], source: 'manual', capabilityMode: 'auto', capabilityOverrides: {},
    }],
    agents: [], threads: [], spaces: [], workspaces: [], vaults: [], integrations: {}, observability: {}, ui: {},
  }, null, 2)}\n`);
  await writeFile(path.join(home, 'data', 'model-secrets.json'), `${JSON.stringify({ models: { 'model-secure': { apiKey: 'saved-key' } } }, null, 2)}\n`);

  const nativeFetch = globalThis.fetch;
  const externalRequests = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://relay.example/')) {
      externalRequests.push({ url, authorization: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ data: [{ id: 'gpt-secure' }, { id: 'gpt-secure-2' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return nativeFetch(input, init);
  };
  t.after(() => { globalThis.fetch = nativeFetch; });

  process.env.FRAKIO_WORK_HOME = home;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?capability-probe-api=${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const apiServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => apiServer.once('listening', resolve));
  t.after(() => apiServer.close());
  const baseUrl = `http://127.0.0.1:${apiServer.address().port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];

  const verifyResponse = await fetch(`${baseUrl}/api/models/model-relay/verify`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'x-frakio-request': '1' },
    body: JSON.stringify({
      mode: 'discover', modelId: 'gpt-test', apiKey: 'test-key', saveOnSuccess: true,
      configuration: {
        name: 'Relay updated', provider: 'Custom', kind: 'relay', protocol: 'OpenAI Compatible',
        apiMode: 'codex_responses', baseUrl: `http://127.0.0.1:${providerPort}/v1`, model: 'gpt-test', models: ['gpt-test'],
        modelApiModes: {}, compat: { thinkingFormat: 'openai', requestOverrides: {} }, modelCompat: {},
        capabilityMode: 'auto', capabilityOverrides: {}, contextLimit: 200000,
        pricing: { input: null, output: null, cacheRead: null, cacheCreation: null },
      },
    }),
  });
  assert.equal(verifyResponse.status, 200);
  const verified = await verifyResponse.json();
  assert.equal(verified.capability.source, 'active_probe');
  assert.equal(verified.saved, true);
  assert.equal(verified.model.apiMode, 'codex_responses');
  assert.equal(verified.model.name, 'Relay updated');
  assert.deepEqual(verified.capability.reasoningEfforts, ['low', 'medium', 'high']);
  assert.equal(verified.capability.serviceTiers[0].id, 'priority');
  assert.equal(requests.length, 10);
  assert.equal(requests[0].url, '/v1/responses');
  assert.deepEqual(requests[1].body.reasoning, { effort: 'none' });
  assert.equal(requests.at(-1).body.service_tier, 'priority');

  const savedState = JSON.parse(await readFile(path.join(home, 'data', 'workbench-state.json'), 'utf8'));
  assert.equal(savedState.models[0].apiMode, 'codex_responses');
  assert.equal(savedState.models[0].name, 'Relay updated');
  assert.equal(savedState.models[0].contextLimit, 200000);

  const failedResponse = await fetch(`${baseUrl}/api/models/model-relay/verify`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'x-frakio-request': '1' },
    body: JSON.stringify({
      mode: 'discover', modelId: 'gpt-fail', apiKey: 'replacement-key', saveOnSuccess: true,
      configuration: {
        name: 'Broken draft', apiMode: 'openai_responses', baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        model: 'gpt-fail', models: ['gpt-fail'], capabilityMode: 'auto', capabilityOverrides: {},
      },
    }),
  });
  assert.notEqual(failedResponse.status, 200);
  const stateAfterFailure = JSON.parse(await readFile(path.join(home, 'data', 'workbench-state.json'), 'utf8'));
  assert.equal(stateAfterFailure.models[0].name, 'Relay updated');
  assert.equal(stateAfterFailure.models[0].apiMode, 'codex_responses');
  assert.equal(stateAfterFailure.models[0].model, 'gpt-test');
  const secretsAfterFailure = JSON.parse(await readFile(path.join(home, 'data', 'model-secrets.json'), 'utf8'));
  assert.equal(secretsAfterFailure.models['model-relay'].apiKey, 'test-key');

  const capabilitiesResponse = await fetch(`${baseUrl}/api/model-capabilities`);
  const capabilities = await capabilitiesResponse.json();
  assert.equal(capabilities.capabilities['model-relay::gpt-test'].source, 'active_probe');
  const cache = JSON.parse(await readFile(path.join(home, 'data', 'model-catalog-cache.json'), 'utf8'));
  assert.equal(Object.values(cache.providers)[0].records['custom:relay::codex_responses::local::gpt-test'].source, 'active_probe');

  const fetchedModels = await fetch(`${baseUrl}/api/models/fetch`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'x-frakio-request': '1' },
    body: JSON.stringify({ modelId: 'model-secure', baseUrl: 'https://relay.example/v1', apiMode: 'codex_responses', providerKey: 'custom:secure' }),
  });
  assert.equal(fetchedModels.status, 200);
  assert.deepEqual((await fetchedModels.json()).models, ['gpt-secure', 'gpt-secure-2']);
  assert.equal(externalRequests[0].authorization, 'Bearer saved-key');

  const changedOrigin = await fetch(`${baseUrl}/api/models/fetch`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'x-frakio-request': '1' },
    body: JSON.stringify({ modelId: 'model-secure', baseUrl: 'https://other.example/v1', apiMode: 'codex_responses', providerKey: 'custom:secure' }),
  });
  assert.equal(changedOrigin.status, 400);
  assert.match((await changedOrigin.json()).error, /重新输入 API Key/);
});
