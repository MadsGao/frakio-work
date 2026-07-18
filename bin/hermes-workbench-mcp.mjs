#!/usr/bin/env node
const workbenchUrl = String(process.env.HERMES_WORKBENCH_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const profile = String(process.env.HERMES_WORKBENCH_PROFILE || 'default');
const toolset = String(process.env.HERMES_WORKBENCH_MCP_TOOLSET || process.argv[2] || 'use').toLowerCase();

const apiCatalog = [
  { method: 'GET', path: '/api/state', description: 'Frakio Work UI state and integrations' },
  { method: 'GET', path: '/api/agents', description: 'Agent list' },
  { method: 'GET', path: '/api/models', description: 'Model list' },
  { method: 'GET', path: '/api/workspaces', description: 'Project list' },
  { method: 'GET', path: '/api/workspaces/:id/threads', description: 'Project thread list' },
  { method: 'GET', path: '/api/threads/:id', description: 'Thread detail' },
  { method: 'GET', path: '/api/hermes-runtime/status', description: 'Hermes runtime status' },
  { method: 'GET', path: '/api/hermes-bootstrap/status', description: 'Hermes bootstrap status' },
  { method: 'GET', path: '/api/hermes/mcp/servers', description: 'MCP server list for a profile' },
  { method: 'GET', path: '/api/user-profile', description: 'Frakio Work user profile' },
];

const toolsBySet = {
  api: [
    {
      name: 'hermes_workbench_api_catalog_get',
      description: 'Get a compact catalog of Frakio Work local API routes that are safe for Hermes Agent discovery.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'hermes_workbench_api_request',
      description: 'Call an allowlisted Frakio Work local API route. Only safe local /api paths are accepted.',
      inputSchema: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['GET'] },
          path: { type: 'string', description: 'Allowlisted /api path, including optional query string.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  ],
  use: [
    { name: 'hermes_workbench_use_threads_list', description: 'List Frakio Work project and direct conversation threads.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    {
      name: 'hermes_workbench_use_thread_get',
      description: 'Read one Frakio Work thread by id.',
      inputSchema: { type: 'object', properties: { threadId: { type: 'string' } }, required: ['threadId'], additionalProperties: false },
    },
    { name: 'hermes_workbench_use_projects_list', description: 'List Frakio Work projects.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'hermes_workbench_use_agents_list', description: 'List Frakio Work Agents and Hermes profile bindings.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'hermes_workbench_use_models_list', description: 'List configured Frakio Work models.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'hermes_workbench_use_runtime_status', description: 'Read local Hermes runtime and bootstrap status as seen by Frakio Work.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'hermes_workbench_use_mcp_servers_list', description: 'List MCP servers configured for the current Hermes profile.', inputSchema: { type: 'object', properties: { profile: { type: 'string' } }, additionalProperties: false } },
    { name: 'hermes_workbench_use_user_profile_get', description: 'Read the Frakio Work user profile.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  ],
};

const allowlist = [
  /^\/api\/state(?:\?.*)?$/,
  /^\/api\/agents(?:\?.*)?$/,
  /^\/api\/models(?:\?.*)?$/,
  /^\/api\/workspaces(?:\?.*)?$/,
  /^\/api\/workspaces\/[A-Za-z0-9_-]+\/threads(?:\?.*)?$/,
  /^\/api\/threads\/[A-Za-z0-9_-]+(?:\?.*)?$/,
  /^\/api\/hermes-runtime\/status(?:\?.*)?$/,
  /^\/api\/hermes-bootstrap\/status(?:\?.*)?$/,
  /^\/api\/hermes\/mcp\/servers(?:\?.*)?$/,
  /^\/api\/user-profile(?:\?.*)?$/,
];

function currentTools() {
  return toolsBySet[toolset] || toolsBySet.use;
}

function content(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function requestJson(path) {
  const cleanPath = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  const res = await fetch(`${workbenchUrl}${cleanPath}`, { method: 'GET', headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Frakio Work API ${res.status}`);
  return data;
}

function assertAllowedPath(path) {
  const clean = String(path || '');
  if (!clean.startsWith('/api/')) throw new Error('Only local /api paths are allowed.');
  if (!allowlist.some((pattern) => pattern.test(clean))) throw new Error(`Path is not allowlisted: ${clean}`);
  return clean;
}

async function listThreads() {
  const [{ workspaces = [] }, { conversations = [] }] = await Promise.all([
    requestJson('/api/workspaces?includeArchived=true'),
    requestJson('/api/conversations'),
  ]);
  const projectThreads = [];
  for (const workspace of workspaces) {
    const data = await requestJson(`/api/workspaces/${encodeURIComponent(workspace.id)}/threads`);
    projectThreads.push(...(data.threads || []).map((thread) => ({ ...thread, workspaceName: workspace.name })));
  }
  return { conversations, projectThreads };
}

async function callTool(name, args = {}) {
  if (name === 'hermes_workbench_api_catalog_get') return { profile, workbenchUrl, routes: apiCatalog };
  if (name === 'hermes_workbench_api_request') return requestJson(assertAllowedPath(args.path || ''));
  if (name === 'hermes_workbench_use_threads_list') return listThreads();
  if (name === 'hermes_workbench_use_thread_get') return requestJson(`/api/threads/${encodeURIComponent(String(args.threadId || ''))}`);
  if (name === 'hermes_workbench_use_projects_list') return requestJson('/api/workspaces?includeArchived=true');
  if (name === 'hermes_workbench_use_agents_list') return requestJson('/api/agents');
  if (name === 'hermes_workbench_use_models_list') return requestJson('/api/models');
  if (name === 'hermes_workbench_use_runtime_status') {
    const [runtime, bootstrap] = await Promise.all([
      requestJson('/api/hermes-runtime/status').catch((error) => ({ error: error.message })),
      requestJson('/api/hermes-bootstrap/status').catch((error) => ({ error: error.message })),
    ]);
    return { runtime, bootstrap };
  }
  if (name === 'hermes_workbench_use_mcp_servers_list') {
    const selectedProfile = encodeURIComponent(String(args.profile || profile || 'default'));
    return requestJson(`/api/hermes/mcp/servers?profile=${selectedProfile}`);
  }
  if (name === 'hermes_workbench_use_user_profile_get') return requestJson('/api/user-profile');
  throw new Error(`Unknown tool: ${name}`);
}

async function handle(message) {
  const { id, method, params = {} } = message || {};
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: `hermes-workbench-${toolset}`, version: '0.1.0' },
      },
    };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: currentTools() } };
  if (method === 'tools/call') {
    try {
      const result = await callTool(params.name, params.arguments || {});
      return { jsonrpc: '2.0', id, result: { content: content(result) } };
    } catch (error) {
      return { jsonrpc: '2.0', id, result: { content: content(error.message || 'Tool failed.'), isError: true } };
    }
  }
  return errorResponse(id, -32601, `Method not found: ${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    Promise.resolve()
      .then(() => handle(JSON.parse(trimmed)))
      .then((response) => {
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      })
      .catch((error) => process.stdout.write(`${JSON.stringify(errorResponse(null, -32700, error.message || 'Parse error'))}\n`));
  }
});
