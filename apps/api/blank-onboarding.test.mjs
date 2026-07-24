import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function startTestApp(t, prefix) {
  const parent = await mkdtemp(path.join(os.tmpdir(), prefix));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  await mkdir(home, { recursive: true });
  await mkdir(hermesHome, { recursive: true });
  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.HERMES_BIN = path.join(parent, 'missing-hermes');
  process.env.PORT = '0';
  const module = await import(`./server.mjs?blank-onboarding=${prefix}-${Date.now()}-${Math.random()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return { parent, home, hermesHome, baseUrl, writeHeaders: { cookie, 'x-frakio-request': '1' } };
}

test('fresh install stays blank until Hermes profiles are explicitly synchronized', async (t) => {
  const ctx = await startTestApp(t, 'frakio-blank-install-');
  const profileDir = path.join(ctx.hermesHome, 'profiles', 'local-agent');
  await mkdir(profileDir, { recursive: true });
  await writeFile(path.join(profileDir, 'profile.yaml'), 'name: Local Agent\nrole: Local Profile\n');
  await writeFile(path.join(profileDir, 'config.yaml'), '{}\n');

  const agents = await fetch(`${ctx.baseUrl}/api/agents`).then((res) => res.json());
  const models = await fetch(`${ctx.baseUrl}/api/models`).then((res) => res.json());
  const conversations = await fetch(`${ctx.baseUrl}/api/conversations`).then((res) => res.json());
  const vaults = await fetch(`${ctx.baseUrl}/api/vaults`).then((res) => res.json());
  const state = await fetch(`${ctx.baseUrl}/api/state`).then((res) => res.json());
  assert.deepEqual(agents.agents, []);
  assert.deepEqual(models.models, []);
  assert.deepEqual(conversations.conversations, []);
  assert.deepEqual(vaults.vaults, []);
  assert.equal(state.ui.defaultAgentId, '');
  assert.equal(state.ui.defaultModel, '');
  assert.equal(state.ui.agentMentionMaxDepth, 2);

  const mentionLimitResponse = await fetch(`${ctx.baseUrl}/api/state/ui`, {
    method: 'PATCH',
    headers: { ...ctx.writeHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ agentMentionMaxDepth: 'unlimited' }),
  });
  assert.equal(mentionLimitResponse.status, 200);
  assert.equal((await mentionLimitResponse.json()).ui.agentMentionMaxDepth, 'unlimited');

  const importResponse = await fetch(`${ctx.baseUrl}/api/hermes-bootstrap/import`, { method: 'POST', headers: ctx.writeHeaders });
  assert.equal(importResponse.status, 200);
  const imported = await importResponse.json();
  assert.deepEqual(imported.importedProfiles, ['local-agent']);
  assert.equal(imported.agents.length, 1);
  assert.equal(imported.agents[0].model, '');
  const importedState = await fetch(`${ctx.baseUrl}/api/state`).then((res) => res.json());
  assert.equal(importedState.ui.defaultAgentId, 'local-agent');

  const conversationResponse = await fetch(`${ctx.baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { ...ctx.writeHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      primaryAgentId: 'local-agent',
      agentRunOverrides: {
        'local-agent': { reasoningEffort: 'high', speedMode: 'fast' },
        missing: { reasoningEffort: 'max', speedMode: 'fast' },
      },
    }),
  });
  assert.equal(conversationResponse.status, 200);
  const conversation = await conversationResponse.json();
  assert.deepEqual(conversation.thread.agentRunOverrides, {
    'local-agent': { reasoningEffort: 'high', speedMode: 'fast' },
  });
  const patchResponse = await fetch(`${ctx.baseUrl}/api/threads/${conversation.thread.id}`, {
    method: 'PATCH',
    headers: { ...ctx.writeHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ agentRunOverrides: { 'local-agent': { reasoningEffort: 'unsupported', speedMode: 'standard' } } }),
  });
  assert.equal(patchResponse.status, 200);
  const patched = await patchResponse.json();
  assert.deepEqual(patched.thread.agentRunOverrides, { 'local-agent': { speedMode: 'standard' } });
});

test('creating a model-less Agent writes no implicit model and persists gateway auto-start', async (t) => {
  const ctx = await startTestApp(t, 'frakio-model-less-agent-');
  const requestId = 'create-fresh-agent-once';
  const response = await fetch(`${ctx.baseUrl}/api/agents`, {
    method: 'POST',
    headers: { ...ctx.writeHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Fresh Agent', role: '测试', requestId }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.agent.model, '');
  assert.ok('gateway' in result);
  assert.ok('runtime' in result);
  const config = await readFile(path.join(ctx.hermesHome, 'profiles', 'fresh-agent', 'config.yaml'), 'utf8');
  assert.doesNotMatch(config, /(^|\n)model:/);
  assert.doesNotMatch(config, /gpt-|deepseek|Hermes default/i);
  const state = JSON.parse(await readFile(path.join(ctx.home, 'data', 'workbench-state.json'), 'utf8'));
  assert.equal(state.agents.length, 1);
  assert.equal(state.ui.defaultAgentId, 'fresh-agent');
  assert.deepEqual(state.integrations.hermesAgent.gatewayAutoStart.include, ['default', 'fresh-agent']);
  assert.equal(state.integrations.hermesAgent.gatewayAutoStart.exclude.includes('fresh-agent'), false);
  const replayResponse = await fetch(`${ctx.baseUrl}/api/agents`, {
    method: 'POST',
    headers: { ...ctx.writeHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Fresh Agent', role: '测试', requestId }),
  });
  assert.equal(replayResponse.status, 200);
  const replay = await replayResponse.json();
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.agent.id, 'fresh-agent');
  const replayState = JSON.parse(await readFile(path.join(ctx.home, 'data', 'workbench-state.json'), 'utf8'));
  assert.equal(replayState.agents.length, 1);
});

test('assigning the first configured model materializes its provider in the Hermes Profile', async (t) => {
  const ctx = await startTestApp(t, 'frakio-profile-model-sync-');
  const jsonHeaders = { ...ctx.writeHeaders, 'content-type': 'application/json' };
  const agentResponse = await fetch(`${ctx.baseUrl}/api/agents`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name: 'Mark', role: '测试', requestId: 'create-mark-model-sync' }),
  });
  assert.equal(agentResponse.status, 200);
  const modelResponse = await fetch(`${ctx.baseUrl}/api/models`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      name: 'DeepSeek',
      provider: 'DeepSeek',
      providerKey: 'deepseek',
      kind: 'official',
      protocol: 'OpenAI Compatible',
      apiMode: 'chat_completions',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-deepseek-key',
      model: 'deepseek-v4-flash',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    }),
  });
  assert.equal(modelResponse.status, 200);
  const model = (await modelResponse.json()).model;
  const assignResponse = await fetch(`${ctx.baseUrl}/api/agents/mark`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ model: `${model.id}::deepseek-v4-flash` }),
  });
  assert.equal(assignResponse.status, 200);
  const assigned = await assignResponse.json();
  assert.equal(assigned.agent.model, 'deepseek-v4-flash');
  const profileDir = path.join(ctx.hermesHome, 'profiles', 'mark');
  const config = await readFile(path.join(profileDir, 'config.yaml'), 'utf8');
  const env = await readFile(path.join(profileDir, '.env'), 'utf8');
  assert.match(config, /provider: deepseek/);
  assert.match(config, /default: deepseek-v4-flash/);
  assert.match(env, /^DEEPSEEK_API_KEY=/m);
  assert.match(env, /^DEEPSEEK_BASE_URL=https:\/\/api\.deepseek\.com/m);
});

test('legacy cleanup removes only untouched built-in content and creates an idempotent backup marker', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-legacy-cleanup-'));
  const home = path.join(parent, '.frakio-work');
  const hermesHome = path.join(parent, '.hermes');
  const dataDir = path.join(home, 'data');
  await mkdir(dataDir, { recursive: true });
  await mkdir(hermesHome, { recursive: true });
  const iris = { id: 'iris', name: 'Iris', role: '书记官 / 默认入口', model: 'Hermes default', color: '#2563eb', soul: '冷静、细致，负责把混乱需求变成可执行 brief。', scope: '理解意图、整理 brief、记录结论、维护上下文。', source: 'demo' };
  const customizedMax = { id: 'max', name: '我的 Max', role: 'CEO / 调度裁决', model: 'Hermes reasoning', color: '#111827', soul: '判断优先级，压住复杂度，只推动下一步可确认动作。', scope: '拆解目标、分派 Agent、处理冲突、形成最终裁决。', source: 'demo' };
  const deepSeek = { id: 'model_default_deepseek_v4_flash', name: 'DeepSeek chat', provider: 'DeepSeek', kind: 'official', protocol: 'OpenAI Compatible', model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro', 'deepseek-v4-flash'], baseUrl: 'https://api.deepseek.com', apiKey: '', apiKeyState: '', source: 'default', pricing: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheCreation: 0.27 } };
  const reasoning = { id: 'model_hermes_reasoning', name: 'Hermes reasoning', provider: 'Hermes', kind: 'official', protocol: 'OpenAI Compatible', model: 'hermes-reasoning', baseUrl: '', apiKey: '', source: 'demo' };
  const welcomeMessages = [
    { id: 'start-iris', agentId: 'iris', agentName: 'Iris', role: '书记官 / 默认入口', content: 'Workspace 已开启。我会先把需求整理成可执行 brief，再交给 Max 判断是否需要更多 Agent 参与。' },
    { id: 'start-max', agentId: 'max', agentName: 'Max', role: 'CEO / 调度裁决', content: '第一版按简单原则运行：能用一个 Workspace 解决，就不新增实体。能用确认队列解决，就不把权限散到各功能里。' },
  ];
  const rawState = {
    ui: { defaultAgentId: 'iris', defaultModel: deepSeek.id },
    agents: [iris, customizedMax],
    models: [deepSeek, reasoning],
    vaults: [{ id: 'vault_creative_ai_team', name: '示例知识库', path: '/tmp/example', status: 'not_indexed', documentCount: 0, productCount: 0, lastIndexedAt: null, index: null }],
    threads: [{ id: 'thread_default', title: '欢迎使用 Frakio Work', workspaceId: 'workspace_default', mode: 'workspace', primaryAgentId: 'iris', defaultAgentId: 'iris', selectedAgents: ['iris', 'max'], vaultId: 'vault_creative_ai_team', messages: welcomeMessages }],
    spaces: [{ id: 'space_default', name: 'Frakio Work' }],
    workspaces: [{ id: 'workspace_default', spaceId: 'space_default', name: 'Frakio Work', rootPath: '/tmp/example', vaultId: 'vault_creative_ai_team', activeThreadId: 'thread_default' }],
    integrations: {},
    observability: { modelUsage: [], systemEvents: [] },
  };
  await writeFile(path.join(dataDir, 'workbench-state.json'), `${JSON.stringify(rawState, null, 2)}\n`);
  process.env.FRAKIO_WORK_HOME = home;
  process.env.HERMES_HOME = hermesHome;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';
  const module = await import(`./server.mjs?legacy-cleanup=${Date.now()}-${Math.random()}`);
  await module.createApp();
  const cleaned = JSON.parse(await readFile(path.join(dataDir, 'workbench-state.json'), 'utf8'));
  assert.deepEqual(cleaned.agents.map((agent) => agent.id), ['max']);
  assert.deepEqual(cleaned.models.map((model) => model.id), ['model_hermes_reasoning']);
  assert.deepEqual(cleaned.threads, []);
  assert.deepEqual(cleaned.vaults, []);
  assert.equal(cleaned.ui.defaultAgentId, '');
  assert.equal(cleaned.ui.defaultModel, '');
  assert.equal(cleaned.workspaces[0].activeThreadId, null);
  assert.equal(cleaned.workspaces[0].vaultId, null);
  const markerPath = path.join(home, 'backups', 'demo-data-cleanup', 'v1-complete.json');
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  assert.ok(marker.backupPath);
  await access(marker.backupPath);
  const before = await readFile(path.join(dataDir, 'workbench-state.json'), 'utf8');
  await module.createApp();
  assert.equal(await readFile(path.join(dataDir, 'workbench-state.json'), 'utf8'), before);
});
