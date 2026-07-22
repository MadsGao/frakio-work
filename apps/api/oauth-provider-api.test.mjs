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

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

test('OAuth presets hide models before auth and Codex loads its account catalog after auth', async (t) => {
  const accountToken = jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-api-test' } });
  let catalogHeaders = null;
  let catalogRequests = 0;
  const catalogServer = createServer((req, res) => {
    catalogRequests += 1;
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

  const nativeRequests = [];
  const nativeServer = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    nativeRequests.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/v1internal:loadCodeAssist') {
      res.end(JSON.stringify({ currentTier: { id: 'free-tier', name: 'Free' }, cloudaicompanionProject: 'project-test' }));
      return;
    }
    res.end(JSON.stringify(req.url === '/claude' ? { content: [{ type: 'text', text: 'OK' }] } : { response: { candidates: [] } }));
  });
  const nativePort = await listen(nativeServer);
  t.after(() => nativeServer.close());

  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-oauth-api-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(hermesHome, { recursive: true });
  t.after(() => rm(parent, { recursive: true, force: true }));
  await writeFile(path.join(home, 'data', 'workbench-state.json'), `${JSON.stringify({
    models: [{
      id: 'model-codex', name: 'OpenAI Codex', provider: 'OpenAI Codex', providerKey: 'openai-codex', kind: 'official',
      protocol: 'OpenAI Compatible', apiMode: 'codex_responses', baseUrl: 'https://chatgpt.com/backend-api/codex',
      model: 'gpt-first', models: ['gpt-first', 'gpt-second'], profileName: 'default', source: 'manual', capabilityMode: 'auto', capabilityOverrides: {},
    }, {
      id: 'model-claude', name: 'Claude OAuth', provider: 'Claude OAuth', providerKey: 'claude-oauth', kind: 'official',
      protocol: 'Anthropic Compatible', apiMode: 'anthropic_messages', baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6', models: ['claude-sonnet-4-6'], profileName: 'default', source: 'manual', capabilityMode: 'auto', capabilityOverrides: {},
    }, {
      id: 'model-gemini', name: 'Google Gemini OAuth', provider: 'Google Gemini OAuth', providerKey: 'google-gemini-cli', kind: 'official',
      protocol: 'OpenAI Compatible', apiMode: 'chat_completions', baseUrl: 'cloudcode-pa://google',
      model: 'gemini-3-flash-preview', models: ['gemini-3-flash-preview'], profileName: 'default', source: 'manual', capabilityMode: 'auto', capabilityOverrides: {},
    }], agents: [], threads: [], spaces: [], workspaces: [], vaults: [], integrations: {}, observability: {}, ui: {},
  })}\n`);

  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.FRAKIO_WORK_CODEX_MODELS_URL = `http://127.0.0.1:${catalogPort}/models`;
  process.env.FRAKIO_WORK_CLAUDE_VERIFY_URL = `http://127.0.0.1:${nativePort}/claude`;
  process.env.FRAKIO_WORK_GEMINI_CODE_ASSIST_URL = `http://127.0.0.1:${nativePort}/v1internal`;
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
  assert.deepEqual(authorized.providers.find((provider) => provider.value === 'openai-codex').models, ['gpt-first', 'gpt-second']);
  assert.ok(authorized.providers.find((provider) => provider.value === 'claude-oauth').models.length > 0);
  assert.equal(authorized.providers.find((provider) => provider.value === 'claude-oauth').catalog.source, 'frakio_builtin');
  assert.ok(authorized.providers.find((provider) => provider.value === 'google-gemini-cli').models.length > 0);

  const refreshedResponse = await fetch(`${baseUrl}/api/auth/codex/catalog`, { method: 'POST', headers, body: '{}' });
  assert.equal(refreshedResponse.status, 200);
  const refreshed = await refreshedResponse.json();
  assert.deepEqual(refreshed.models, ['gpt-first', 'gpt-second']);
  assert.equal(catalogHeaders['chatgpt-account-id'], 'acct-api-test');
  assert.equal(catalogHeaders.originator, 'codex_cli_rs');

  const afterRefresh = await fetch(`${baseUrl}/api/model-providers/presets`, { headers }).then((response) => response.json());
  assert.deepEqual(afterRefresh.providers.find((provider) => provider.value === 'openai-codex').models, ['gpt-first', 'gpt-second']);

  const configurationFor = (model) => ({
    name: model.name, provider: model.provider, kind: 'official', protocol: model.protocol,
    providerKey: model.providerKey, apiMode: model.apiMode, baseUrl: model.baseUrl,
    model: model.model, models: model.models, capabilityMode: 'auto', capabilityOverrides: {},
  });
  const codexConfig = configurationFor({ name: 'OpenAI Codex', provider: 'OpenAI Codex', protocol: 'OpenAI Compatible', providerKey: 'openai-codex', apiMode: 'codex_responses', baseUrl: 'https://chatgpt.com/backend-api/codex', model: 'gpt-first', models: ['gpt-first', 'gpt-second'] });
  const codexVerify = await fetch(`${baseUrl}/api/models/model-codex/verify`, { method: 'POST', headers, body: JSON.stringify({ configuration: codexConfig, saveOnSuccess: true }) });
  assert.equal(codexVerify.status, 200);
  const codexVerified = await codexVerify.json();
  assert.equal(codexVerified.verificationKind, 'codex_oauth');
  assert.equal(codexVerified.usageConsumed, false);
  assert.equal(codexVerified.saved, true);
  assert.equal(catalogRequests, 3);
  assert.equal(nativeRequests.length, 0);

  const missingModel = await fetch(`${baseUrl}/api/models/model-codex/verify`, { method: 'POST', headers, body: JSON.stringify({ configuration: { ...codexConfig, model: 'gpt-missing', models: ['gpt-missing'] }, saveOnSuccess: true }) });
  assert.equal(missingModel.status, 400);
  assert.equal((await missingModel.json()).code, 'model_not_entitled');
  const unchangedState = JSON.parse(await readFile(path.join(home, 'data', 'workbench-state.json'), 'utf8'));
  assert.equal(unchangedState.models.find((item) => item.id === 'model-codex').model, 'gpt-first');

  const claudeConfig = configurationFor({ name: 'Claude OAuth', provider: 'Claude OAuth', protocol: 'Anthropic Compatible', providerKey: 'claude-oauth', apiMode: 'anthropic_messages', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6', models: ['claude-sonnet-4-6'] });
  const claudeVerify = await fetch(`${baseUrl}/api/models/model-claude/verify`, { method: 'POST', headers, body: JSON.stringify({ configuration: claudeConfig, saveOnSuccess: true }) });
  assert.equal(claudeVerify.status, 200);
  assert.equal((await claudeVerify.json()).verificationKind, 'claude_oauth');
  const claudeRequest = nativeRequests.find((request) => request.url === '/claude');
  assert.equal(claudeRequest.headers.authorization, 'Bearer claude-token');
  assert.equal(claudeRequest.headers['x-api-key'], undefined);
  assert.match(claudeRequest.headers['anthropic-beta'], /oauth-2025-04-20/);
  assert.equal(claudeRequest.headers['x-app'], 'cli');
  const requestCountBeforeUnsafeDraft = nativeRequests.length;
  const unsafeClaude = await fetch(`${baseUrl}/api/models/model-claude/verify`, { method: 'POST', headers, body: JSON.stringify({ configuration: { ...claudeConfig, baseUrl: 'https://evil.example' }, saveOnSuccess: true }) });
  assert.equal(unsafeClaude.status, 400);
  assert.equal(nativeRequests.length, requestCountBeforeUnsafeDraft);

  const geminiConfig = configurationFor({ name: 'Google Gemini OAuth', provider: 'Google Gemini OAuth', protocol: 'OpenAI Compatible', providerKey: 'google-gemini-cli', apiMode: 'chat_completions', baseUrl: 'cloudcode-pa://google', model: 'gemini-3-flash-preview', models: ['gemini-3-flash-preview'] });
  const geminiVerify = await fetch(`${baseUrl}/api/models/model-gemini/verify`, { method: 'POST', headers, body: JSON.stringify({ configuration: geminiConfig, saveOnSuccess: true }) });
  assert.equal(geminiVerify.status, 200);
  assert.equal((await geminiVerify.json()).verificationKind, 'gemini_code_assist');
  assert.deepEqual(nativeRequests.filter((request) => request.url.startsWith('/v1internal')).map((request) => request.url), ['/v1internal:loadCodeAssist', '/v1internal:generateContent']);
  const generateRequest = nativeRequests.find((request) => request.url === '/v1internal:generateContent');
  assert.equal(generateRequest.headers.authorization, 'Bearer gemini-token');
  assert.equal(generateRequest.body.model, 'gemini-3-flash-preview');
  assert.equal(generateRequest.body.project, 'project-test');
  const authAfterGemini = JSON.parse(await readFile(path.join(hermesHome, 'auth.json'), 'utf8'));
  assert.equal(authAfterGemini.providers['google-gemini-cli'].code_assist.projectId, 'project-test');
});
