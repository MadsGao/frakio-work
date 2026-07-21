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
    const accepted = !effort || ['low', 'medium', 'high'].includes(effort) || parsed.service_tier === 'priority';
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
      protocol: 'OpenAI Compatible', apiMode: 'codex_responses', baseUrl: `http://127.0.0.1:${providerPort}/v1`,
      model: 'gpt-test', models: ['gpt-test'], source: 'manual', capabilityMode: 'auto', capabilityOverrides: {},
    }],
    agents: [], threads: [], spaces: [], workspaces: [], vaults: [], integrations: {}, observability: {}, ui: {},
  }, null, 2)}\n`);

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
    body: JSON.stringify({ mode: 'discover', modelId: 'gpt-test', apiKey: 'test-key' }),
  });
  assert.equal(verifyResponse.status, 200);
  const verified = await verifyResponse.json();
  assert.equal(verified.capability.source, 'active_probe');
  assert.deepEqual(verified.capability.reasoningEfforts, ['low', 'medium', 'high']);
  assert.equal(verified.capability.serviceTiers[0].id, 'priority');
  assert.equal(requests.length, 10);
  assert.equal(requests[0].url, '/v1/responses');
  assert.deepEqual(requests[1].body.reasoning, { effort: 'none' });
  assert.equal(requests.at(-1).body.service_tier, 'priority');

  const capabilitiesResponse = await fetch(`${baseUrl}/api/model-capabilities`);
  const capabilities = await capabilitiesResponse.json();
  assert.equal(capabilities.capabilities['model-relay::gpt-test'].source, 'active_probe');
  const cache = JSON.parse(await readFile(path.join(home, 'data', 'model-catalog-cache.json'), 'utf8'));
  assert.equal(Object.values(cache.providers)[0].records['custom:relay::codex_responses::local::gpt-test'].source, 'active_probe');
});
