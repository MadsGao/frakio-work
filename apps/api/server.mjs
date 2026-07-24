import cors from 'cors';
import express from 'express';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { access, appendFile, cp, mkdir, readdir, readFile, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createTelemetryClient } from './telemetry.mjs';
import { appUpdateStatus } from './lib/app-update.mjs';
import { resolveAppVersion } from './lib/app-version.mjs';
import { createAttachmentStore, MAX_ATTACHMENT_BYTES } from './lib/attachment-store.mjs';
import { createSerialJsonWriter, readJsonWithRecovery } from './lib/atomic-json-store.mjs';
import { probeResponsesCapabilities } from './lib/capability-probe.mjs';
import { createLocalSecurity } from './lib/local-security.mjs';
import { isSystemHermesProfile, resolveDeletableHermesProfileDir, userVisibleHermesProfiles } from './lib/hermes-profile-safety.mjs';
import { resolveInsideRoot } from './lib/path-boundary.mjs';
import { resolveCommand as resolvePlatformCommand, runtimeNodeCandidate, runtimePlatformDir, runtimePythonCandidates, runtimePythonSitePackagesCandidates } from './lib/platform.mjs';
import { capabilitiesForModels, mapRunSettings, normalizeCapabilityOverrides, resolveModelCapability } from './lib/model-capabilities.mjs';
import { createModelRunDiagnostic, finishModelRunDiagnostic, markModelRunSent } from './lib/model-run-diagnostics.mjs';
import { isMentionNamePresent, mentionDepthAllows, normalizeAgentMentionMaxDepth, registerMentionEdge, resolveMentionedAgents, stripMentionRoutingTokens } from './lib/mention-routing.mjs';
import { CHAT_THINKING_FORMATS, candidateModelUrls, directHttpRequestOverrides } from './lib/provider-adapters.mjs';
import { catalogStatus, flattenProviderCatalog, parseCatalogResponse, parseModelIds, readCatalogCache, recordActiveProbeCapability, recordCatalogError, updateProviderCatalog, verificationKey, writeCatalogCache } from './lib/model-catalog-store.mjs';
import { extractChatGptAccountId, fetchCodexOAuthCatalog } from './lib/oauth-provider-catalog.mjs';
import { runtimeStep, summarizeRuntimeAutoStart } from './lib/runtime-autostart.mjs';

const app = express();
const port = Number(process.env.PORT || 8787);
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const homeDir = os.homedir();
const frakioWorkHome = process.env.FRAKIO_WORK_HOME || path.join(homeDir, '.frakio-work');
const isDesktopMode = process.env.FRAKIO_WORK_DESKTOP === '1';
const appRoot = process.env.FRAKIO_WORK_APP_ROOT || projectRoot;
const statePath = process.env.FRAKIO_WORK_STATE_PATH || path.join(frakioWorkHome, 'data/workbench-state.json');
const secretsPath = process.env.FRAKIO_WORK_SECRETS_PATH || path.join(frakioWorkHome, 'data/model-secrets.json');
const telemetryPath = process.env.FRAKIO_WORK_TELEMETRY_PATH || path.join(frakioWorkHome, 'data/telemetry.json');
const modelCatalogCachePath = process.env.FRAKIO_WORK_MODEL_CATALOG_PATH || path.join(frakioWorkHome, 'data/model-catalog-cache.json');
const defaultProjectsRoot = process.env.FRAKIO_WORK_PROJECTS_ROOT || path.join(frakioWorkHome, 'projects');
const webDistPath = process.env.FRAKIO_WORK_WEB_DIST || path.join(appRoot, 'dist');
const hermesWebUiHome = String(process.env.HERMES_WEB_UI_HOME || '').trim();
const hermesHome = process.env.HERMES_HOME || path.join(homeDir, '.hermes');
const hermesWorkbenchApiHome = process.env.HERMES_WORKBENCH_API_HOME || path.join(frakioWorkHome, 'api-home');
const hermesWorkbenchRuntimeHome = process.env.HERMES_WORKBENCH_RUNTIME_HOME || path.join(frakioWorkHome, 'runtime');
const frakioBundledRuntimeHome = process.env.FRAKIO_WORK_RUNTIME_HOME || path.join(appRoot, 'runtime');
const frakioBundledHermesRuntimeRoot = path.join(frakioBundledRuntimeHome, 'hermes');
const frakioBundledBridgeRoot = path.join(frakioBundledRuntimeHome, 'agent-bridge', 'python');
const frakioManagedHermesRuntimeRoot = path.join(frakioWorkHome, 'runtimes', 'hermes');
const frakioRuntimeStagingRoot = path.join(frakioWorkHome, 'runtimes', '.staging');
const frakioRuntimeRegistryPath = path.join(frakioWorkHome, 'runtime', 'runtime-registry.json');
const hermesAgentSourcePath = process.env.HERMES_AGENT_SOURCE || path.join(frakioWorkHome, 'sources', 'hermes-agent');
const hermesAgentBackupRoot = path.join(frakioWorkHome, 'backups', 'hermes-agent');
const attachmentRoot = path.join(frakioWorkHome, 'attachments');
const officialHermesAgentRepo = 'https://github.com/NousResearch/hermes-agent.git';
const frakioBridgeProtocolVersion = 2;
const requiredAiohttpVersion = '3.14.1';
const hermesDbPath = hermesWebUiHome ? path.join(hermesWebUiHome, 'hermes-web-ui.db') : '';
const telemetry = createTelemetryClient({
  filePath: telemetryPath,
  host: process.env.FRAKIO_WORK_UMAMI_HOST || 'https://data.madsgogo.com',
  websiteId: process.env.FRAKIO_WORK_UMAMI_WEBSITE_ID || '3fbceeb0-dffe-459c-9e5f-c6dff0c71708',
  hostname: 'com.frakio.work',
  runtimeEnabled: process.env.FRAKIO_WORK_PACKAGED === '1' || process.env.FRAKIO_WORK_TELEMETRY_FORCE === '1',
});
const writeStateJson = createSerialJsonWriter(statePath, { mode: 0o600 });
const writeSecretsJson = createSerialJsonWriter(secretsPath, { mode: 0o600 });
const attachmentStore = createAttachmentStore(attachmentRoot);
const modelCatalogCache = readCatalogCache(modelCatalogCachePath);
void attachmentStore.cleanupOrphans().catch(() => {});
let hermesApiProcess = null;
let hermesBridgeProcess = null;
const profileGatewayProcesses = new Set();
let hermesBridgeLastError = '';
const apiStartedAtMs = Date.now();
let hermesAutoStartPromise = null;
let hermesAutoStartState = {
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  steps: [],
  logs: [],
  error: '',
  warnings: [],
};
const providerEnvMap = {
  openai: { apiKey: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL' },
  anthropic: { apiKey: 'ANTHROPIC_API_KEY', baseUrl: 'ANTHROPIC_BASE_URL' },
  deepseek: { apiKey: 'DEEPSEEK_API_KEY', baseUrl: 'DEEPSEEK_BASE_URL' },
  openrouter: { apiKey: 'OPENROUTER_API_KEY', baseUrl: 'OPENROUTER_BASE_URL' },
  groq: { apiKey: 'GROQ_API_KEY', baseUrl: 'GROQ_BASE_URL' },
  gemini: { apiKey: 'GEMINI_API_KEY', baseUrl: 'GEMINI_BASE_URL' },
  moonshot: { apiKey: 'MOONSHOT_API_KEY', baseUrl: 'MOONSHOT_BASE_URL' },
  siliconflow: { apiKey: 'SILICONFLOW_API_KEY', baseUrl: 'SILICONFLOW_BASE_URL' },
  'openai-codex': { apiKey: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL' },
};
const hermesPlatformEnvMap = {
  TELEGRAM_BOT_TOKEN: ['telegram', 'token'],
  TELEGRAM_PROXY: ['telegram', 'proxy'],
  DISCORD_BOT_TOKEN: ['discord', 'token'],
  DISCORD_PROXY: ['discord', 'proxy'],
  SLACK_BOT_TOKEN: ['slack', 'token'],
  MATRIX_ACCESS_TOKEN: ['matrix', 'token'],
  MATRIX_PROXY: ['matrix', 'proxy'],
  MATRIX_HOMESERVER: ['matrix', 'extra.homeserver'],
  MATRIX_USER_ID: ['matrix', 'extra.user_id'],
  MATRIX_PASSWORD: ['matrix', 'extra.password'],
  FEISHU_APP_ID: ['feishu', 'extra.app_id'],
  FEISHU_APP_SECRET: ['feishu', 'extra.app_secret'],
  FEISHU_ENCRYPT_KEY: ['feishu', 'extra.encrypt_key'],
  FEISHU_VERIFICATION_TOKEN: ['feishu', 'extra.verification_token'],
  DINGTALK_CLIENT_ID: ['dingtalk', 'extra.client_id'],
  DINGTALK_CLIENT_SECRET: ['dingtalk', 'extra.client_secret'],
  DINGTALK_APP_KEY: ['dingtalk', 'extra.app_key'],
  DINGTALK_CARD_TEMPLATE_ID: ['dingtalk', 'extra.card_template_id'],
  DINGTALK_ALLOWED_USERS: ['dingtalk', 'allowed_users'],
  DINGTALK_ALLOW_ALL_USERS: ['dingtalk', 'allow_all_users'],
  QQ_APP_ID: ['qqbot', 'extra.app_id'],
  QQ_CLIENT_SECRET: ['qqbot', 'extra.client_secret'],
  QQ_ALLOWED_USERS: ['qqbot', 'allowed_users'],
  QQ_ALLOW_ALL_USERS: ['qqbot', 'allow_all_users'],
  WECOM_BOT_ID: ['wecom', 'extra.bot_id'],
  WECOM_SECRET: ['wecom', 'extra.secret'],
  WEIXIN_TOKEN: ['weixin', 'token'],
  WEIXIN_ACCOUNT_ID: ['weixin', 'extra.account_id'],
  WEIXIN_BASE_URL: ['weixin', 'extra.base_url'],
  WHATSAPP_ENABLED: ['whatsapp', 'enabled'],
};
const hermesPlatformEnvByPlatform = Object.entries(hermesPlatformEnvMap).reduce((acc, [envKey, [platform, cfgPath]]) => {
  acc[platform] = acc[platform] || {};
  acc[platform][cfgPath] = envKey;
  return acc;
}, {});
const weixinIlinkBase = 'https://ilinkai.weixin.qq.com';
const hermesProxyEnvKeys = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY'];
const hermesConfigSections = new Set(['display', 'agent', 'memory', 'skills', 'compression', 'session_reset', 'approvals', 'tts', 'stt', 'telegram', 'discord', 'slack', 'whatsapp', 'matrix', 'weixin', 'wecom', 'feishu', 'dingtalk', 'qqbot']);
const hermesPlatformSections = new Set(['telegram', 'discord', 'slack', 'whatsapp', 'matrix', 'weixin', 'wecom', 'feishu', 'dingtalk', 'qqbot']);
const auxiliaryModelTasks = [
  { key: 'vision', label: '视觉', default_timeout: 120, default_download_timeout: 30 },
  { key: 'compression', label: '压缩', default_timeout: 120 },
  { key: 'web_extract', label: '网页提取', default_timeout: 360 },
  { key: 'approval', label: '审批', default_timeout: 30 },
  { key: 'mcp', label: 'MCP', default_timeout: 30 },
  { key: 'title_generation', label: '标题生成', default_timeout: 30 },
  { key: 'tts_audio_tags', label: 'TTS 音频标签', default_timeout: 30 },
  { key: 'skills_hub', label: '技能中心', default_timeout: 30 },
  { key: 'triage_specifier', label: 'Triage 扩写', default_timeout: 120 },
  { key: 'kanban_decomposer', label: '看板拆解', default_timeout: 180 },
  { key: 'profile_describer', label: 'Profile 描述', default_timeout: 60 },
  { key: 'curator', label: '策展', default_timeout: 600 },
];
const auxiliaryModelTaskByKey = new Map(auxiliaryModelTasks.map((task) => [task.key, task]));
const auxiliaryEditableFields = ['provider', 'model', 'timeout', 'download_timeout', 'extra_body'];
const defaultMoaReferenceModels = [
  { provider: 'openai-codex', model: 'gpt-5.5' },
  { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' },
];
const defaultMoaAggregator = { provider: 'openrouter', model: 'anthropic/claude-opus-4.8' };
const kanbanStatuses = new Set(['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done', 'archived']);
const gatewayManagementModes = new Set(['auto', 'per_profile', 'unified']);
const externalProviderPresetSource = process.env.FRAKIO_WORK_PROVIDER_PRESETS || '';
const providerAuthTypeMap = {
  'claude-oauth': 'claude-pkce',
  'google-gemini-cli': 'gemini-loopback',
  'openai-codex': 'codex-device',
};
const compatibilityOnlyProviderKeys = new Set(['ikuncode', 'fun-codex', 'fun-claude']);
const fallbackProviderPresets = [
  { label: 'IkunCode', value: 'ikuncode', builtin: true, selectable: false, baseUrl: 'https://api.ikuncode.cc/v1', apiMode: 'codex_responses', models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra'] },
  { label: 'Codex-apikey.fun', value: 'fun-codex', builtin: true, selectable: false, baseUrl: 'https://api.apikey.fun/v1', apiMode: 'codex_responses', models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'] },
  { label: 'Claude-apikey.fun', value: 'fun-claude', builtin: true, selectable: false, baseUrl: 'https://api.apikey.fun', apiMode: 'anthropic_messages', models: ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'] },
  { label: 'LM Studio', value: 'lmstudio', builtin: true, baseUrl: 'http://127.0.0.1:1234/v1', apiMode: 'chat_completions', models: [] },
  { label: 'Anthropic', value: 'anthropic', builtin: true, baseUrl: 'https://api.anthropic.com', apiMode: 'anthropic_messages', models: ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
  { label: 'Claude OAuth', value: 'claude-oauth', builtin: true, baseUrl: 'https://api.anthropic.com', apiMode: 'anthropic_messages', authType: 'claude-pkce', models: ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'] },
  { label: 'Google AI Studio', value: 'gemini', builtin: true, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiMode: 'chat_completions', models: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'] },
  { label: 'Google Gemini OAuth', value: 'google-gemini-cli', builtin: true, baseUrl: 'cloudcode-pa://google', apiMode: 'chat_completions', authType: 'gemini-loopback', models: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview'] },
  { label: 'DeepSeek', value: 'deepseek', builtin: true, baseUrl: 'https://api.deepseek.com', apiMode: 'chat_completions', models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'] },
  { label: 'Z.AI / GLM', value: 'zai', builtin: true, baseUrl: 'https://api.z.ai/api/paas/v4', apiMode: 'chat_completions', models: ['glm-5.1', 'glm-5', 'glm-5v-turbo', 'glm-5-turbo', 'glm-4.7', 'glm-4.5', 'glm-4.5-flash'] },
  { label: 'GLM-Coding-Plan', value: 'glm', builtin: true, baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', apiMode: 'chat_completions', models: ['glm-5.2', 'glm-5.1', 'glm-5v-turbo', 'glm-4.7'] },
  { label: 'Kimi for Coding', value: 'kimi-coding', builtin: true, baseUrl: 'https://api.kimi.com/coding/v1', apiMode: 'chat_completions', models: ['kimi-k2.6', 'kimi-k2.5', 'kimi-for-coding', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo'] },
  { label: 'OpenRouter', value: 'openrouter', builtin: true, baseUrl: 'https://openrouter.ai/api/v1', apiMode: 'chat_completions', models: [] },
  { label: 'OpenAI API', value: 'openai-api', builtin: true, baseUrl: 'https://api.openai.com/v1', apiMode: 'codex_responses', models: ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.3-codex', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'] },
  { label: 'OpenAI Codex', value: 'openai-codex', builtin: true, baseUrl: 'https://chatgpt.com/backend-api/codex', apiMode: 'codex_responses', authType: 'codex-device', models: ['gpt-5.5', 'gpt-5.4-mini'] },
];

const defaultSpaceTheme = {
  accentColor: '#dce8e3',
  sidebarBg: '#f3f7f5',
  opacity: 0.74,
  noise: 0.01,
  texture: 0.03,
  mode: 'soft',
  gradientColors: [{ id: 'primary', color: '#dce8e3', x: 0.5, y: 0.5, isPrimary: true }],
  appearance: 'light',
};
function normalizeProviderPreset(raw = {}) {
  const value = String(raw.value || '').trim();
  return {
    label: String(raw.label || value).trim(),
    value,
    builtin: raw.builtin !== false,
    selectable: raw.selectable !== false && !compatibilityOnlyProviderKeys.has(value),
    baseUrl: String(raw.baseUrl || raw.base_url || '').trim(),
    apiMode: normalizeApiMode(raw.apiMode || raw.api_mode || (value === 'openai-codex' ? 'codex_responses' : '')),
    ...(providerAuthTypeMap[value] ? { authType: providerAuthTypeMap[value] } : {}),
    models: Array.isArray(raw.models) ? raw.models.map((model) => String(model || '').trim()).filter(Boolean) : [],
  };
}
function withCompatibilityProviderPresets(rawPresets = []) {
  const presets = rawPresets.map(normalizeProviderPreset);
  const knownKeys = new Set(presets.map((preset) => preset.value));
  for (const fallback of fallbackProviderPresets) {
    if (!compatibilityOnlyProviderKeys.has(fallback.value) || knownKeys.has(fallback.value)) continue;
    presets.push(normalizeProviderPreset(fallback));
  }
  return presets;
}
function loadProviderPresets() {
  try {
    if (!externalProviderPresetSource) throw new Error('No external provider preset source configured.');
    const source = readFileSync(externalProviderPresetSource, 'utf8');
    const match = source.match(/export const PROVIDER_PRESETS: ProviderPreset\[] = (\[[\s\S]*?\n\])/);
    if (!match) throw new Error('PROVIDER_PRESETS not found');
    return withCompatibilityProviderPresets(Function(`return ${match[1]}`)());
  } catch {
    return withCompatibilityProviderPresets(fallbackProviderPresets);
  }
}
const oauthProviderKeys = new Set(Object.keys(providerAuthTypeMap));
const codexAuthSessions = new Map();
const claudeAuthSessions = new Map();
const geminiAuthSessions = new Map();
const oauthPollMaxMs = 15 * 60 * 1000;
const codexClientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
const codexDeviceAuthUrl = 'https://auth.openai.com/api/accounts/deviceauth/usercode';
const codexDeviceTokenUrl = 'https://auth.openai.com/api/accounts/deviceauth/token';
const codexOAuthTokenUrl = 'https://auth.openai.com/oauth/token';
const codexRedirectUri = 'https://auth.openai.com/deviceauth/callback';
const codexVerificationUrl = 'https://auth.openai.com/codex/device';
const claudeClientId = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const claudeAuthorizeUrl = 'https://claude.ai/oauth/authorize';
const claudeTokenUrl = 'https://console.anthropic.com/v1/oauth/token';
const claudeRedirectUri = 'https://console.anthropic.com/oauth/code/callback';
const claudeScopes = 'org:create_api_key user:profile user:inference';
const geminiProviderKey = 'google-gemini-cli';
const geminiRedirectHost = '127.0.0.1';
const geminiCallbackBindHost = process.env.HERMES_WEB_UI_GEMINI_CALLBACK_BIND_HOST?.trim() || geminiRedirectHost;
const geminiRedirectPort = 8085;
const geminiRedirectPath = '/oauth2callback';
const googleAuthEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
const googleTokenEndpoint = 'https://oauth2.googleapis.com/token';
const googleUserInfoEndpoint = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json';
const googleClientId = process.env.HERMES_GEMINI_CLIENT_ID?.trim() || `681255809395-${['oo8ft2opr', 'drnp9e3a', 'qf6av3h', 'mdib135j'].join('')}.apps.googleusercontent.com`;
const googleClientSecret = process.env.HERMES_GEMINI_CLIENT_SECRET?.trim() || '';
const googleScopes = ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'].join(' ');
const modelPricingDefaults = [
  { pattern: /gpt-5/i, input: 1.25, output: 10, cacheRead: 0.125, cacheCreation: 1.25 },
  { pattern: /gpt-4\.1|gpt-4o/i, input: 2.5, output: 10, cacheRead: 1.25, cacheCreation: 2.5 },
  { pattern: /o3|o4/i, input: 2, output: 8, cacheRead: 0.5, cacheCreation: 2 },
  { pattern: /claude.*opus/i, input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
  { pattern: /claude.*sonnet/i, input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
  { pattern: /deepseek/i, input: 0.27, output: 1.1, cacheRead: 0.07, cacheCreation: 0.27 },
  { pattern: /gemini.*pro/i, input: 1.25, output: 10, cacheRead: 0.31, cacheCreation: 1.25 },
  { pattern: /gemini.*flash/i, input: 0.3, output: 2.5, cacheRead: 0.075, cacheCreation: 0.3 },
];

const defaultVaultPath =
  process.env.OBSIDIAN_VAULT ||
  defaultProjectsRoot;

const localSecurity = createLocalSecurity({ port, development: process.env.FRAKIO_WORK_PACKAGED !== '1' });
app.use(cors(localSecurity.corsOptions));
app.use(express.json({ limit: '10mb' }));
app.get('/api/session', localSecurity.sessionRoute);
app.use('/api', localSecurity.protect);

app.post('/api/attachments', express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }), async (req, res) => {
  try {
    const attachment = await attachmentStore.save({
      name: String(req.query.name || ''),
      mimeType: String(req.headers['content-type'] || ''),
      data: req.body,
    });
    res.status(201).json({ attachment });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error), code: error.code || '' });
  }
});

app.get('/api/attachments/:id/content', async (req, res) => {
  try {
    const { metadata, filePath, inline } = await attachmentStore.content(req.params.id);
    res.type(metadata.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(metadata.size));
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(metadata.name)}`);
    await pipeline(createReadStream(filePath), res);
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    res.status(error.status || 500).json({ error: String(error?.message || error), code: error.code || '' });
  }
});

app.delete('/api/attachments/:id', async (req, res) => {
  try {
    await attachmentStore.removeDraft(req.params.id);
    res.json({ ok: true, deletedAttachmentId: req.params.id });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error), code: error.code || '' });
  }
});

app.use('/api/attachments', (error, _req, res, next) => {
  if (error?.status === 413 || error?.type === 'entity.too.large') {
    return res.status(413).json({ error: '单个附件不能超过 32 MiB。', code: 'attachment_too_large' });
  }
  return next(error);
});

const legacyDemoAgents = [
  { id: 'iris', name: 'Iris', role: '书记官 / 默认入口', model: 'Hermes default', color: '#2563eb', soul: '冷静、细致，负责把混乱需求变成可执行 brief。', scope: '理解意图、整理 brief、记录结论、维护上下文。', source: 'demo' },
  { id: 'max', name: 'Max', role: 'CEO / 调度裁决', model: 'Hermes reasoning', color: '#111827', soul: '判断优先级，压住复杂度，只推动下一步可确认动作。', scope: '拆解目标、分派 Agent、处理冲突、形成最终裁决。', source: 'demo' },
  { id: 'nora', name: 'Nora', role: '电商总监', model: 'Hermes commerce', color: '#0f766e', soul: '站在生意结果看产品、用户、转化和售后。', scope: '选品、Listing、店铺运营、客服、产品商业判断。', source: 'demo' },
  { id: 'kai', name: 'Kai', role: '营销总监', model: 'Hermes growth', color: '#b45309', soul: '把商业判断转成内容、SEO、广告和传播角度。', scope: '内容、SEO、广告、红人、传播角度和用户洞察。', source: 'demo' },
  { id: 'leo', name: 'Leo', role: '设计总监', model: 'Hermes vision', color: '#7c3aed', soul: '负责让品牌视觉、商品图和视频 brief 可落地。', scope: '品牌、视觉、素材、图片和视频生成 brief。', source: 'demo' },
  { id: 'victor', name: 'Victor', role: '技术总监', model: 'Hermes technical', color: '#475569', soul: '守住技术边界，处理建站、自动化和发布风险。', scope: '建站、自动化、数据同步、Shopify 发布和技术风险。', source: 'demo' },
];

const legacyDefaultModels = [
  { id: 'model_default_deepseek_v4_flash', name: 'DeepSeek chat', provider: 'DeepSeek', kind: 'official', protocol: 'OpenAI Compatible', model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro', 'deepseek-v4-flash'], baseUrl: 'https://api.deepseek.com', apiKey: '', apiKeyState: '', source: 'default', pricing: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheCreation: 0.27 } },
  { id: 'model_hermes_default', name: 'Hermes default', provider: 'Hermes', kind: 'official', protocol: 'OpenAI Compatible', model: 'hermes-default', baseUrl: '', apiKey: '', source: 'demo' },
  { id: 'model_hermes_reasoning', name: 'Hermes reasoning', provider: 'Hermes', kind: 'official', protocol: 'OpenAI Compatible', model: 'hermes-reasoning', baseUrl: '', apiKey: '', source: 'demo' },
  { id: 'model_hermes_commerce', name: 'Hermes commerce', provider: 'Hermes', kind: 'official', protocol: 'OpenAI Compatible', model: 'hermes-commerce', baseUrl: '', apiKey: '', source: 'demo' },
  { id: 'model_hermes_growth', name: 'Hermes growth', provider: 'Hermes', kind: 'official', protocol: 'OpenAI Compatible', model: 'hermes-growth', baseUrl: '', apiKey: '', source: 'demo' },
  { id: 'model_hermes_vision', name: 'Hermes vision', provider: 'Hermes', kind: 'official', protocol: 'OpenAI Compatible', model: 'hermes-vision', baseUrl: '', apiKey: '', source: 'demo' },
  { id: 'model_hermes_technical', name: 'Hermes technical', provider: 'Hermes', kind: 'official', protocol: 'OpenAI Compatible', model: 'hermes-technical', baseUrl: '', apiKey: '', source: 'demo' },
];

const workflows = {
  council: ['Iris 接收需求', 'Max 拆解任务', '相关 Agent 协作', '生成待确认动作'],
  knowledge: ['读取 Obsidian 规则', '检索项目资料', '回答并显示来源'],
};
const defaultCouncilWorkflowSignature = workflows.council.join('\u0000');
const legacyWelcomeMessages = [
  { id: 'start-iris', agentId: 'iris', agentName: 'Iris', role: '书记官 / 默认入口', content: 'Workspace 已开启。我会先把需求整理成可执行 brief，再交给 Max 判断是否需要更多 Agent 参与。' },
  { id: 'start-max', agentId: 'max', agentName: 'Max', role: 'CEO / 调度裁决', content: '第一版按简单原则运行：能用一个 Workspace 解决，就不新增实体。能用确认队列解决，就不把权限散到各功能里。' },
];

const defaultPinnedNav = {
  knowledge: true,
  channels: true,
  kanban: true,
  jobs: true,
  models: true,
  org: true,
};

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function uniquePathEntries(entries) {
  const seen = new Set();
  return entries
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .filter((entry) => {
      if (seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
}

function runtimePathEntries() {
  const nodeExecDir = process.execPath ? path.dirname(process.execPath) : '';
  const bundledRuntime = findFrakioHermesRuntimeSync();
  const bundledNodeDir = bundledRuntime?.node ? path.dirname(bundledRuntime.node) : '';
  const bundledPythonBin = bundledRuntime?.python ? path.dirname(bundledRuntime.python) : '';
  return uniquePathEntries([
    path.join(appRoot, 'node_modules', '.bin'),
    path.join(projectRoot, 'node_modules', '.bin'),
    bundledNodeDir,
    bundledPythonBin,
    nodeExecDir,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, '.npm-global', 'bin'),
    ...String(process.env.PATH || '').split(path.delimiter),
  ]);
}

function runtimeEnv(extra = {}) {
  const extraPath = String(extra.PATH || '').split(path.delimiter);
  return {
    ...process.env,
    ...extra,
    PATH: uniquePathEntries([...runtimePathEntries(), ...extraPath]).join(path.delimiter),
  };
}

async function resolveRuntimeCommand(command) {
  const clean = String(command || '').trim();
  if (!clean) return '';
  if (path.isAbsolute(clean)) return await exists(clean) ? clean : '';
  if (clean.includes('/') || clean.includes('\\')) {
    const resolved = path.resolve(projectRoot, clean);
    return await exists(resolved) ? resolved : '';
  }
  return resolvePlatformCommand(clean, { cwd: projectRoot, env: runtimeEnv() });
}

function hermesRuntimePlatformDir() {
  return runtimePlatformDir();
}

function hermesPythonCandidates(runtimeDir) {
  return runtimePythonCandidates(runtimeDir);
}

function hermesNodeCandidate(runtimeDir) {
  return runtimeNodeCandidate(runtimeDir);
}

function defaultRuntimeRegistry() {
  return { schema: 1, activeVersion: '', previousVersion: '', runtimes: [], updatedAt: '' };
}

function readRuntimeRegistrySync() {
  try {
    const parsed = JSON.parse(readFileSync(frakioRuntimeRegistryPath, 'utf8'));
    return {
      ...defaultRuntimeRegistry(),
      ...parsed,
      runtimes: Array.isArray(parsed?.runtimes) ? parsed.runtimes : [],
    };
  } catch {
    return defaultRuntimeRegistry();
  }
}

async function writeRuntimeRegistry(registry) {
  await mkdir(path.dirname(frakioRuntimeRegistryPath), { recursive: true });
  const next = { ...defaultRuntimeRegistry(), ...registry, schema: 1, updatedAt: now() };
  const temporary = `${frakioRuntimeRegistryPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, frakioRuntimeRegistryPath);
  return next;
}

function readRuntimeManifestSync(runtimeDir) {
  try {
    return JSON.parse(readFileSync(path.join(runtimeDir, 'runtime-manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

function runtimeCandidateDirs(root) {
  const clean = String(root || '').trim();
  if (!clean) return [];
  const platformDir = hermesRuntimePlatformDir();
  const dirs = [];
  if (existsSync(hermesPythonCandidates(clean)[0]) || existsSync(hermesPythonCandidates(clean)[1])) dirs.push(clean);
  for (const version of versionedDirsSync(clean)) dirs.push(path.join(clean, version, platformDir));
  return Array.from(new Set(dirs));
}

function inspectHermesRuntimeDir(runtimeDir, source) {
  const python = hermesPythonCandidates(runtimeDir).find((candidate) => existsSync(candidate)) || '';
  if (!python) return null;
  const node = existsSync(hermesNodeCandidate(runtimeDir)) ? hermesNodeCandidate(runtimeDir) : '';
  const manifest = readRuntimeManifestSync(runtimeDir);
  const pythonLib = path.join(runtimeDir, 'python', 'lib');
  const sitePackages = runtimePythonSitePackagesCandidates(runtimeDir)
    .find((candidate) => existsSync(path.join(candidate, 'run_agent.py'))) || (existsSync(pythonLib)
    ? readdirSync(pythonLib, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('python'))
      .map((entry) => path.join(pythonLib, entry.name, 'site-packages'))
      .find((candidate) => existsSync(path.join(candidate, 'run_agent.py')))
    : '');
  return {
    source,
    runtimeDir,
    pythonRoot: sitePackages || path.join(runtimeDir, 'python'),
    python,
    node,
    version: String(manifest?.hermesAgentVersion || path.basename(path.dirname(runtimeDir))),
    platform: path.basename(runtimeDir),
    manifest,
    bridgeProtocolVersion: Number(manifest?.bridgeProtocolVersion || 1),
  };
}

let runtimeFallbackReason = '';

function findFrakioHermesRuntimeSync() {
  runtimeFallbackReason = '';
  for (const runtimeDir of runtimeCandidateDirs(process.env.FRAKIO_WORK_HERMES_RUNTIME)) {
    const runtime = inspectHermesRuntimeDir(runtimeDir, 'override');
    if (runtime) return runtime;
  }

  const registry = readRuntimeRegistrySync();
  if (registry.activeVersion) {
    const registered = registry.runtimes.find((item) => item?.version === registry.activeVersion && item?.platform === hermesRuntimePlatformDir());
    const candidates = uniquePathEntries([
      registered?.runtimeDir,
      path.join(frakioManagedHermesRuntimeRoot, registry.activeVersion, hermesRuntimePlatformDir()),
    ]);
    for (const runtimeDir of candidates) {
      const runtime = inspectHermesRuntimeDir(runtimeDir, 'managed');
      if (runtime && runtime.bridgeProtocolVersion === frakioBridgeProtocolVersion) return runtime;
    }
    runtimeFallbackReason = `用户 Runtime ${registry.activeVersion} 不可用或与当前 Bridge 不兼容，已回退到内置 Runtime。`;
  }

  const bundledRoots = uniquePathEntries([
    frakioBundledHermesRuntimeRoot,
    path.join(projectRoot, 'runtime', 'hermes'),
  ]);
  for (const root of bundledRoots) {
    for (const runtimeDir of runtimeCandidateDirs(root)) {
      const runtime = inspectHermesRuntimeDir(runtimeDir, 'bundled');
      if (runtime) return runtime;
    }
  }
  return null;
}

async function findFrakioHermesRuntime() {
  return findFrakioHermesRuntimeSync();
}

function findFrakioBridgeScriptSync() {
  const bundledCandidates = [
    path.join(frakioBundledBridgeRoot, 'hermes_bridge.py'),
    path.join(projectRoot, 'runtime', 'agent-bridge', 'python', 'hermes_bridge.py'),
  ];
  for (const candidate of bundledCandidates) {
    if (existsSync(candidate)) return { path: candidate, source: 'bundled' };
  }
  const override = process.env.HERMES_AGENT_BRIDGE_SCRIPT;
  if (override && existsSync(override)) return { path: override, source: 'override' };
  return null;
}

async function findFrakioBridgeScript() {
  return findFrakioBridgeScriptSync();
}

function redactRuntimeLog(value) {
  return String(value || '')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/(api[_-]?key["'\s:=]+)([^"'\s,}]+)/gi, '$1***')
    .replace(/(authorization["'\s:=]+bearer\s+)([^"'\s,}]+)/gi, '$1***');
}

function pushRuntimeLog(logs, line) {
  const clean = redactRuntimeLog(line).replace(/\s+/g, ' ').trim();
  if (!clean) return;
  logs.push(clean);
  if (logs.length > 80) logs.splice(0, logs.length - 80);
}

function runtimeApiLogPath() {
  return path.join(frakioWorkHome, 'logs', 'runtime-api.log');
}

function attachRuntimeProcessLogs(child, logFile, logs) {
  mkdirSync(path.dirname(logFile), { recursive: true });
  const stream = createWriteStream(logFile, { flags: 'a' });
  const writeChunk = (source, chunk) => {
    const text = redactRuntimeLog(chunk);
    stream.write(text);
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) pushRuntimeLog(logs, `${source}: ${line}`);
    }
  };
  child.stdout?.on('data', (chunk) => writeChunk('stdout', chunk));
  child.stderr?.on('data', (chunk) => writeChunk('stderr', chunk));
  child.on('exit', (code, signal) => {
    const line = `Frakio Work Runtime API exited code=${code ?? ''} signal=${signal ?? ''}`;
    pushRuntimeLog(logs, line);
    stream.write(`${line}\n`);
    stream.end();
  });
  child.on('error', (error) => {
    const line = `Frakio Work Runtime API spawn failed: ${error.message}`;
    pushRuntimeLog(logs, line);
    stream.write(`${line}\n`);
  });
}

async function isTcpPortFree(portNumber, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(portNumber, host);
  });
}

async function findFreeTcpPort(startPort = 8642, host = '127.0.0.1') {
  for (let nextPort = Number(startPort) || 8642; nextPort <= 65535; nextPort += 1) {
    if (await isTcpPortFree(nextPort, host)) return nextPort;
  }
  throw new Error(`No free local TCP port found from ${startPort}.`);
}

async function runtimeToolDiagnostics() {
  const names = ['node', 'npm', 'npx', 'uv', 'python3'];
  const tools = {};
  for (const name of names) {
    const resolved = await resolveRuntimeCommand(name);
    tools[name] = { command: name, path: resolved, available: Boolean(resolved) };
  }
  return tools;
}

function workbenchMcpDiagnostics(profileName = 'default') {
  return {
    profileName,
    servers: {
      'hermes-workbench-api': publicMcpServer('hermes-workbench-api', workbenchMcpServerConfig('api', profileName)),
      'hermes-workbench-use': publicMcpServer('hermes-workbench-use', workbenchMcpServerConfig('use', profileName)),
    },
  };
}

function mcpCommandMissingMessage(profileName, serverName, command) {
  return `Hermes Profile「${profileName || 'default'}」的 MCP server「${serverName}」启动失败：找不到命令「${command}」。请安装 Node/npm，或把 MCP command 改成绝对路径。`;
}

async function findMissingMcpCommands(profileName = 'default') {
  const cleanProfile = slug(profileName || 'default');
  const config = await readYamlFile(mcpConfigPathForProfile(cleanProfile));
  const servers = config.mcp_servers && typeof config.mcp_servers === 'object' ? config.mcp_servers : {};
  const missing = [];
  for (const [name, serverConfig] of Object.entries(servers)) {
    if (!serverConfig || serverConfig.enabled === false || mcpTransportFromConfig(serverConfig) !== 'stdio') continue;
    const command = String(serverConfig.command || '').trim();
    if (!command) {
      missing.push({ profileName: cleanProfile, serverName: name, command: '', message: `Hermes Profile「${cleanProfile}」的 MCP server「${name}」缺少 command。` });
      continue;
    }
    const resolved = await resolveRuntimeCommand(command);
    if (!resolved) missing.push({ profileName: cleanProfile, serverName: name, command, message: mcpCommandMissingMessage(cleanProfile, name, command) });
  }
  return missing;
}

function enrichMissingExecutableError(message, profileName = 'default') {
  const text = String(message || '');
  const command = text.match(/No such file or directory:\s*['"]([^'"]+)['"]/i)?.[1]
    || text.match(/\[Errno 2\]\s*No such file or directory:\s*['"]([^'"]+)['"]/i)?.[1]
    || '';
  if (!command) return text;
  return `Hermes Profile「${profileName}」运行时找不到命令「${command}」。请安装对应依赖，或把 MCP command 改成绝对路径。\n\n原始错误：${text}`;
}

function hermesRuntimeErrorDetails(error, profileName = 'default') {
  const text = String(error?.message || error || '');
  const response = error?.response && typeof error.response === 'object' ? error.response : {};
  const command = text.match(/找不到命令「([^」]+)」/)?.[1]
    || text.match(/No such file or directory:\s*['"]([^'"]+)['"]/i)?.[1]
    || text.match(/\[Errno 2\]\s*No such file or directory:\s*['"]([^'"]+)['"]/i)?.[1]
    || '';
  const missingExecutable = Boolean(command || /No such file or directory|FileNotFoundError|\[Errno 2\]/i.test(text) || /FileNotFoundError/i.test(String(response.error_type || '')));
  return {
    profileName,
    command,
    serverName: error?.details?.serverName || '',
    bridgePid: null,
    errorType: response.error_type || error?.code || '',
    missingExecutable,
    raw: text,
  };
}

function normalizeUserProfile(value = {}) {
  const nickname = String(value.nickname || '').trim().slice(0, 80);
  const avatarUrl = String(value.avatarUrl || '').trim();
  return {
    avatarUrl,
    nickname,
    bio: String(value.bio || '').trim().slice(0, 1200),
    age: String(value.age || '').trim().slice(0, 40),
    hobbies: String(value.hobbies || '').trim().slice(0, 600),
    occupation: String(value.occupation || '').trim().slice(0, 600),
    defaultAgentAddress: String(value.defaultAgentAddress || '').trim().slice(0, 80),
    otherAgentAddress: String(value.otherAgentAddress || '').trim().slice(0, 80),
    completedAt: avatarUrl && nickname ? String(value.completedAt || now()) : '',
    updatedAt: String(value.updatedAt || ''),
  };
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return new Date().toISOString();
}

function captureTelemetry(eventName, properties = {}, options = {}) {
  void telemetry.capture(eventName, properties, options).catch(() => {});
}

function captureMeaningfulActivity(action) {
  void telemetry.captureMeaningfulActivity(action).catch(() => {});
}

function telemetryDurationBucket(startedAt) {
  const start = Date.parse(String(startedAt || ''));
  const ms = Number.isFinite(start) ? Math.max(0, Date.now() - start) : 0;
  if (ms < 10_000) return 'under_10s';
  if (ms < 60_000) return '10s_1m';
  if (ms < 300_000) return '1m_5m';
  if (ms < 1_800_000) return '5m_30m';
  return 'over_30m';
}

function telemetryErrorCode(error) {
  const explicit = String(error?.code || error?.details?.errorType || '').trim().toUpperCase();
  if (/^[A-Z0-9_]{2,48}$/.test(explicit)) return explicit.toLowerCase();
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403) return 'authorization_failed';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'runtime_unavailable';
  return 'unknown_error';
}

function runTelemetryProperties(thread) {
  const workflow = Array.isArray(thread?.workflowState) ? thread.workflowState : [];
  return {
    duration_bucket: telemetryDurationBucket(thread?.activeRunStartedAt),
    tool_count: workflow.filter((step) => String(step?.source || '').toLowerCase().includes('tool')).length,
    approval_count: workflow.filter((step) => String(step?.source || '').toLowerCase().includes('approval')).length,
  };
}

function defaultState() {
  return {
    version: 2,
    ui: { libraryCollapsed: false, pinnedNav: defaultPinnedNav, defaultAgentId: '', defaultModel: '', density: 'comfortable', streamingResponses: true, showReasoning: true, telemetryEnabled: false, telemetryNoticeSeenAt: '', agentMentionMaxDepth: 2 },
    userProfile: { avatarUrl: '', nickname: '', bio: '', age: '', hobbies: '', occupation: '', defaultAgentAddress: '', otherAgentAddress: '', completedAt: '', updatedAt: '' },
    observability: { modelUsage: [], modelRuns: [], systemEvents: [] },
    integrations: {
      hermesStudio: {
        detectedUrl: '',
        lastCheckedAt: null,
        selectedProfile: 'default',
        importedProfileNames: [],
        authMode: 'none',
      },
      hermesAgent: {
        installPath: hermesHome,
        sourcePath: hermesAgentSourcePath,
        apiBaseUrl: 'http://127.0.0.1:8642/v1',
        apiStatus: 'unknown',
        selectedProfile: 'default',
        lastCheckedAt: null,
        approvalMode: 'manual',
        gatewayAutoStart: { enabled: true, management: 'per_profile', include: [], exclude: [] },
      },
    },
    defaultVaultId: null,
    agents: [],
    models: [],
    spaces: [{ id: 'space_default', name: 'Frakio Work', iconKind: 'dot', iconValue: '', theme: defaultSpaceTheme, archivedAt: null, createdAt: now(), updatedAt: now(), lastOpenedAt: now() }],
    workspaces: [{ id: 'workspace_default', spaceId: 'space_default', name: 'Frakio Work', rootPath: defaultVaultPath, vaultId: null, environment: 'local', activeThreadId: null, archivedAt: null, pinnedAt: null, createdAt: now(), updatedAt: now() }],
    vaults: [],
    threads: [],
  };
}

async function readState() {
  const stored = await readJsonWithRecovery(statePath, () => null);
  if (!stored) {
    const state = defaultState();
    await writeState(state);
    return state;
  }
  return normalizeState(stored);
}

async function readSecrets() {
  return readJsonWithRecovery(secretsPath, () => ({ models: {} }));
}

async function writeSecrets(secrets) {
  await writeSecretsJson({ models: secrets.models || {} });
}

async function getModelSecret(modelId) {
  const secrets = await readSecrets();
  return String(secrets.models?.[modelId]?.apiKey || '').trim();
}

async function getReusableModelSecret(selectedModel, models = []) {
  if (!selectedModel?.id) return '';
  const direct = await getModelSecret(selectedModel.id);
  if (direct) return direct;
  const sameBaseUrl = normalizeModels(models || []).find((model) => model.id !== selectedModel.id && model.baseUrl && model.baseUrl === selectedModel.baseUrl);
  return sameBaseUrl?.id ? await getModelSecret(sameBaseUrl.id) : '';
}

async function setModelSecret(modelId, apiKey) {
  const clean = String(apiKey || '').trim();
  if (!clean) return;
  const secrets = await readSecrets();
  secrets.models = secrets.models || {};
  secrets.models[modelId] = { apiKey: clean, updatedAt: now() };
  await writeSecrets(secrets);
}

async function deleteModelSecret(modelId) {
  const secrets = await readSecrets();
  if (secrets.models?.[modelId]) {
    delete secrets.models[modelId];
    await writeSecrets(secrets);
  }
}

function resolveDefaultAgentId(state, agents = state.agents || []) {
  const ids = new Set((agents || []).map((agent) => agent.id));
  const preferred = state?.ui?.defaultAgentId;
  if (ids.has(preferred)) return preferred;
  if (ids.has('iris')) return 'iris';
  return agents[0]?.id || '';
}

function mixHexWithColor(hexValue, targetValue, targetRatio) {
  const hex = /^#[0-9a-fA-F]{6}$/;
  const source = hex.test(String(hexValue || '')) ? String(hexValue) : defaultSpaceTheme.accentColor;
  const target = hex.test(String(targetValue || '')) ? String(targetValue) : '#11131a';
  const ratio = Math.max(0, Math.min(1, Number(targetRatio) || 0));
  const read = (value, offset) => Number.parseInt(value.slice(offset, offset + 2), 16);
  const channel = (offset) => Math.round(read(source, offset) * (1 - ratio) + read(target, offset) * ratio).toString(16).padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function normalizeSpaceThemePalette(theme = {}, fallback = defaultSpaceTheme) {
  const hex = /^#[0-9a-fA-F]{6}$/;
  const accentColor = hex.test(String(theme.accentColor || '')) ? String(theme.accentColor) : fallback.accentColor;
  const sidebarBg = hex.test(String(theme.sidebarBg || '')) ? String(theme.sidebarBg) : fallback.sidebarBg;
  const sourceColors = Array.isArray(theme.gradientColors) ? theme.gradientColors : [];
  const gradientColors = sourceColors
    .filter((color) => hex.test(String(color?.color || '')))
    .slice(0, 3)
    .map((color, index) => ({
      id: String(color.id || `color_${index}`).slice(0, 32),
      color: String(color.color),
      x: Math.max(0, Math.min(1, Number.isFinite(Number(color.x)) ? Number(color.x) : (index === 0 ? 0.18 : index === 1 ? 0.62 : 0.38))),
      y: Math.max(0, Math.min(1, Number.isFinite(Number(color.y)) ? Number(color.y) : (index === 0 ? 0.72 : index === 1 ? 0.28 : 0.27))),
      isPrimary: Boolean(color.isPrimary),
    }));
  if (!gradientColors.length) gradientColors.push({ id: 'primary', color: accentColor, x: 0.18, y: 0.72, isPrimary: true });
  const primaryIndex = Math.max(0, gradientColors.findIndex((color) => color.isPrimary));
  const texture = Math.max(0, Math.min(1, Number(theme.texture ?? ((theme.noise ?? fallback.noise) / 0.35)) || 0));
  return {
    accentColor,
    sidebarBg,
    opacity: Math.max(0.3, Math.min(0.9, Number(theme.opacity ?? fallback.opacity) || fallback.opacity)),
    noise: Math.max(0, Math.min(0.35, Number(theme.noise ?? texture * 0.35) || 0)),
    texture,
    mode: theme.mode === 'crisp' ? 'crisp' : fallback.mode,
    gradientColors: gradientColors.map((color, index) => ({ ...color, isPrimary: index === primaryIndex })),
  };
}

function deriveDarkSpaceThemePalette(theme = defaultSpaceTheme) {
  const colors = (theme.gradientColors || defaultSpaceTheme.gradientColors).map((color) => ({
    ...color,
    color: mixHexWithColor(color.color, '#11131a', 0.46),
  }));
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  return {
    ...theme,
    accentColor: primary?.color || mixHexWithColor(theme.accentColor, '#11131a', 0.46),
    sidebarBg: mixHexWithColor(theme.sidebarBg || theme.accentColor, '#12151c', 0.68),
    opacity: Math.max(theme.opacity || defaultSpaceTheme.opacity, 0.76),
    mode: 'crisp',
    gradientColors: colors,
  };
}

function normalizeSpaceTheme(theme = {}) {
  const appearance = theme.appearance === 'auto' || theme.appearance === 'dark' || theme.appearance === 'light' ? theme.appearance : 'light';
  const legacyPalette = normalizeSpaceThemePalette(theme);
  const lightTheme = normalizeSpaceThemePalette(theme.lightTheme || legacyPalette, legacyPalette);
  const darkTheme = normalizeSpaceThemePalette(theme.darkTheme || deriveDarkSpaceThemePalette(lightTheme), deriveDarkSpaceThemePalette(lightTheme));
  const activePalette = appearance === 'dark' ? darkTheme : legacyPalette;
  return {
    ...activePalette,
    appearance,
    lightTheme,
    darkTheme,
  };
}

function normalizeSpace(space = {}, fallbackName = 'Frakio Work') {
  const iconKind = space.iconKind === 'icon' ? 'icon' : space.iconKind === 'emoji' ? 'emoji' : 'dot';
  return {
    id: space.id || id('space'),
    name: String(space.name || fallbackName).slice(0, 60),
    iconKind,
    iconValue: String(space.iconValue || '').slice(0, 16),
    theme: normalizeSpaceTheme(space.theme),
    archivedAt: space.archivedAt || null,
    createdAt: space.createdAt || now(),
    updatedAt: space.updatedAt || now(),
    lastOpenedAt: space.lastOpenedAt || null,
  };
}

function normalizeState(state) {
  const base = defaultState();
  const { divisions: _legacyDivisions, orgEdges: _legacyOrgEdges, ...stateWithoutDivisions } = state || {};
  const sourceAgents = Array.isArray(state.agents) ? state.agents : base.agents;
  const agents = sourceAgents.filter((agent) => !isSystemHermesProfile(agent.profileName, agent.id));
  const agentIds = new Set(agents.map((agent) => agent.id));
  const defaultAgentId = resolveDefaultAgentId(state, agents);
  const sourceVaults = Array.isArray(state.vaults) ? state.vaults : base.vaults;
  const sourceSpaces = state.spaces?.length ? state.spaces : base.spaces;
  const normalizedSpaces = sourceSpaces.map((space, index) => {
    const legacyDefault = space.id === 'space_default'
      && String(space.theme?.accentColor || '').toLowerCase() === '#8b8cf6'
      && String(space.theme?.sidebarBg || '').toLowerCase() === '#f3f4ff';
    return normalizeSpace(legacyDefault ? { ...space, theme: defaultSpaceTheme } : space, index === 0 ? 'Frakio Work' : 'Workspace');
  });
  const fallbackSpaceId = normalizedSpaces[0]?.id || 'space_default';
  const spaceIds = new Set(normalizedSpaces.map((space) => space.id));
  const activeSpaceId = spaceIds.has(state.ui?.activeSpaceId) ? state.ui.activeSpaceId : fallbackSpaceId;
  const sourceWorkspaces = state.workspaces?.length ? state.workspaces : base.workspaces;
  const normalizedWorkspaces = sourceWorkspaces.map((workspace) => {
    const hasVaultId = Object.prototype.hasOwnProperty.call(workspace, 'vaultId');
    const requestedVaultId = workspace.vaultId || workspace.defaultVaultId || workspace.vault_id;
    const vault = sourceVaults.find((item) => item.id === requestedVaultId)
      || (!hasVaultId ? sourceVaults.find((item) => item.id === state.defaultVaultId) || sourceVaults[0] : null);
    return {
      id: workspace.id || id('workspace'),
      spaceId: spaceIds.has(workspace.spaceId) ? workspace.spaceId : fallbackSpaceId,
      name: String(workspace.name || 'Frakio Work').slice(0, 60),
      rootPath: path.resolve(String(workspace.rootPath || workspace.path || vault?.path || projectRoot)),
      vaultId: hasVaultId ? (sourceVaults.some((item) => item.id === workspace.vaultId) ? workspace.vaultId : null) : vault?.id || null,
      environment: workspace.environment || 'local',
      activeThreadId: workspace.activeThreadId || null,
      archivedAt: workspace.archivedAt || null,
      pinnedAt: workspace.pinnedAt || null,
      createdAt: workspace.createdAt || now(),
      updatedAt: workspace.updatedAt || now(),
    };
  });
  const workspaceById = new Map(normalizedWorkspaces.map((workspace) => [workspace.id, workspace]));
  const normalizedModels = normalizeModels(Array.isArray(state.models) ? state.models : base.models).filter((model) => !isBadHermesStudioModel(model) && !isPlaceholderModel(model) && model.source !== 'hermes-profile');
  const defaultModel = normalizedModels.some((model) => model.id === state.ui?.defaultModel)
    ? state.ui.defaultModel
    : '';
  return {
    ...base,
    ...stateWithoutDivisions,
    version: 2,
    integrations: {
      ...base.integrations,
      ...(state.integrations || {}),
      hermesStudio: { ...base.integrations.hermesStudio, ...(state.integrations?.hermesStudio || {}) },
      hermesAgent: {
        ...base.integrations.hermesAgent,
        ...(state.integrations?.hermesAgent || {}),
        gatewayAutoStart: {
          ...base.integrations.hermesAgent.gatewayAutoStart,
          ...(state.integrations?.hermesAgent?.gatewayAutoStart || {}),
        },
      },
    },
    ui: {
      ...base.ui,
      ...(state.ui || {}),
      activeSpaceId,
      defaultAgentId,
      defaultModel,
      agentMentionMaxDepth: normalizeAgentMentionMaxDepth(state.ui?.agentMentionMaxDepth, 2),
      pinnedNav: { ...defaultPinnedNav, ...(state.ui?.pinnedNav || {}) },
    },
    userProfile: normalizeUserProfile(state.userProfile || base.userProfile),
    observability: {
      modelUsage: Array.isArray(state.observability?.modelUsage) ? state.observability.modelUsage.slice(-800) : [],
      modelRuns: Array.isArray(state.observability?.modelRuns) ? state.observability.modelRuns.slice(-200) : [],
      systemEvents: Array.isArray(state.observability?.systemEvents) ? state.observability.systemEvents.slice(-400) : [],
    },
    spaces: normalizedSpaces,
    workspaces: normalizedWorkspaces,
    models: normalizedModels,
    agents: agents.map((agent) => ({
      ...agent,
      soul: agent.soul || agent.scope || '',
      source: agent.source || 'demo',
      profileName: agent.profileName || '',
      gatewayStatus: agent.gatewayStatus || '',
      soulExcerpt: agent.soulExcerpt || '',
      userProfileExcerpt: agent.userProfileExcerpt || '',
      memoryExcerpt: agent.memoryExcerpt || '',
      userProfile: agent.userProfile || '',
      memory: agent.memory || '',
      providerSummary: Array.isArray(agent.providerSummary) ? agent.providerSummary : [],
      skills: Array.isArray(agent.skills) ? agent.skills : [],
      plugins: Array.isArray(agent.plugins) ? agent.plugins : [],
      avatarUrl: agent.avatarUrl || '',
    })),
    vaults: sourceVaults,
    threads: (Array.isArray(state.threads) ? state.threads : base.threads).map((thread) => {
      const hasVaultId = Object.prototype.hasOwnProperty.call(thread, 'vaultId');
      return {
      ...thread,
      spaceId: spaceIds.has(thread.spaceId)
        ? thread.spaceId
        : (workspaceById.get(thread.workspaceId)?.spaceId || activeSpaceId || fallbackSpaceId),
      mode: thread.mode || 'workspace',
      workspaceId: thread.mode === 'direct' ? null : (workspaceById.has(thread.workspaceId) ? thread.workspaceId : normalizedWorkspaces[0]?.id || null),
      primaryAgentId: agentIds.has(thread.primaryAgentId) ? thread.primaryAgentId : defaultAgentId,
      defaultAgentId: agentIds.has(thread.defaultAgentId) ? thread.defaultAgentId : defaultAgentId,
      activeAgentId: agentIds.has(thread.activeAgentId) ? thread.activeAgentId : (agentIds.has(thread.primaryAgentId) ? thread.primaryAgentId : defaultAgentId),
      followMode: thread.followMode === 'conversation' ? 'conversation' : 'default',
      vaultId: thread.mode === 'direct'
        ? null
        : hasVaultId
          ? (sourceVaults.some((item) => item.id === thread.vaultId) ? thread.vaultId : null)
          : (workspaceById.get(thread.workspaceId)?.vaultId || normalizedWorkspaces[0]?.vaultId || null),
      permissionMode: ['manual', 'smart', 'off'].includes(thread.permissionMode) ? thread.permissionMode : 'manual',
      selectedAgents: Array.isArray(thread.selectedAgents) ? thread.selectedAgents.filter((agentId) => agentIds.has(agentId)) : [],
      agentModelOverrides: normalizeAgentModelOverrides(thread.agentModelOverrides, agents, normalizedModels),
      agentRunOverrides: normalizeAgentRunOverrides(thread.agentRunOverrides, agents),
      workflow: Array.isArray(thread.workflow) ? thread.workflow : [],
      proposals: Array.isArray(thread.proposals) ? thread.proposals : [],
      messages: Array.isArray(thread.messages) ? thread.messages : [],
      engine: ['simulate', 'hermes-studio', 'model-provider', 'workspace-group', 'hermes-agent'].includes(thread.engine) ? thread.engine : 'simulate',
      externalSessionId: thread.externalSessionId || null,
      artifacts: Array.isArray(thread.artifacts) ? thread.artifacts : [],
      workflowState: Array.isArray(thread.workflowState) ? thread.workflowState : [],
      collaboration: normalizeCollaboration(thread.collaboration, { defaultAgentId, activeAgentId: thread.activeAgentId || thread.primaryAgentId }),
      runStatus: ['idle', 'running', 'failed'].includes(thread.runStatus) ? thread.runStatus : 'idle',
      archivedAt: thread.archivedAt || null,
      pinnedAt: thread.pinnedAt || null,
      updatedAt: thread.updatedAt || now(),
    };
    }),
  };
}

function normalizeCollaboration(collaboration = {}, fallback = {}) {
  return {
    kind: collaboration.kind || 'workspace-group-chat',
    lastMentionedAgentId: collaboration.lastMentionedAgentId || null,
    lastMentionedAgentName: collaboration.lastMentionedAgentName || '',
    activeAgentId: collaboration.activeAgentId || fallback.activeAgentId || fallback.defaultAgentId || null,
    maxMentionDepth: normalizeAgentMentionMaxDepth(collaboration.maxMentionDepth, 2),
    lastRoutedAt: collaboration.lastRoutedAt || null,
    lastRouteReason: collaboration.lastRouteReason || '',
  };
}

function normalizeAgentModelOverrides(overrides, agents = [], models = []) {
  const agentIds = new Set((agents || []).map((agent) => agent.id));
  const normalizedModels = normalizeModels(models || []);
  const normalized = [];
  for (const [agentId, rawSelection] of Object.entries(overrides || {})) {
    if (!agentIds.has(agentId)) continue;
    const { modelId, modelName } = splitModelSelection(String(rawSelection || ''));
    const model = normalizedModels.find((item) => item.id === modelId);
    if (!model) continue;
    const availableNames = normalizeModelNames(model.models, model.model);
    const selectedName = modelName || model.model || availableNames[0] || '';
    if (!selectedName || !availableNames.includes(selectedName)) continue;
    normalized.push([agentId, `${model.id}::${selectedName}`]);
  }
  return Object.fromEntries(normalized);
}

function normalizeAgentRunOverrides(overrides, agents = []) {
  const agentIds = new Set((agents || []).map((agent) => agent.id));
  const normalized = [];
  for (const [agentId, raw] of Object.entries(overrides && typeof overrides === 'object' ? overrides : {})) {
    if (!agentIds.has(agentId) || !raw || typeof raw !== 'object') continue;
    const reasoningEffortRaw = String(raw.reasoningEffort || '').trim().toLowerCase().slice(0, 40);
    const reasoningEffort = /^[a-z0-9_-]+$/.test(reasoningEffortRaw) && !['unsupported', 'unknown', 'default'].includes(reasoningEffortRaw) ? reasoningEffortRaw : '';
    const speedMode = String(raw.speedMode || raw.serviceTier || '').trim().toLowerCase().slice(0, 60);
    if (!reasoningEffort && !speedMode) continue;
    normalized.push([agentId, {
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(speedMode ? { speedMode } : {}),
    }]);
  }
  return Object.fromEntries(normalized);
}

function isStudioBaseUrl(baseUrl) {
  const value = String(baseUrl || '').replace('localhost', '127.0.0.1').replace(/\/$/, '');
  return /^http:\/\/127\.0\.0\.1:(8748|8648|8787)$/.test(value);
}

function isBadHermesStudioModel(model) {
  return model?.source === 'hermes-studio' && (isStudioBaseUrl(model.baseUrl) || String(model.id || '').startsWith('model_hermes_studio_'));
}

function isPlaceholderModel(model) {
  return String(model?.id || '').startsWith('model_hermes_') && !model?.baseUrl && ['Hermes', 'Custom'].includes(String(model?.provider || ''));
}

function comparableBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function verificationRoutePrefix(model) {
  return [String(model?.providerKey || '').trim(), String(model?.apiMode || '').trim(), comparableBaseUrl(model?.baseUrl)].join('::') + '::';
}

function credentialOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' ? url.origin.toLowerCase() : '';
  } catch {
    return '';
  }
}

function canReuseCredentialForBaseUrl(savedBaseUrl, requestedBaseUrl) {
  const savedOrigin = credentialOrigin(savedBaseUrl);
  return Boolean(savedOrigin && savedOrigin === credentialOrigin(requestedBaseUrl));
}

async function credentialForModelDraft(savedModel, requestedBaseUrl, explicitApiKey, models = []) {
  const provided = String(explicitApiKey || '').trim();
  if (provided) return provided;
  const reusable = await getReusableModelSecret(savedModel, models);
  if (!reusable) return '';
  if (!canReuseCredentialForBaseUrl(savedModel.baseUrl, requestedBaseUrl)) {
    throw Object.assign(new Error('Base URL 的地址已变化，请重新输入 API Key。'), { status: 400 });
  }
  return reusable;
}

function customProviderBaseName(model) {
  const provider = String(model?.provider || '').trim();
  const preferred = provider && !/^custom$/i.test(provider) ? provider : String(model?.name || '').trim();
  if (preferred) return slug(preferred);
  try {
    return slug(new URL(String(model?.baseUrl || '')).hostname.replace(/^api\./, ''));
  } catch {
    return slug(model?.id || 'provider');
  }
}

function normalizeModels(models) {
  const normalized = models.map((model) => ({
    id: model.id || id('model'),
    name: String(model.name || model.model || '自定义模型').trim().slice(0, 60),
    provider: String(model.provider || 'Custom').trim().slice(0, 40),
    kind: ['official', 'relay', 'local'].includes(model.kind) ? model.kind : 'official',
    protocol: ['OpenAI Compatible', 'Anthropic Compatible', 'Custom'].includes(model.protocol) ? model.protocol : 'OpenAI Compatible',
    model: String(model.model || '').trim().slice(0, 100),
    models: normalizeModelNames(model.models, model.model),
    baseUrl: String(model.baseUrl || '').trim().slice(0, 240),
    apiKey: '',
    apiKeyState: model.apiKeyState || (String(model.apiKey || '').trim() ? 'provided' : ''),
    source: ['demo', 'hermes-studio', 'hermes-profile', 'manual'].includes(model.source) ? model.source : 'manual',
    profileName: String(model.profileName || '').trim().slice(0, 80),
    providerKey: String(model.providerKey || '').trim().slice(0, 120),
    apiMode: normalizeApiMode(model.apiMode),
    modelsUrl: String(model.modelsUrl || '').trim().slice(0, 300),
    modelApiModes: normalizeModelApiModes(model.modelApiModes),
    compat: normalizeModelCompat(model.compat),
    modelCompat: normalizeModelCompatMap(model.modelCompat),
    contextLimit: Number.isFinite(Number(model.contextLimit)) ? Number(model.contextLimit) : null,
    capabilityMode: model.capabilityMode === 'manual' ? 'manual' : 'auto',
    capabilityOverrides: normalizeCapabilityOverrides(model.capabilityOverrides),
    pricing: normalizeModelPricing(model.pricing),
  }));
  const usedKeys = new Map();
  const presets = loadProviderPresets();
  for (const model of normalized) {
    if (comparableBaseUrl(model.baseUrl) === 'https://api.ikuncode.cc/v1') {
      model.providerKey = 'ikuncode';
      model.apiMode = 'codex_responses';
      model.protocol = 'OpenAI Compatible';
    }
    let providerKey = String(model.providerKey || '').trim();
    if (!providerKey && model.baseUrl) {
      const preset = presets.find((item) => comparableBaseUrl(item.baseUrl) === comparableBaseUrl(model.baseUrl));
      providerKey = preset?.value || `custom:${customProviderBaseName(model)}`;
    }
    if (providerKey) {
      const signature = `${comparableBaseUrl(model.baseUrl)}|${String(model.apiMode || '')}`;
      const existingSignature = usedKeys.get(providerKey);
      if (existingSignature && existingSignature !== signature && providerKey.startsWith('custom:')) {
        providerKey = `${providerKey}-${slug(model.id).slice(-6)}`;
      }
      usedKeys.set(providerKey, signature);
    }
    model.providerKey = providerKey.slice(0, 120);
  }
  return normalized;
}

function normalizeModelNames(models, fallback = '') {
  const rows = Array.isArray(models) ? models : [];
  const names = [...rows, fallback]
    .map((item) => String(item || '').trim().slice(0, 100))
    .filter(Boolean);
  return Array.from(new Set(names));
}

function normalizeModelPricing(pricing = {}) {
  const normalizePrice = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  return {
    input: normalizePrice(pricing.input),
    output: normalizePrice(pricing.output),
    cacheRead: normalizePrice(pricing.cacheRead),
    cacheCreation: normalizePrice(pricing.cacheCreation),
  };
}

function normalizeModelApiModes(value) {
  return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
    .map(([modelId, apiMode]) => [String(modelId || '').trim().slice(0, 100), normalizeApiMode(apiMode)])
    .filter(([modelId, apiMode]) => modelId && apiMode));
}

function normalizeModelCompat(value = {}) {
  const thinkingFormat = CHAT_THINKING_FORMATS.includes(value.thinkingFormat) ? value.thinkingFormat : 'openai';
  const requestOverrides = {};
  for (const [key, raw] of Object.entries(value.requestOverrides && typeof value.requestOverrides === 'object' ? value.requestOverrides : {})) {
    const normalizedKey = String(key || '').trim().slice(0, 80);
    if (!normalizedKey || /^(authorization|api[-_]?key|x-api-key|host|content-length|stream|stream_options|transfer-encoding|connection|proxy-authorization|x-forwarded-)/i.test(normalizedKey)) continue;
    requestOverrides[normalizedKey] = raw;
  }
  return { thinkingFormat, requestOverrides };
}

function normalizeModelCompatMap(value) {
  return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
    .map(([modelId, compat]) => [String(modelId || '').trim().slice(0, 100), normalizeModelCompat(compat)])
    .filter(([modelId]) => modelId));
}

function publicModel(model) {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    kind: model.kind,
    protocol: model.protocol,
    model: model.model,
    models: model.models || normalizeModelNames([], model.model),
    baseUrl: model.baseUrl,
    hasApiKey: Boolean(model.apiKeyState),
    source: model.source || 'manual',
    profileName: model.profileName || '',
    providerKey: model.providerKey || '',
    apiMode: model.apiMode || '',
    modelsUrl: model.modelsUrl || '',
    modelApiModes: normalizeModelApiModes(model.modelApiModes),
    compat: normalizeModelCompat(model.compat),
    modelCompat: normalizeModelCompatMap(model.modelCompat),
    contextLimit: model.contextLimit || null,
    capabilityMode: model.capabilityMode === 'manual' ? 'manual' : 'auto',
    capabilityOverrides: model.capabilityMode === 'manual' ? normalizeCapabilityOverrides(model.capabilityOverrides) : {},
    pricing: normalizeModelPricing(model.pricing),
  };
}

function slug(value) {
  return String(value || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}

function titleCaseProfile(profile) {
  if (profile === 'default') return 'Hermes Default';
  return profile.split(/[-_]/).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(' ') || profile;
}

function compactText(raw, limit = 520) {
  return String(raw || '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '---') return false;
      return !/(api[_-]?key|token|password|secret)\s*[:=]/i.test(trimmed);
    })
    .slice(0, 10)
    .join('\n')
    .slice(0, limit);
}

function fullProfileText(raw, limit = 12000) {
  return String(raw || '')
    .split('\n')
    .filter((line) => !/(api[_-]?key|token|password|secret)\s*[:=]/i.test(line.trim()))
    .join('\n')
    .trim()
    .slice(0, limit);
}

async function readProfileText(filePath, limit = 12000) {
  try {
    return fullProfileText(await readFile(filePath, 'utf8'), limit);
  } catch {
    return '';
  }
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function profileDirForName(profileName) {
  const clean = slug(profileName || '');
  if (!clean) return null;
  const candidates = clean === 'default'
    ? [path.join(hermesHome, 'profiles', 'default'), hermesHome]
    : [path.join(hermesHome, 'profiles', clean)];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!isInside(hermesHome, resolved)) continue;
    if (await exists(resolved)) return resolved;
  }
  return null;
}

async function findProfileAvatar(dir, profileName) {
  const assetsDir = path.join(dir, 'assets');
  try {
    const entries = await readdir(assetsDir, { withFileTypes: true });
    const avatar = entries.find((entry) => entry.isFile() && /^avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name));
    if (!avatar) return '';
    const avatarPath = path.join(assetsDir, avatar.name);
    const fileStat = await stat(avatarPath);
    return `/api/hermes-profiles/${encodeURIComponent(profileName)}/avatar?v=${Math.round(fileStat.mtimeMs)}`;
  } catch {
    return '';
  }
}

function compactOneLine(value, limit = 180) {
  return compactText(String(value || '').replace(/\s+/g, ' '), limit);
}

function isDefaultHermesSoul(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return text.startsWith('You are Hermes Agent, an intelligent AI assistant created by Nous Research.');
}

function usefulProfileText(value) {
  const text = String(value || '').trim();
  return text && !isDefaultHermesSoul(text) ? text : '';
}

function profileTextOrExisting(profileValue, existingValue = '') {
  const text = usefulProfileText(profileValue);
  return text || String(existingValue || '').trim();
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) || {};
  } catch {
    return {};
  }
}

function splitSkillMarkdown(raw) {
  const text = String(raw || '');
  if (!text.startsWith('---')) return { meta: {}, body: text };
  const endIndex = text.indexOf('\n---', 3);
  if (endIndex < 0) return { meta: {}, body: text };
  const frontmatter = text.slice(3, endIndex).trim();
  const body = text.slice(endIndex + 4).trim();
  try {
    return { meta: YAML.parse(frontmatter) || {}, body };
  } catch {
    return { meta: {}, body };
  }
}

function skillDescriptionFromMarkdown(raw) {
  const { meta, body } = splitSkillMarkdown(raw);
  const description = meta.description || meta.summary || '';
  if (description) return compactOneLine(description);
  const firstParagraph = body
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s+.*$/gm, '').trim())
    .find(Boolean);
  return compactOneLine(firstParagraph || '');
}

function skillNameFromMarkdown(raw, fallback) {
  const { meta } = splitSkillMarkdown(raw);
  return String(meta.name || fallback || '').trim() || fallback;
}

function skillCategoryFromName(name, filePath) {
  const relative = String(filePath || '').split('/skills/')[1] || '';
  const parts = relative.split('/').filter(Boolean);
  return parts.length > 2 ? parts[0] : 'local';
}

async function findFilesByName(root, fileName, maxDepth = 4) {
  const out = [];
  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.codex-plugin') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath, depth + 1);
      else if (entry.isFile() && entry.name === fileName) out.push(fullPath);
    }
  }
  await walk(root, 0);
  return out;
}

function disabledSkillsFromConfig(config) {
  return new Set(Array.isArray(config?.skills?.disabled) ? config.skills.disabled.map(String) : []);
}

function pluginStatusFromConfig(config, name) {
  const enabled = Array.isArray(config?.plugins?.enabled) ? config.plugins.enabled.map(String) : [];
  const disabled = Array.isArray(config?.plugins?.disabled) ? config.plugins.disabled.map(String) : [];
  if (disabled.includes(name)) return { enabled: false, status: 'disabled', statusLabel: '未启用' };
  if (enabled.includes(name)) return { enabled: true, status: 'enabled', statusLabel: '已启用' };
  return { enabled: false, status: 'installed', statusLabel: '已安装' };
}

async function editableSkillEntries(dir, config = {}) {
  const skillsDir = path.join(dir, 'skills');
  try {
    const skillFiles = await findFilesByName(skillsDir, 'SKILL.md', 4);
    const rows = [];
    const disabled = disabledSkillsFromConfig(config);
    const usage = await readJsonFile(path.join(skillsDir, '.usage.json'));
    for (const filePath of skillFiles) {
      const relative = path.relative(skillsDir, path.dirname(filePath));
      if (!relative || relative.startsWith('..') || relative.split(path.sep).some((part) => part.startsWith('.'))) continue;
      const raw = await readFile(filePath, 'utf8').catch(() => '');
      const name = skillNameFromMarkdown(raw, path.basename(path.dirname(filePath)));
      const usageRow = usage?.[name] || {};
      rows.push({
        name,
        file: `skills/${relative.split(path.sep).join('/')}/SKILL.md`,
        description: skillDescriptionFromMarkdown(raw),
        category: skillCategoryFromName(name, filePath),
        enabled: !disabled.has(name),
        source: 'profile',
        usage: {
          useCount: Number(usageRow.use_count || 0),
          viewCount: Number(usageRow.view_count || 0),
          patchCount: Number(usageRow.patch_count || 0),
          state: String(usageRow.state || ''),
          lastUsedAt: usageRow.last_used_at || null,
        },
      });
    }
    return rows
      .filter((row, index, arr) => arr.findIndex((item) => item.name === row.name) === index)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 160);
  } catch {
    return [];
  }
}

async function editablePluginEntries(dir, profileName, config = {}) {
  const pluginRoots = [path.join(hermesHome, 'plugins'), path.join(dir, 'plugins')];
  const rows = [];
  for (const pluginsDir of pluginRoots) {
    try {
      const entries = await readdir(pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const yamlPath = path.join(pluginsDir, entry.name, 'plugin.yaml');
        const jsonPath = path.join(pluginsDir, entry.name, 'plugin.json');
        const filePath = await exists(yamlPath) ? yamlPath : await exists(jsonPath) ? jsonPath : '';
        const relativeFile = filePath && isInside(dir, filePath)
          ? path.relative(dir, filePath)
          : filePath && isInside(hermesHome, filePath)
            ? path.relative(hermesHome, filePath)
            : '';
        const isProfileLocal = isInside(dir, path.join(pluginsDir, entry.name));
        rows.push({
          name: entry.name,
          file: relativeFile,
          source: isProfileLocal ? 'profile' : 'global',
          ...pluginStatusFromConfig(config, entry.name),
        });
      }
    } catch {
      // Plugins are optional for a profile.
    }
  }
  return rows
    .filter((row, index, arr) => arr.findIndex((item) => item.name === row.name) === index)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 80);
}

async function readProfileModules(dir, name, config = {}) {
  const skills = await editableSkillEntries(dir, config);
  const plugins = await editablePluginEntries(dir, name, config);
  return {
    skills,
    plugins,
  };
}

async function readYamlFile(filePath) {
  try {
    return YAML.parse(await readFile(filePath, 'utf8')) || {};
  } catch {
    return {};
  }
}

async function readEnvStatus(filePath) {
  const values = new Map();
  try {
    const raw = await readFile(filePath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && value) values.set(key, true);
    }
  } catch {
    // Missing env files are normal for fresh Hermes profiles.
  }
  return values;
}

function providerLabel(providerKey) {
  const value = String(providerKey || '').trim();
  if (!value) return 'provider default';
  return value.startsWith('custom:') ? value.slice(7) : value;
}

function customProviderEntries(config) {
  const source = config?.custom_providers;
  if (Array.isArray(source)) {
    return source.map((providerConfig, index) => [
      String(providerConfig?.name || providerConfig?.key || providerConfig?.provider || providerConfig?.id || `custom-${index + 1}`),
      providerConfig || {},
    ]);
  }
  return Object.entries(source || {});
}

function hasInlineApiKey(config) {
  return Boolean(String(config?.api_key || config?.apiKey || '').trim());
}

function buildProviderSummaries(config, envValues) {
  const defaultModel = String(config?.model?.default || config?.model || '').trim();
  const defaultProvider = String(config?.model?.provider || config?.provider || '').trim();
  const summaries = [];
  const addSummary = (providerKey, providerConfig = {}, model = defaultModel) => {
    const cleanKey = String(providerKey || '').trim();
    if (!cleanKey) return;
    const builtinKey = cleanKey.replace(/^custom:/, '');
    const envMapping = providerEnvMap[cleanKey] || providerEnvMap[builtinKey] || {};
    const baseUrl = String(providerConfig?.base_url || providerConfig?.baseUrl || '').trim();
    const hasApiKey = hasInlineApiKey(providerConfig) || Boolean(envMapping.apiKey && envValues.has(envMapping.apiKey));
    summaries.push({
      providerKey: cleanKey,
      providerName: providerLabel(cleanKey),
      baseUrl: baseUrl || (envMapping.baseUrl && envValues.has(envMapping.baseUrl) ? '[env]' : ''),
      model: String(providerConfig?.model || model || '').trim(),
      hasApiKey,
      apiKeyState: hasApiKey ? 'stored' : 'missing',
    });
  };

  if (defaultProvider) {
    const source = selectedProviderConfig(config, defaultProvider);
    addSummary(defaultProvider, source || {}, defaultModel);
  }
  for (const [key, providerConfig] of customProviderEntries(config)) {
    addSummary(`custom:${key}`, providerConfig, providerConfig?.model || defaultModel);
  }
  return summaries.filter((item, index, arr) => arr.findIndex((other) => other.providerKey === item.providerKey) === index).slice(0, 8);
}

function envApiKeyNames(providerKey) {
  const cleanKey = String(providerKey || '').replace(/^custom:/, '');
  const mapped = providerEnvMap[providerKey] || providerEnvMap[cleanKey] || {};
  const upper = cleanKey.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return Array.from(new Set([mapped.apiKey, `${upper}_API_KEY`, 'OPENAI_API_KEY'].filter(Boolean)));
}

function readProviderApiKey(providerKey, providerConfig = {}, envRaw = {}) {
  const inline = String(providerConfig?.api_key || providerConfig?.apiKey || '').trim();
  if (inline) return inline;
  for (const name of envApiKeyNames(providerKey)) {
    const value = String(envRaw[name] || process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

async function readEnvValues(filePath) {
  const values = {};
  try {
    const raw = await readFile(filePath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key) values[key] = value;
    }
  } catch {
    // Missing env files are normal before Hermes is initialized.
  }
  return values;
}

async function writeEnvValues(filePath, updates) {
  const current = await readEnvValues(filePath);
  for (const [key, value] of Object.entries(updates || {})) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) continue;
    const cleanValue = value === undefined || value === null ? '' : String(value).trim();
    if (cleanValue) current[cleanKey] = cleanValue;
    else delete current[cleanKey];
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  const lines = Object.entries(current)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value).replace(/\n/g, ' ')}`);
  await writeFile(filePath, `${lines.join('\n')}${lines.length ? '\n' : ''}`, { encoding: 'utf8', mode: 0o600 });
}

function setNestedValue(target, keyPath, value) {
  const parts = String(keyPath || '').split('.').filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function removeNestedValue(target, keyPath) {
  const parts = String(keyPath || '').split('.').filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor?.[parts[index]];
    if (!cursor || typeof cursor !== 'object') return;
  }
  delete cursor[parts[parts.length - 1]];
}

function deepMerge(target, source) {
  const next = { ...(target || {}) };
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && next[key] && typeof next[key] === 'object' && !Array.isArray(next[key])) {
      next[key] = deepMerge(next[key], value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

function profileConfigDir(profileName = 'default') {
  const clean = slug(profileName || 'default');
  return clean === 'default' ? hermesHome : path.join(hermesHome, 'profiles', clean);
}

function profileConfigPath(profileName = 'default') {
  return path.join(profileConfigDir(profileName), 'config.yaml');
}

function mcpConfigPathForProfile(profileName = 'default') {
  return profileConfigPath(profileName || 'default');
}

function profileEnvPath(profileName = 'default') {
  return path.join(profileConfigDir(profileName), '.env');
}

function requestedHermesProfile(req, fallback = 'default') {
  return slug(req.query?.profile || req.body?.profile || fallback || 'default');
}

async function requestedModelProfile(req) {
  const explicit = String(req.query?.profile || req.body?.profile || '').trim();
  if (explicit) return slug(explicit);
  try {
    const state = await readState();
    return slug(state.integrations?.hermesAgent?.selectedProfile || state.integrations?.hermesStudio?.selectedProfile || 'default');
  } catch {
    return 'default';
  }
}

async function updateProfileYaml(profileName, updater) {
  const configPath = profileConfigPath(profileName);
  await mkdir(path.dirname(configPath), { recursive: true });
  const config = await readYamlFile(configPath);
  const next = await updater(config || {});
  await writeFile(configPath, YAML.stringify(next || {}), 'utf8');
  return next || {};
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function configValidationError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function positiveInteger(value, field, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw configValidationError(`${field} 必须是正整数。`);
  return Math.floor(number);
}

function nullableNumber(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw configValidationError(`${field} 必须是数字或留空。`);
  return number;
}

function publicAuxiliarySettings(raw, task) {
  if (!isPlainRecord(raw)) return {};
  const settings = {};
  for (const field of ['provider', 'model', 'base_url']) {
    if (typeof raw[field] === 'string' && raw[field].trim()) settings[field] = raw[field].trim();
  }
  const timeout = Number(raw.timeout);
  if (Number.isFinite(timeout) && timeout > 0) settings.timeout = Math.floor(timeout);
  const downloadTimeout = Number(raw.download_timeout);
  if (task.key === 'vision' && Number.isFinite(downloadTimeout) && downloadTimeout > 0) settings.download_timeout = Math.floor(downloadTimeout);
  if (isPlainRecord(raw.extra_body) && Object.keys(raw.extra_body).length) settings.extra_body = raw.extra_body;
  return settings;
}

function normalizeAuxiliaryUpdate(raw, task) {
  if (!isPlainRecord(raw)) throw configValidationError(`${task.label}配置必须是对象。`);
  const provider = String(raw.provider || 'auto').trim() || 'auto';
  const model = String(raw.model || '').trim();
  if (!['auto', 'main'].includes(provider) && !model) throw configValidationError(`${task.label}指定 Provider 后必须选择模型。`);
  if (provider.toLowerCase() === 'moa') throw configValidationError('辅助模型不能使用 MoA Provider。');
  const settings = { provider };
  if (model && !['auto', 'main'].includes(provider)) settings.model = model;
  const timeout = positiveInteger(raw.timeout, `${task.label}超时`, task.default_timeout);
  if (timeout) settings.timeout = timeout;
  if (task.key === 'vision') {
    const downloadTimeout = positiveInteger(raw.download_timeout, '视觉下载超时', task.default_download_timeout);
    if (downloadTimeout) settings.download_timeout = downloadTimeout;
  }
  if (raw.extra_body !== undefined && raw.extra_body !== null && raw.extra_body !== '') {
    if (!isPlainRecord(raw.extra_body)) throw configValidationError(`${task.label} extra_body 必须是 JSON 对象。`);
    if (Object.keys(raw.extra_body).length) settings.extra_body = raw.extra_body;
  }
  return settings;
}

function cleanMoaSlot(value, field, strict = false) {
  if (!isPlainRecord(value)) {
    if (strict) throw configValidationError(`${field}必须选择 Provider 和模型。`);
    return null;
  }
  const provider = String(value.provider || '').trim();
  const model = String(value.model || '').trim();
  if (!provider || !model || provider.toLowerCase() === 'moa') {
    if (strict) throw configValidationError(`${field}必须选择非 MoA Provider 和模型。`);
    return null;
  }
  return { provider, model };
}

function defaultMoaPreset() {
  return {
    enabled: true,
    reference_models: defaultMoaReferenceModels.map((slot) => ({ ...slot })),
    aggregator: { ...defaultMoaAggregator },
    reference_temperature: null,
    aggregator_temperature: null,
    max_tokens: 4096,
    reference_max_tokens: null,
    fanout: 'per_iteration',
  };
}

function normalizeMoaPreset(value, strict = false) {
  const raw = isPlainRecord(value) ? value : {};
  const sourceReferences = Array.isArray(raw.reference_models) ? raw.reference_models : [];
  const referenceModels = strict
    ? sourceReferences.map((slot, index) => cleanMoaSlot(slot, `参考模型 ${index + 1}`, true))
    : sourceReferences.map((slot) => cleanMoaSlot(slot, '参考模型')).filter(Boolean);
  if (strict && !referenceModels.length) throw configValidationError('组合模型至少需要一个参考模型。');
  const aggregator = cleanMoaSlot(raw.aggregator, '汇总模型', strict) || { ...defaultMoaAggregator };
  const fanout = String(raw.fanout || 'per_iteration').trim();
  if (!['per_iteration', 'user_turn'].includes(fanout)) {
    if (strict) throw configValidationError('fanout 只能是 per_iteration 或 user_turn。');
  }
  const readNullableNumber = (input, field) => {
    if (strict) return nullableNumber(input, field);
    if (input === undefined || input === null || input === '') return null;
    const number = Number(input);
    return Number.isFinite(number) ? number : null;
  };
  const readPositiveInteger = (input, field, fallback) => {
    if (strict) return positiveInteger(input, field, fallback);
    const number = Number(input);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
  };
  return {
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
    reference_models: referenceModels.length ? referenceModels : defaultMoaReferenceModels.map((slot) => ({ ...slot })),
    aggregator,
    reference_temperature: readNullableNumber(raw.reference_temperature, '参考温度'),
    aggregator_temperature: readNullableNumber(raw.aggregator_temperature, '汇总温度'),
    max_tokens: readPositiveInteger(raw.max_tokens, '最终输出上限', 4096),
    reference_max_tokens: readPositiveInteger(raw.reference_max_tokens, '参考模型输出上限', null),
    fanout: ['per_iteration', 'user_turn'].includes(fanout) ? fanout : 'per_iteration',
  };
}

function normalizeMoaConfig(value, strict = false) {
  const raw = isPlainRecord(value) ? value : {};
  const sourcePresets = isPlainRecord(raw.presets) ? raw.presets : {};
  const presets = {};
  for (const [name, preset] of Object.entries(sourcePresets)) {
    const cleanName = String(name || '').trim();
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(cleanName)) {
      if (strict) throw configValidationError(`组合模型名称「${cleanName || name}」不合法。`);
      continue;
    }
    presets[cleanName] = normalizeMoaPreset(preset, strict);
  }
  if (!Object.keys(presets).length) {
    if (strict) throw configValidationError('至少需要保留一个组合模型。');
    presets.default = normalizeMoaPreset(raw, false);
  }
  let defaultPreset = String(raw.default_preset || '').trim();
  if (!presets[defaultPreset]) {
    if (strict && defaultPreset) throw configValidationError('默认组合模型不存在。');
    defaultPreset = Object.keys(presets)[0] || 'default';
  }
  let activePreset = String(raw.active_preset || '').trim();
  if (activePreset && !presets[activePreset]) {
    if (strict) throw configValidationError('当前组合模型不存在。');
    activePreset = '';
  }
  const active = presets[defaultPreset] || defaultMoaPreset();
  return {
    default_preset: defaultPreset,
    active_preset: activePreset,
    save_traces: Boolean(raw.save_traces),
    trace_dir: String(raw.trace_dir || '').trim(),
    presets,
    reference_models: active.reference_models.map((slot) => ({ ...slot })),
    aggregator: { ...active.aggregator },
    reference_temperature: active.reference_temperature,
    aggregator_temperature: active.aggregator_temperature,
    max_tokens: active.max_tokens,
    reference_max_tokens: active.reference_max_tokens,
    fanout: active.fanout,
    enabled: active.enabled,
  };
}

function modelProtocolFromApiMode(apiMode = '') {
  if (apiMode === 'anthropic_messages') return 'Anthropic Compatible';
  if (apiMode === 'openai_responses' || apiMode === 'codex_responses' || apiMode === 'chat_completions') return 'OpenAI Compatible';
  return apiMode ? 'Custom' : 'OpenAI Compatible';
}

function normalizeApiMode(value) {
  const clean = String(value || '').trim();
  return ['chat_completions', 'openai_responses', 'codex_responses', 'anthropic_messages', 'bedrock_converse', 'codex_app_server'].includes(clean) ? clean : '';
}

function providerPresetByKey(providerKey = '') {
  return loadProviderPresets().find((preset) => preset.value === providerKey);
}

function authJsonPathForProfile(profileName = 'default') {
  return path.join(profileConfigDir(profileName), 'auth.json');
}

function loadAuthJsonSync(authPath) {
  try {
    return JSON.parse(readFileSync(authPath, 'utf8')) || { version: 1 };
  } catch {
    return { version: 1 };
  }
}

function saveAuthJsonSync(authPath, data) {
  data.updated_at = new Date().toISOString();
  mkdirSync(path.dirname(authPath), { recursive: true });
  writeFileSync(authPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function updateHermesModelProviderConfig(profileName, providerKey, model) {
  return updateProfileYaml(profileName, (current) => {
    current.model = current.model && typeof current.model === 'object' && !Array.isArray(current.model) ? current.model : {};
    current.model.provider = providerKey;
    current.model.default = model || providerPresetByKey(providerKey)?.models?.[0] || '';
    delete current.model.base_url;
    delete current.model.api_key;
    return current;
  });
}

function saveCodexCliTokens(accessToken, refreshToken) {
  const codexHome = process.env.CODEX_HOME || path.join(homeDir, '.codex');
  const codexAuthPath = path.join(codexHome, 'auth.json');
  mkdirSync(path.dirname(codexAuthPath), { recursive: true });
  writeFileSync(codexAuthPath, `${JSON.stringify({ tokens: { access_token: accessToken, refresh_token: refreshToken }, last_refresh: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function saveCodexOAuthTokens(profileName, accessToken, refreshToken) {
  const authPath = authJsonPathForProfile(profileName);
  const auth = loadAuthJsonSync(authPath);
  auth.providers = auth.providers || {};
  auth.providers['openai-codex'] = { tokens: { access_token: accessToken, refresh_token: refreshToken }, last_refresh: new Date().toISOString(), auth_mode: 'chatgpt' };
  auth.credential_pool = auth.credential_pool || {};
  auth.credential_pool['openai-codex'] = [{ id: `openai-codex-${Date.now()}`, label: 'OpenAI Codex', base_url: providerPresetByKey('openai-codex')?.baseUrl || '', access_token: accessToken, last_status: null }];
  saveAuthJsonSync(authPath, auth);
  saveCodexCliTokens(accessToken, refreshToken);
}

function authEntryHasCredential(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(authEntryHasCredential);
  return Boolean(
    value.access_token || value.refresh_token || value.accessToken || value.refreshToken ||
    value.agent_key || value.tokens?.access_token || value.tokens?.refresh_token
  );
}

function oauthProviderAuthenticated(profileName, providerKey) {
  const auth = loadAuthJsonSync(authJsonPathForProfile(profileName));
  const aliases = providerKey === 'claude-oauth' ? ['claude-oauth', 'anthropic'] : [providerKey];
  return aliases.some((key) => authEntryHasCredential(auth.providers?.[key]) || authEntryHasCredential(auth.credential_pool?.[key]));
}

function oauthProviderAccessToken(profileName, providerKey) {
  const auth = loadAuthJsonSync(authJsonPathForProfile(profileName));
  const aliases = providerKey === 'claude-oauth' ? ['claude-oauth', 'anthropic'] : [providerKey];
  for (const key of aliases) {
    const candidates = [auth.providers?.[key], ...(Array.isArray(auth.credential_pool?.[key]) ? auth.credential_pool[key] : [])];
    for (const entry of candidates) {
      const token = String(entry?.tokens?.access_token || entry?.access_token || entry?.accessToken || '').trim();
      if (token) return token;
    }
  }
  return '';
}

function oauthCatalogModel(providerKey) {
  const preset = providerPresetByKey(providerKey) || {};
  return { providerKey, apiMode: preset.apiMode || '', baseUrl: preset.baseUrl || '' };
}

function oauthProviderState(profileName, providerKey) {
  const preset = providerPresetByKey(providerKey);
  const authenticated = Boolean(preset?.authType && oauthProviderAuthenticated(profileName, providerKey));
  const cached = catalogStatus(modelCatalogCache, oauthCatalogModel(providerKey));
  if (!authenticated) {
    return { authenticated: false, models: [], catalog: { ...cached, source: 'none', modelIds: [] } };
  }
  const cachedModels = cached.modelIds || [];
  const models = cachedModels.length ? cachedModels : providerKey === 'openai-codex' ? [] : [...(preset?.models || [])];
  return {
    authenticated: true,
    models,
    catalog: {
      ...cached,
      source: cachedModels.length ? cached.source : providerKey === 'openai-codex' ? 'none' : 'frakio_builtin',
      modelIds: models,
      rich: cachedModels.length ? cached.rich : false,
    },
  };
}

function oauthProviderPayload(profileName, providerKey) {
  const state = oauthProviderState(profileName, providerKey);
  const preset = providerPresetByKey(providerKey) || {};
  const capabilityModel = normalizeModels([{
    id: 'oauth-catalog', name: preset.label || providerKey, provider: preset.label || providerKey,
    providerKey, apiMode: preset.apiMode || '', baseUrl: preset.baseUrl || '',
    model: state.models[0] || '', models: state.models, capabilityMode: 'auto', capabilityOverrides: {},
  }])[0];
  return {
    ...state,
    capabilities: Object.fromEntries(state.models.map((modelId) => [modelId, resolveModelCapability(capabilityModel, modelId, { providerCatalog: flattenProviderCatalog(modelCatalogCache) })])),
  };
}

async function refreshCodexOAuthModels(accessToken) {
  const provider = oauthCatalogModel('openai-codex');
  try {
    const normalized = await fetchCodexOAuthCatalog({ accessToken, endpoint: process.env.FRAKIO_WORK_CODEX_MODELS_URL || undefined });
    const parsed = parseCatalogResponse(normalized, provider);
    parsed.ids = normalized.models.map((model) => model.id);
    await updateProviderCatalog(modelCatalogCachePath, modelCatalogCache, provider, parsed);
    return catalogStatus(modelCatalogCache, provider);
  } catch (error) {
    await recordCatalogError(modelCatalogCachePath, modelCatalogCache, provider, error);
    throw error;
  }
}

async function saveClaudeOAuthTokens(profileName, tokenData) {
  const accessToken = String(tokenData.access_token || '').trim();
  const refreshToken = String(tokenData.refresh_token || '').trim();
  if (!accessToken) throw new Error('Claude OAuth 没有返回 access token。');
  const expiresAtMs = Date.now() + Math.max(60, Number(tokenData.expires_in || 3600)) * 1000;
  const lastRefresh = new Date().toISOString();
  const profileDir = profileConfigDir(profileName);
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(path.join(profileDir, '.anthropic_oauth.json'), `${JSON.stringify({ accessToken, refreshToken, expiresAt: expiresAtMs, tokenType: tokenData.token_type || 'Bearer', updatedAt: lastRefresh }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const providerEntry = { tokens: { access_token: accessToken, refresh_token: refreshToken, expires_at_ms: expiresAtMs, token_type: tokenData.token_type || 'Bearer' }, last_refresh: lastRefresh, auth_mode: 'oauth_pkce', base_url: 'https://api.anthropic.com' };
  const poolEntry = { id: `claude-oauth-${Date.now()}`, label: 'Claude OAuth', auth_type: 'oauth', source: 'frakio_pkce', priority: 0, access_token: accessToken, refresh_token: refreshToken, expires_at_ms: expiresAtMs, base_url: 'https://api.anthropic.com' };
  const authPath = authJsonPathForProfile(profileName);
  const auth = loadAuthJsonSync(authPath);
  auth.providers = { ...(auth.providers || {}), 'claude-oauth': providerEntry, anthropic: providerEntry };
  auth.credential_pool = { ...(auth.credential_pool || {}), 'claude-oauth': [poolEntry], anthropic: [{ ...poolEntry, id: `anthropic-${Date.now()}`, label: 'Anthropic Claude OAuth' }] };
  saveAuthJsonSync(authPath, auth);
}

async function saveGeminiOAuthTokens(profileName, tokenData, email = '') {
  const accessToken = String(tokenData.access_token || '').trim();
  const refreshToken = String(tokenData.refresh_token || '').trim();
  if (!accessToken || !refreshToken) throw new Error('Google OAuth 没有返回完整 token。');
  const expiresAtMs = Date.now() + Math.max(60, Number(tokenData.expires_in || 3600)) * 1000;
  const lastRefresh = new Date().toISOString();
  const googleAuthPath = path.join(profileConfigDir(profileName), 'auth', 'google_oauth.json');
  mkdirSync(path.dirname(googleAuthPath), { recursive: true });
  writeFileSync(googleAuthPath, `${JSON.stringify({ refresh: refreshToken, access: accessToken, expires: expiresAtMs, email }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const authPath = authJsonPathForProfile(profileName);
  const auth = loadAuthJsonSync(authPath);
  auth.providers = auth.providers || {};
  auth.providers[geminiProviderKey] = { access_token: accessToken, refresh_token: refreshToken, expires_at_ms: expiresAtMs, email, last_refresh: lastRefresh, auth_mode: 'google_oauth_pkce', base_url: 'cloudcode-pa://google' };
  auth.credential_pool = auth.credential_pool || {};
  auth.credential_pool[geminiProviderKey] = [{ id: `${geminiProviderKey}-${Date.now()}`, label: 'Google Gemini OAuth', auth_type: 'oauth', source: 'loopback_pkce', priority: 0, access_token: accessToken, refresh_token: refreshToken, expires_at_ms: expiresAtMs, email, base_url: 'cloudcode-pa://google' }];
  saveAuthJsonSync(authPath, auth);
}

function providerVerificationError(message, status = 400, code = 'provider_rejected') {
  return Object.assign(new Error(message), { status, code });
}

function officialOAuthBaseUrl(providerKey, requestedBaseUrl) {
  const expected = String(providerPresetByKey(providerKey)?.baseUrl || '').trim();
  if (!expected || comparableBaseUrl(expected) !== comparableBaseUrl(requestedBaseUrl)) {
    throw providerVerificationError('OAuth Provider 的官方 Base URL 不能修改。', 400, 'provider_rejected');
  }
  return expected;
}

function oauthTokenForVerification(profileName, providerKey) {
  const token = oauthProviderAccessToken(profileName, providerKey);
  if (!token) throw providerVerificationError('授权已失效，请重新授权。', 401, 'oauth_expired');
  return token;
}

function providerErrorMessage(result, fallback) {
  return String(result?.body?.error?.message || result?.body?.error?.status || result?.body?.message || fallback).slice(0, 500);
}

function throwNativeVerificationFailure(result, providerLabel) {
  if (result.status === 401) throw providerVerificationError(`${providerLabel} 授权已失效，请重新授权。`, 401, 'oauth_expired');
  if (result.status === 403) throw providerVerificationError(`${providerLabel} 拒绝了当前账号请求。`, 403, 'provider_rejected');
  throw providerVerificationError(`${providerLabel} 验证失败：${providerErrorMessage(result, `HTTP ${result.status || 502}`)}`, result.status || 502, 'provider_rejected');
}

async function verifyCodexOAuthProvider(profileName, modelId) {
  const accessToken = oauthTokenForVerification(profileName, 'openai-codex');
  let catalog;
  try {
    catalog = await refreshCodexOAuthModels(accessToken);
  } catch (error) {
    if (error?.status === 401) throw providerVerificationError('OpenAI Codex 授权已失效，请重新授权。', 401, 'oauth_expired');
    if (error?.status === 403) throw providerVerificationError('OpenAI Codex 拒绝了当前账号请求。', 403, 'provider_rejected');
    throw providerVerificationError(error?.message || 'OpenAI Codex 模型目录刷新失败。', error?.status || 502, error?.code || 'catalog_refresh_failed');
  }
  const modelIds = catalog.modelIds || [];
  if (!modelIds.includes(modelId)) {
    throw providerVerificationError('当前 ChatGPT 账号不可用此模型。', 400, 'model_not_entitled');
  }
  return { verificationKind: 'codex_oauth', usageConsumed: false, catalog };
}

async function verifyClaudeOAuthProvider(profileName, modelId, baseUrl) {
  const accessToken = oauthTokenForVerification(profileName, 'claude-oauth');
  const url = process.env.FRAKIO_WORK_CLAUDE_VERIFY_URL || providerInferenceUrl({ baseUrl, apiMode: 'anthropic_messages' });
  const result = await fetchExternalJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,claude-code-20250219,oauth-2025-04-20',
      'User-Agent': 'claude-code/2.1.74 (external, cli)',
      'x-app': 'cli',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 8 }),
    timeoutMs: 30000,
  });
  if (!result.ok) throwNativeVerificationFailure(result, 'Claude OAuth');
  return { verificationKind: 'claude_oauth', usageConsumed: true };
}

function geminiClientMetadata(projectId = '') {
  const platform = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'DARWIN_ARM64' : 'DARWIN_AMD64')
    : process.platform === 'win32' ? 'WINDOWS_AMD64' : (process.arch === 'arm64' ? 'LINUX_ARM64' : 'LINUX_AMD64');
  return { ideType: 'GEMINI_CLI', platform, pluginType: 'GEMINI', ...(projectId ? { duetProject: projectId } : {}) };
}

function savedGeminiCodeAssistState(profileName) {
  const auth = loadAuthJsonSync(authJsonPathForProfile(profileName));
  return auth.providers?.[geminiProviderKey]?.code_assist || {};
}

function saveGeminiCodeAssistState(profileName, metadata) {
  const authPath = authJsonPathForProfile(profileName);
  const auth = loadAuthJsonSync(authPath);
  const provider = { ...(auth.providers?.[geminiProviderKey] || {}), code_assist: metadata };
  auth.providers = { ...(auth.providers || {}), [geminiProviderKey]: provider };
  const pool = Array.isArray(auth.credential_pool?.[geminiProviderKey]) ? auth.credential_pool[geminiProviderKey] : [];
  auth.credential_pool = { ...(auth.credential_pool || {}), [geminiProviderKey]: pool.map((entry) => ({ ...entry, code_assist: metadata })) };
  saveAuthJsonSync(authPath, auth);
}

async function geminiCodeAssistRequest(accessToken, method, body, timeoutMs = 30000) {
  const base = String(process.env.FRAKIO_WORK_GEMINI_CODE_ASSIST_URL || 'https://cloudcode-pa.googleapis.com/v1internal').replace(/\/+$/, '');
  return fetchExternalJson(`${base}:${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'GeminiCLI/Frakio-Work' },
    body: JSON.stringify(body),
    timeoutMs,
  });
}

async function geminiCodeAssistOperation(accessToken, name) {
  const base = String(process.env.FRAKIO_WORK_GEMINI_CODE_ASSIST_URL || 'https://cloudcode-pa.googleapis.com/v1internal').replace(/\/+$/, '');
  return fetchExternalJson(`${base}/${String(name || '').replace(/^\/+/, '')}`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'GeminiCLI/Frakio-Work' },
    timeoutMs: 15000,
  });
}

async function resolveGeminiCodeAssistAccount(profileName, accessToken) {
  const saved = savedGeminiCodeAssistState(profileName);
  const requestedProject = String(saved.projectId || '').trim();
  const load = await geminiCodeAssistRequest(accessToken, 'loadCodeAssist', {
    ...(requestedProject ? { cloudaicompanionProject: requestedProject } : {}),
    metadata: geminiClientMetadata(requestedProject),
  });
  if (!load.ok) throwNativeVerificationFailure(load, 'Google Gemini OAuth');
  const payload = load.body || {};
  if (payload.currentTier) {
    const projectId = String(payload.cloudaicompanionProject || requestedProject || '').trim();
    if (!projectId) throw providerVerificationError('Google Gemini OAuth 账号尚未完成 Code Assist 初始化。', 400, 'oauth_setup_required');
    return { projectId, tierId: String(payload.paidTier?.id || payload.currentTier?.id || 'standard-tier'), tierName: String(payload.paidTier?.name || payload.currentTier?.name || '') };
  }
  const tier = (Array.isArray(payload.allowedTiers) ? payload.allowedTiers : []).find((item) => item?.isDefault)
    || (Array.isArray(payload.allowedTiers) ? payload.allowedTiers[0] : null);
  if (!tier?.id) throw providerVerificationError('Google Gemini OAuth 账号当前不能启用 Code Assist。', 400, 'oauth_setup_required');
  if (tier.userDefinedCloudaicompanionProject && !requestedProject) {
    throw providerVerificationError('Google Gemini OAuth 需要先配置 Google Cloud Project。', 400, 'oauth_setup_required');
  }
  let onboard = await geminiCodeAssistRequest(accessToken, 'onboardUser', {
    tierId: tier.id,
    ...(tier.userDefinedCloudaicompanionProject ? { cloudaicompanionProject: requestedProject } : {}),
    metadata: geminiClientMetadata(requestedProject),
  });
  if (!onboard.ok) throwNativeVerificationFailure(onboard, 'Google Gemini OAuth');
  for (let attempt = 0; !onboard.body?.done && onboard.body?.name && attempt < 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    onboard = await geminiCodeAssistOperation(accessToken, onboard.body.name);
    if (!onboard.ok) throwNativeVerificationFailure(onboard, 'Google Gemini OAuth');
  }
  if (!onboard.body?.done) throw providerVerificationError('Google Gemini OAuth 正在初始化，请稍后重新验证。', 409, 'oauth_setup_required');
  const projectId = String(onboard.body?.response?.cloudaicompanionProject?.id || requestedProject || '').trim();
  if (!projectId) throw providerVerificationError('Google Gemini OAuth 没有返回可用的 Code Assist Project。', 400, 'oauth_setup_required');
  return { projectId, tierId: String(tier.id), tierName: String(tier.name || '') };
}

async function verifyGeminiOAuthProvider(profileName, modelId) {
  const accessToken = oauthTokenForVerification(profileName, geminiProviderKey);
  const account = await resolveGeminiCodeAssistAccount(profileName, accessToken);
  const result = await geminiCodeAssistRequest(accessToken, 'generateContent', {
    model: modelId,
    project: account.projectId,
    user_prompt_id: randomUUID(),
    request: {
      contents: [{ role: 'user', parts: [{ text: 'Reply OK.' }] }],
      generationConfig: { maxOutputTokens: 8 },
      session_id: randomUUID(),
    },
  });
  if (!result.ok) {
    const message = providerErrorMessage(result, `HTTP ${result.status || 502}`);
    if (result.status === 400 && /model|not found|unsupported/i.test(message)) {
      throw providerVerificationError('当前 Google 账号不可用此模型。', 400, 'model_not_entitled');
    }
    throwNativeVerificationFailure(result, 'Google Gemini OAuth');
  }
  const verifiedAt = now();
  saveGeminiCodeAssistState(profileName, { projectId: account.projectId, tierId: account.tierId, tierName: account.tierName, verifiedAt });
  return { verificationKind: 'gemini_code_assist', usageConsumed: true, verifiedAt };
}

function readPlatformEnvAsConfig(envValues) {
  const platforms = {};
  for (const [envKey, [platform, keyPath]] of Object.entries(hermesPlatformEnvMap)) {
    const raw = envValues[envKey];
    if (raw === undefined || raw === '') continue;
    platforms[platform] = platforms[platform] || {};
    const value = keyPath === 'enabled' || keyPath === 'allow_all_users' ? String(raw).toLowerCase() === 'true' : raw;
    setNestedValue(platforms[platform], keyPath, value);
  }
  return platforms;
}

function readProxyEnvAsConfig(envValues) {
  return Object.fromEntries(hermesProxyEnvKeys.filter((key) => envValues[key]).map((key) => [key, envValues[key]]));
}

function arrayFromMcpValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function objectFromMcpPairs(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, String(val)]));
  if (typeof value !== 'string') return {};
  const pairs = {};
  for (const line of value.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const val = trimmed.slice(index + 1).trim();
    if (key) pairs[key] = val;
  }
  return pairs;
}

function sanitizeMcpServerName(name) {
  const clean = String(name || '').trim();
  if (!clean || !/^[A-Za-z0-9_.-]+$/.test(clean)) throw Object.assign(new Error('MCP Server 名称只能包含字母、数字、点、短横线和下划线。'), { status: 400 });
  return clean;
}

function mcpTransportFromConfig(config = {}) {
  if (config.url) return 'http';
  return 'stdio';
}

function knownManagedMcpTools(serverName, config = {}) {
  const toolset = String(config?.env?.HERMES_MCP_TOOLSET || '').trim();
  const workbenchToolset = String(config?.env?.HERMES_WORKBENCH_MCP_TOOLSET || '').trim();
  if (serverName === 'hermes-workbench-api' || workbenchToolset === 'api') return ['hermes_workbench_api_catalog_get', 'hermes_workbench_api_request'];
  if (serverName === 'hermes-workbench-use' || workbenchToolset === 'use') return [
    'hermes_workbench_use_threads_list',
    'hermes_workbench_use_thread_get',
    'hermes_workbench_use_projects_list',
    'hermes_workbench_use_agents_list',
    'hermes_workbench_use_models_list',
    'hermes_workbench_use_runtime_status',
    'hermes_workbench_use_mcp_servers_list',
    'hermes_workbench_use_user_profile_get',
  ];
  if (serverName === 'hermes-studio-api' || toolset === 'api') return ['hermes_studio_api_openapi_get', 'hermes_studio_api_request'];
  if (serverName === 'hermes-studio-devices' || toolset === 'devices') return [
    'hermes_studio_lan_devices_list',
    'hermes_studio_lan_devices_scan',
    'hermes_studio_lan_peer_connect',
    'hermes_studio_lan_peer_connections',
    'hermes_studio_lan_peer_disconnect',
    'hermes_studio_lan_terminal_create',
    'hermes_studio_lan_terminal_list',
    'hermes_studio_lan_terminal_input',
    'hermes_studio_lan_terminal_read',
    'hermes_studio_lan_terminal_resize',
    'hermes_studio_lan_terminal_close',
    'hermes_studio_lan_command_exec',
    'hermes_studio_lan_file_download',
    'hermes_studio_lan_file_upload',
  ];
  if (serverName === 'hermes-studio-use' || toolset === 'use') return [
    'hermes_studio_use_chat_run',
    'hermes_studio_use_sessions_list',
    'hermes_studio_use_sessions_count',
    'hermes_studio_use_usage_stats',
    'hermes_studio_use_session_get',
    'hermes_studio_use_session_messages',
    'hermes_studio_use_session_context',
    'hermes_studio_use_session_delete',
    'hermes_studio_use_session_rename',
    'hermes_studio_use_profiles_list',
    'hermes_studio_use_available_models',
    'hermes_studio_use_model_provider_get',
    'hermes_studio_use_provider_add',
    'hermes_studio_use_provider_delete',
    'hermes_studio_use_worker_status',
  ];
  if (serverName === 'agentmail' || String(config.command || '').includes('agentmail')) return [
    'list_inboxes',
    'get_inbox',
    'create_inbox',
    'delete_inbox',
    'list_threads',
    'get_thread',
    'get_attachment',
    'send_message',
    'reply_to_message',
    'forward_message',
    'update_message',
  ];
  return [];
}

function workbenchMcpServerConfig(toolset, profileName = 'default') {
  const cleanToolset = toolset === 'api' ? 'api' : 'use';
  const nodeCommand = findHermesNodeSync();
  return {
    command: nodeCommand,
    args: [path.join(projectRoot, 'bin', 'hermes-workbench-mcp.mjs'), cleanToolset],
    env: {
      HERMES_WORKBENCH_URL: `http://127.0.0.1:${port}`,
      HERMES_WORKBENCH_PROFILE: profileName,
      HERMES_WORKBENCH_MCP_TOOLSET: cleanToolset,
      HERMES_WORKBENCH_MCP_SERVER_NAME: `hermes-workbench-${cleanToolset}`,
    },
    enabled: true,
  };
}

async function probeStdioMcpTools(serverConfig = {}) {
  const command = String(serverConfig.command || '').trim();
  if (!command) throw new Error('MCP server command is empty.');
  const resolvedCommand = await resolveRuntimeCommand(command);
  if (!resolvedCommand) {
    const error = new Error(`MCP server requires ${command}, but ${command} is not available in Frakio runtime PATH.`);
    error.code = 'ENOENT';
    throw error;
  }
  const args = Array.isArray(serverConfig.args) ? serverConfig.args.map(String) : [];
  const child = spawn(resolvedCommand, args, {
    cwd: projectRoot,
    env: runtimeEnv(serverConfig.env || {}),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  child.stdin.end();
  const exitPromise = new Promise((resolve) => child.on('close', resolve));
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => {
    child.kill('SIGTERM');
    reject(new Error('MCP stdio probe timed out.'));
  }, 7000));
  await Promise.race([exitPromise, timeoutPromise]);
  if (stderr.trim() && !stdout.trim()) throw new Error(stderr.trim());
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const responses = lines.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const tools = responses.find((item) => item.id === 2)?.result?.tools || [];
  return tools.map((tool) => String(tool?.name || '')).filter(Boolean);
}

function isWorkbenchMcpServer(name, config = {}) {
  return String(name || '').startsWith('hermes-workbench-') || Boolean(config?.env?.HERMES_WORKBENCH_MCP_TOOLSET);
}

function normalizeMcpServerConfig(input = {}) {
  const transport = String(input.transport || (input.url ? 'http' : 'stdio')).toLowerCase() === 'http' ? 'http' : 'stdio';
  const next = {};
  if (transport === 'http') {
    const url = String(input.url || '').trim();
    if (!url) throw Object.assign(new Error('HTTP MCP Server 需要填写 URL。'), { status: 400 });
    next.url = url;
    const headers = objectFromMcpPairs(input.headers);
    if (Object.keys(headers).length) next.headers = headers;
    if (input.auth) next.auth = String(input.auth).trim();
  } else {
    const command = String(input.command || '').trim();
    if (!command) throw Object.assign(new Error('stdio MCP Server 需要填写 command。'), { status: 400 });
    next.command = command;
    const args = arrayFromMcpValue(input.args);
    if (args.length) next.args = args;
    const env = objectFromMcpPairs(input.env);
    if (Object.keys(env).length) next.env = env;
  }
  next.enabled = input.enabled !== false;
  const timeout = Number(input.timeout || 0);
  const connectTimeout = Number(input.connectTimeout || input.connect_timeout || 0);
  if (timeout > 0) next.timeout = timeout;
  if (connectTimeout > 0) next.connect_timeout = connectTimeout;
  if (input.supports_parallel_tool_calls !== undefined) next.supports_parallel_tool_calls = Boolean(input.supports_parallel_tool_calls);
  const tools = input.tools && typeof input.tools === 'object' ? input.tools : {};
  const normalizedTools = {};
  const include = arrayFromMcpValue(tools.include);
  const exclude = arrayFromMcpValue(tools.exclude);
  if (include.length) normalizedTools.include = include;
  if (exclude.length) normalizedTools.exclude = exclude;
  if (tools.resources !== undefined) normalizedTools.resources = Boolean(tools.resources);
  if (tools.prompts !== undefined) normalizedTools.prompts = Boolean(tools.prompts);
  if (Object.keys(normalizedTools).length) next.tools = normalizedTools;
  return next;
}

function preserveMaskedMcpSecrets(current = {}, next = {}) {
  for (const key of ['env', 'headers']) {
    if (!next[key] || typeof next[key] !== 'object') continue;
    const currentValues = current[key] && typeof current[key] === 'object' ? current[key] : {};
    for (const [itemKey, value] of Object.entries(next[key])) {
      if (String(value) === '••••••••' && currentValues[itemKey] !== undefined) next[key][itemKey] = currentValues[itemKey];
    }
  }
  return next;
}

function publicMcpServer(name, config = {}, extras = {}) {
  const tools = Array.isArray(extras.tools) ? extras.tools : knownManagedMcpTools(name, config);
  const enabled = config.enabled !== false;
  const connected = Boolean(enabled && tools.length && !extras.error);
  const env = config.env && typeof config.env === 'object' ? config.env : {};
  const headers = config.headers && typeof config.headers === 'object' ? config.headers : {};
  const maskRecord = (record) => Object.fromEntries(Object.entries(record).map(([key, value]) => {
    const sensitive = /token|key|secret|password|authorization/i.test(key);
    return [key, sensitive && value ? '••••••••' : String(value)];
  }));
  return {
    name,
    transport: mcpTransportFromConfig(config),
    command: config.command || '',
    args: Array.isArray(config.args) ? config.args : [],
    env: maskRecord(env),
    url: config.url || '',
    headers: maskRecord(headers),
    auth: config.auth || '',
    enabled,
    status: extras.status || (enabled ? (connected ? 'connected' : 'configured') : 'disabled'),
    statusLabel: extras.status === 'failed' ? '启动失败' : enabled ? (connected ? '已连接' : '待重载') : '已停用',
    tools,
    toolCount: tools.length,
    availableToolCount: tools.length,
    timeout: config.timeout || null,
    connectTimeout: config.connect_timeout || null,
    supportsParallelToolCalls: Boolean(config.supports_parallel_tool_calls),
    filter: config.tools || {},
    error: extras.error || '',
  };
}

async function readMcpConfig(profileName = 'default') {
  const cleanProfile = slug(profileName || 'default');
  await ensureWorkbenchMcpServers(cleanProfile);
  const configPath = mcpConfigPathForProfile(cleanProfile);
  const config = await readYamlFile(configPath);
  const servers = config.mcp_servers && typeof config.mcp_servers === 'object' ? config.mcp_servers : {};
  const missingCommands = await findMissingMcpCommands(cleanProfile);
  const missingByServer = new Map(missingCommands.map((item) => [item.serverName, item]));
  const publicServers = Object.entries(servers).map(([name, serverConfig]) => {
    const missing = missingByServer.get(name);
    return publicMcpServer(name, serverConfig, missing ? { status: 'failed', error: missing.message } : {});
  }).sort((a, b) => a.name.localeCompare(b.name));
  const stats = {
    total: publicServers.length,
    connected: publicServers.filter((server) => server.enabled && server.status === 'connected').length,
    disconnected: publicServers.filter((server) => !server.enabled || server.status !== 'connected').length,
    tools: publicServers.reduce((sum, server) => sum + server.toolCount, 0),
  };
  return {
    profile: cleanProfile,
    configPath,
    servers: publicServers,
    stats,
    runtime: { bridgeReady: Boolean(hermesBridgeProcess), lastError: hermesBridgeLastError || '' },
  };
}

async function ensureWorkbenchMcpServers(profileName = 'default') {
  const cleanProfile = slug(profileName || 'default');
  const configPath = mcpConfigPathForProfile(cleanProfile);
  await mkdir(path.dirname(configPath), { recursive: true });
  const config = await readYamlFile(configPath);
  const servers = config.mcp_servers && typeof config.mcp_servers === 'object' ? { ...config.mcp_servers } : {};
  let changed = false;
  for (const toolset of ['api', 'use']) {
    const name = `hermes-workbench-${toolset}`;
    const desired = workbenchMcpServerConfig(toolset, cleanProfile);
    if (!servers[name]) {
      servers[name] = desired;
      changed = true;
      continue;
    }
    const current = servers[name] || {};
    const next = {
      ...current,
      command: desired.command,
      args: desired.args,
      env: { ...(current.env || {}), ...desired.env },
      enabled: current.enabled !== false,
    };
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      servers[name] = next;
      changed = true;
    }
  }
  if (!changed) return;
  config.mcp_servers = servers;
  await writeFile(configPath, YAML.stringify(config), 'utf8');
}

async function updateMcpServers(profileName, updater) {
  const cleanProfile = slug(profileName || 'default');
  const configPath = mcpConfigPathForProfile(cleanProfile);
  await mkdir(path.dirname(configPath), { recursive: true });
  const config = await readYamlFile(configPath);
  const servers = config.mcp_servers && typeof config.mcp_servers === 'object' ? { ...config.mcp_servers } : {};
  const nextServers = await updater(servers);
  if (nextServers && Object.keys(nextServers).length) config.mcp_servers = nextServers;
  else delete config.mcp_servers;
  await writeFile(configPath, YAML.stringify(config), 'utf8');
  return readMcpConfig(cleanProfile);
}

async function resolveHermesExecutable() {
  const candidates = [
    process.env.HERMES_BIN,
    path.join(hermesAgentSourcePath, '.venv', 'bin', 'hermes'),
    path.join(hermesAgentSourcePath, 'venv', 'bin', 'hermes'),
    path.join(hermesAgentSourcePath, 'hermes'),
    path.join(hermesHome, 'hermes-agent', '.venv', 'bin', 'hermes'),
    path.join(hermesHome, 'hermes-agent', 'venv', 'bin', 'hermes'),
    path.join(hermesHome, 'hermes-agent', 'hermes'),
    await resolveCommand('hermes'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return candidates[0] || '';
}

function parseHermesMcpTestTools(output = '') {
  const tools = [];
  for (const line of String(output || '').split('\n')) {
    const match = line.match(/\b([A-Za-z_][A-Za-z0-9_.-]{2,})\b/);
    if (!match) continue;
    const value = match[1];
    if (/^(Testing|Transport|Auth|Connection|Tools|Found|Server|Status)$/i.test(value)) continue;
    if (!tools.includes(value)) tools.push(value);
  }
  return tools.slice(0, 200);
}

function normalizeProfileList(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const profiles = [];
  for (const item of source) {
    const clean = slug(item || '');
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    profiles.push(clean);
  }
  return profiles;
}

function gatewayManagementFromConfig(config) {
  const raw = config || {};
  if (raw.multiplex_profiles === true || raw.multiplex_profiles === 'true' || raw.gateway?.multiplex_profiles === true || raw.gateway?.multiplex_profiles === 'true') {
    return 'unified';
  }
  return 'per_profile';
}

function normalizeGatewayAutoStartConfig(value, defaultConfig = {}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const management = gatewayManagementModes.has(String(raw.management || '')) ? String(raw.management) : gatewayManagementFromConfig(defaultConfig);
  return {
    enabled: raw.enabled !== false,
    management,
    include: normalizeProfileList(raw.include),
    exclude: normalizeProfileList(raw.exclude),
  };
}

async function readGatewayAutoStartConfig() {
  const state = await readState();
  const defaultConfig = await readYamlFile(profileConfigPath('default'));
  return normalizeGatewayAutoStartConfig(state.integrations?.hermesAgent?.gatewayAutoStart, defaultConfig);
}

async function writeGatewayAutoStartConfig(values = {}) {
  const state = await readState();
  const previous = normalizeGatewayAutoStartConfig(state.integrations?.hermesAgent?.gatewayAutoStart, await readYamlFile(profileConfigPath('default')));
  const next = normalizeGatewayAutoStartConfig({ ...previous, ...values });
  if ('management' in values) {
    await updateProfileYaml('default', (current) => {
      if (next.management === 'unified') current.multiplex_profiles = true;
      else {
        delete current.multiplex_profiles;
        if (current.gateway && typeof current.gateway === 'object' && !Array.isArray(current.gateway)) delete current.gateway.multiplex_profiles;
      }
      return current;
    });
  }
  state.integrations.hermesAgent = {
    ...(state.integrations.hermesAgent || {}),
    gatewayAutoStart: next,
    lastCheckedAt: now(),
  };
  await writeState(state);
  return next;
}

async function registerProfileGatewayAutoStart(profileName) {
  const clean = slug(profileName || '');
  const current = await readGatewayAutoStartConfig();
  if (!clean || current.management !== 'per_profile') return current;
  const include = current.include.length
    ? Array.from(new Set([...current.include, clean]))
    : ['default', clean];
  const exclude = current.exclude.filter((name) => name !== clean);
  return writeGatewayAutoStartConfig({ include, exclude });
}

function normalizeJob(job) {
  const idValue = String(job?.job_id || job?.id || '').trim();
  const skills = Array.isArray(job?.skills) ? job.skills.map(String).filter(Boolean) : job?.skill ? [String(job.skill)] : [];
  const schedule = job?.schedule || '';
  const scheduleDisplay = job?.schedule_display || schedule?.display || schedule?.expr || schedule?.run_at || String(schedule || '');
  return {
    ...job,
    id: idValue,
    job_id: idValue,
    name: String(job?.name || job?.prompt || idValue || 'cron job').slice(0, 80),
    prompt: String(job?.prompt || ''),
    prompt_preview: String(job?.prompt || '').replace(/\s+/g, ' ').slice(0, 120),
    skills,
    skill: job?.skill || skills[0] || null,
    schedule,
    schedule_display: scheduleDisplay || '',
    repeat: job?.repeat || { times: null, completed: 0 },
    enabled: job?.enabled !== false,
    state: job?.state || (job?.enabled === false ? 'paused' : 'scheduled'),
    deliver: job?.deliver || 'local',
    next_run_at: job?.next_run_at || null,
    last_run_at: job?.last_run_at || null,
    last_status: job?.last_status || null,
    last_error: job?.last_error || null,
  };
}

function hermesCommandCandidates() {
  const candidates = [];
  if (process.env.HERMES_BIN) candidates.push({ command: process.env.HERMES_BIN, args: [], cwd: projectRoot });
  const frakioRuntime = findFrakioHermesRuntimeSync();
  if (frakioRuntime?.python) {
    candidates.push({ command: frakioRuntime.python, args: ['-m', 'hermes_cli.main'], cwd: hermesHome });
  }
  const sourceDirs = Array.from(new Set([
    hermesAgentSourcePath,
    path.join(hermesHome, 'hermes-agent'),
    path.join(homeDir, '.hermes', 'hermes-agent'),
  ]));
  for (const sourceDir of sourceDirs) {
    candidates.push({ command: path.join(sourceDir, 'hermes'), args: [], cwd: sourceDir });
  }
  candidates.push({ command: 'hermes', args: [], cwd: projectRoot });
  const uvCommands = Array.from(new Set(['uv', '/opt/homebrew/bin/uv', '/usr/local/bin/uv', path.join(homeDir, '.local', 'bin', 'uv')]));
  for (const uvCommand of uvCommands) {
    for (const sourceDir of sourceDirs) candidates.push({ command: uvCommand, args: ['run', 'hermes'], cwd: sourceDir });
  }
  return candidates;
}

async function runHermesCommand(args, options = {}) {
  const env = runtimeEnv({ HERMES_HOME: options.profile ? profileConfigDir(options.profile) : hermesHome });
  const errors = [];
  for (const candidate of hermesCommandCandidates()) {
    const commandArgs = [...candidate.args, ...args.map(String)];
    try {
      return await execFileAsync(candidate.command, commandArgs, {
        cwd: options.cwd || candidate.cwd,
        env,
        timeout: options.timeout || 60000,
        maxBuffer: options.maxBuffer || 50 * 1024 * 1024,
        windowsHide: true,
      });
    } catch (error) {
      const stderr = String(error?.stderr || '').trim();
      const stdout = String(error?.stdout || '').trim();
      const message = stderr || stdout || error?.message || 'Hermes command failed';
      errors.push(`${candidate.command} ${candidate.args.join(' ')}: ${message}`);
      if (error?.code === 'ENOENT') continue;
      if (process.env.HERMES_BIN) {
        const wrapped = new Error(message);
        wrapped.status = 500;
        throw wrapped;
      }
    }
  }
  const wrapped = new Error(errors.join('\n') || 'Hermes command is unavailable.');
  wrapped.status = 503;
  throw wrapped;
}

function kanbanBoard(value) {
  const board = slug(value || 'default');
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(board)) {
    const error = new Error('Invalid kanban board slug.');
    error.status = 400;
    throw error;
  }
  return board;
}

function selectedProviderConfig(config, providerKey) {
  const clean = String(providerKey || '').trim();
  if (!clean) return {};
  if (clean.startsWith('custom:')) {
    const key = clean.slice(7);
    return Object.fromEntries(customProviderEntries(config))[key] || config?.providers?.[key] || {};
  }
  return config?.providers?.[clean] || {};
}

function splitModelSelection(value) {
  const raw = String(value || '').trim();
  const separator = '::';
  if (!raw.includes(separator)) return { modelId: raw, modelName: '' };
  const [modelId, ...rest] = raw.split(separator);
  return { modelId: modelId.trim(), modelName: rest.join(separator).trim() };
}

function resolveModelSelection(modelValue, models = []) {
  const { modelId, modelName } = splitModelSelection(modelValue);
  const normalized = normalizeModels(models || []);
  const selectedModel = normalized.find((model) => model.id === modelId)
    || normalized.find((model) => [model.id, model.name, model.model].includes(String(modelValue || '').trim()))
    || normalized.find((model) => model.models?.includes(modelName));
  const selectedName = modelName || selectedModel?.model || String(modelValue || '').trim();
  return { selectedModel, selectedName };
}

async function readHermesProfileConfigs() {
  const rows = [];
  const rootConfig = path.join(hermesHome, 'config.yaml');
  if (await exists(rootConfig)) rows.push({ name: 'default', dir: hermesHome, config: await readYamlFile(rootConfig), envRaw: await readEnvValues(path.join(hermesHome, '.env')) });
  const profilesRoot = path.join(hermesHome, 'profiles');
  try {
    const entries = await readdir(profilesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(profilesRoot, entry.name);
      const configPath = path.join(dir, 'config.yaml');
      if (await exists(configPath)) rows.push({ name: entry.name, dir, config: await readYamlFile(configPath), envRaw: await readEnvValues(path.join(dir, '.env')) });
    }
  } catch {
    // Profiles are optional.
  }
  return rows;
}

async function ensureWorkbenchApiKey() {
  const envPath = path.join(hermesWorkbenchApiHome, '.env');
  const envValues = await readEnvValues(envPath);
  const existing = String(process.env.API_SERVER_KEY || envValues.API_SERVER_KEY || '').trim();
  if (existing) return existing;
  const key = `fw_${randomBytes(24).toString('hex')}`;
  await appendFile(envPath, `API_SERVER_KEY=${key}\n`, 'utf8');
  return key;
}

async function candidateHermesApiBaseUrls() {
  const envValues = await readEnvValues(path.join(hermesHome, '.env'));
  const apiConfig = await readYamlFile(path.join(hermesWorkbenchApiHome, 'config.yaml'));
  const configuredApi = apiConfig?.platforms?.api_server?.extra || {};
  const port = envValues.API_SERVER_PORT || process.env.API_SERVER_PORT || '8642';
  const host = envValues.API_SERVER_HOST || process.env.API_SERVER_HOST || '127.0.0.1';
  const configuredHost = configuredApi.host || host;
  const configuredPort = configuredApi.port || port;
  const rawCandidates = [
    process.env.HERMES_AGENT_API_URL,
    process.env.HERMES_API_BASE_URL,
    envValues.HERMES_AGENT_API_URL,
    envValues.HERMES_API_BASE_URL,
    configuredPort ? `http://${configuredHost}:${configuredPort}/v1` : '',
    `http://${host}:${port}/v1`,
    'http://127.0.0.1:8642/v1',
  ].filter(Boolean);
  return Array.from(new Set(rawCandidates.map((url) => String(url).replace(/\/+$/, '').replace('localhost', '127.0.0.1'))));
}

async function probeHermesAgentApi() {
  for (const baseUrl of await candidateHermesApiBaseUrls()) {
    const models = await fetchJson(`${baseUrl}/models`, { headers: hermesAgentHeaders(), timeoutMs: 1600 });
    if (models.ok) return { online: true, apiBaseUrl: baseUrl, apiStatus: models.status, models: parseModelIds(models.body), authMode: 'env-token' };
    const healthBase = baseUrl.replace(/\/v\d+$/i, '');
    const health = await fetchJson(`${healthBase}/health`, { headers: hermesAgentHeaders(), timeoutMs: 1200 });
    if (health.ok && !Object.keys(hermesAgentHeaders()).length) return { online: true, apiBaseUrl: baseUrl, apiStatus: health.status, models: [], authMode: 'health-only' };
  }
  return { online: false, apiBaseUrl: (await candidateHermesApiBaseUrls())[0] || 'http://127.0.0.1:8642/v1', apiStatus: 0, models: [], authMode: 'offline' };
}

async function configuredWorkbenchApiBaseUrl() {
  const apiConfig = await readYamlFile(path.join(hermesWorkbenchApiHome, 'config.yaml'));
  const extra = apiConfig?.platforms?.api_server?.extra || {};
  const configuredPort = extra.port;
  if (!configuredPort) return '';
  const configuredHost = extra.host || '127.0.0.1';
  return `http://${String(configuredHost).replace('localhost', '127.0.0.1')}:${configuredPort}/v1`;
}

async function probeConfiguredWorkbenchApi() {
  const baseUrl = await configuredWorkbenchApiBaseUrl();
  if (!baseUrl) return { online: false, apiBaseUrl: 'http://127.0.0.1:8642/v1', apiStatus: 0, models: [], authMode: 'offline' };
  const models = await fetchJson(`${baseUrl}/models`, { headers: hermesAgentHeaders(), timeoutMs: 1600 });
  if (models.ok) return { online: true, apiBaseUrl: baseUrl, apiStatus: models.status, models: parseModelIds(models.body), authMode: 'env-token' };
  const health = await fetchJson(`${baseUrl.replace(/\/v\d+$/i, '')}/health`, { headers: hermesAgentHeaders(), timeoutMs: 1200 });
  return { online: false, apiBaseUrl: baseUrl, apiStatus: models.status || health.status || 0, models: [], authMode: 'offline' };
}

async function startHermesAgentApi(logs = []) {
  const api = await probeConfiguredWorkbenchApi();
  if (api.online) return { ok: true, logs: ['Hermes Agent API already online.'], api };
  const runtime = await findFrakioHermesRuntime();
  if (!runtime) {
    const errorMessage = `未找到 Frakio Work 内置 Hermes runtime。请先运行 npm run prepare-runtime，或设置 FRAKIO_WORK_HERMES_RUNTIME 指向 Frakio Work 自己的 runtime。`;
    logs.push(errorMessage);
    return { ok: false, logs, api: await probeHermesAgentApi() };
  }
  const apiPort = await findFreeTcpPort(8642, '127.0.0.1');
  const apiHermesHome = await ensureWorkbenchApiHermesHome({ port: apiPort });
  const apiKey = await ensureWorkbenchApiKey();
  await cleanupStaleGatewayRuntimeFiles(apiHermesHome, logs);
  const args = ['-m', 'hermes_cli.main', 'gateway', 'run', '--replace', '--force'];
  const logFile = runtimeApiLogPath();
  pushRuntimeLog(logs, `using Frakio ${runtime.source} runtime: ${runtime.runtimeDir}`);
  pushRuntimeLog(logs, `starting: ${runtime.python} ${args.join(' ')} on http://127.0.0.1:${apiPort}/v1`);
  hermesApiProcess = spawn(runtime.python, args, {
    cwd: apiHermesHome,
    env: runtimeEnv({
      HERMES_HOME: apiHermesHome,
      HERMES_AGENT_ROOT: runtime.pythonRoot,
      API_SERVER_ENABLED: 'true',
      API_SERVER_KEY: apiKey,
      API_SERVER_HOST: '127.0.0.1',
      API_SERVER_PORT: String(apiPort),
      API_SERVER_CORS_ORIGINS: 'http://127.0.0.1:5173,http://127.0.0.1:5174,http://localhost:5173,http://localhost:5174,http://127.0.0.1:8787',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  attachRuntimeProcessLogs(hermesApiProcess, logFile, logs);
  if (process.platform !== 'win32') hermesApiProcess.unref();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const nextApi = await probeHermesAgentApi();
    if (nextApi.online) return { ok: true, logs, api: nextApi };
  }
  pushRuntimeLog(logs, `Runtime API did not become ready. See ${logFile}`);
  const finalApi = await probeHermesAgentApi();
  return { ok: finalApi.online, logs, api: finalApi };
}

function hermesAgentHeaders() {
  let envToken = '';
  for (const envPath of [path.join(hermesWorkbenchApiHome, '.env'), path.join(hermesHome, '.env')]) {
    try {
      const raw = readFileSync(envPath, 'utf8');
      envToken = raw.split(/\r?\n/).map((line) => line.match(/^API_SERVER_KEY=(.*)$/)?.[1]).find(Boolean) || envToken;
      if (envToken) break;
    } catch {
      // Missing env files are normal before runtime initialization.
    }
  }
  const token = String(process.env.API_SERVER_KEY || process.env.HERMES_AGENT_API_KEY || envToken || '').trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function hermesAgentRunHeaders(sessionId = '') {
  const headers = hermesAgentHeaders();
  if (sessionId && headers.Authorization) headers['X-Hermes-Session-Key'] = sessionId;
  return headers;
}

function hermesBridgeEndpoint() {
  if (process.env.HERMES_AGENT_BRIDGE_ENDPOINT) return process.env.HERMES_AGENT_BRIDGE_ENDPOINT;
  if (process.platform === 'win32') return 'tcp://127.0.0.1:18766';
  return `ipc://${path.join(hermesWorkbenchRuntimeHome, 'agent-bridge.sock')}`;
}

function hermesBridgeSocketTarget(endpoint = hermesBridgeEndpoint()) {
  if (endpoint.startsWith('ipc://')) return { kind: 'ipc', path: endpoint.slice('ipc://'.length) };
  if (endpoint.startsWith('tcp://')) {
    const url = new URL(endpoint);
    return { kind: 'tcp', host: url.hostname || '127.0.0.1', port: Number(url.port) };
  }
  throw new Error(`Unsupported Hermes Bridge endpoint: ${endpoint}`);
}

function connectHermesBridgeSocket(endpoint = hermesBridgeEndpoint()) {
  const target = hermesBridgeSocketTarget(endpoint);
  return target.kind === 'ipc'
    ? net.createConnection(target.path)
    : net.createConnection({ host: target.host, port: target.port });
}

function isRetryableBridgeError(error) {
  return ['ECONNREFUSED', 'ENOENT', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(String(error?.code || ''));
}

async function requestHermesBridge(payload, options = {}) {
  const endpoint = options.endpoint || hermesBridgeEndpoint();
  const timeoutMs = options.timeoutMs || 120000;
  const retryMs = options.retryMs ?? 0;
  const deadline = Date.now() + Math.max(0, retryMs);
  for (;;) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = connectHermesBridgeSocket(endpoint);
        let buffer = '';
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error(`Hermes Bridge request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timer);
          socket.removeAllListeners();
        };
        socket.once('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const lineEnd = buffer.indexOf('\n');
          if (lineEnd < 0) return;
          const line = buffer.slice(0, lineEnd).trim();
          cleanup();
          socket.end();
          try {
            const response = JSON.parse(line);
            if (!response?.ok) {
              const error = new Error(response?.error || 'Hermes Bridge request failed.');
              error.response = response;
              reject(error);
              return;
            }
            resolve(response);
          } catch (error) {
            reject(error);
          }
        });
        socket.once('error', (error) => {
          cleanup();
          socket.destroy();
          reject(error);
        });
        socket.once('close', () => {
          if (!buffer.trim()) {
            cleanup();
            reject(new Error('Hermes Bridge socket closed without a response.'));
          }
        });
      });
    } catch (error) {
      if (!isRetryableBridgeError(error) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function processStartedAtMs(pid) {
  const cleanPid = Number(pid);
  if (!Number.isFinite(cleanPid) || cleanPid <= 0) return 0;
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'lstart=', '-p', String(cleanPid)], { timeout: 1500 });
    const text = String(stdout || '').trim();
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

async function bridgeProcessSummary(ping = {}) {
  const brokerPid = Number(ping?.broker?.pid || 0);
  const workerDetails = ping?.worker_details && typeof ping.worker_details === 'object' ? ping.worker_details : {};
  const brokerStartedAtMs = await processStartedAtMs(brokerPid);
  const ownedByThisApi = Boolean(hermesBridgeProcess?.pid && brokerPid === hermesBridgeProcess.pid);
  return {
    brokerPid: Number.isFinite(brokerPid) && brokerPid > 0 ? brokerPid : null,
    brokerStartedAt: brokerStartedAtMs ? new Date(brokerStartedAtMs).toISOString() : null,
    owner: ownedByThisApi ? 'frakio-current-api' : brokerPid ? 'external-or-stale' : 'unknown',
    ownedByThisApi,
    startedBeforeApi: Boolean(brokerStartedAtMs && brokerStartedAtMs < apiStartedAtMs - 1000),
    workers: ping?.workers || {},
    workerDetails,
  };
}

function collectBridgePids(ping = {}) {
  const pids = new Set();
  const brokerPid = Number(ping?.broker?.pid || 0);
  if (Number.isFinite(brokerPid) && brokerPid > 0) pids.add(brokerPid);
  const workerDetails = ping?.worker_details && typeof ping.worker_details === 'object' ? ping.worker_details : {};
  for (const detail of Object.values(workerDetails)) {
    const pid = Number(detail?.pid || 0);
    if (Number.isFinite(pid) && pid > 0) pids.add(pid);
  }
  return [...pids].filter((pid) => pid !== process.pid);
}

async function terminatePids(pids, logs, reason) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      logs?.push?.(`terminating ${reason} pid=${pid}`);
    } catch (error) {
      if (error?.code !== 'ESRCH') logs?.push?.(`failed to terminate ${reason} pid=${pid}: ${error.message || error}`);
    }
  }
  if (pids.length) await new Promise((resolve) => setTimeout(resolve, 600));
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
    } catch {
      continue;
    }
    try {
      process.kill(pid, 'SIGKILL');
      logs?.push?.(`force killed ${reason} pid=${pid}`);
    } catch (error) {
      if (error?.code !== 'ESRCH') logs?.push?.(`failed to force kill ${reason} pid=${pid}: ${error.message || error}`);
    }
  }
}

async function cleanupStaleHermesBridge(current, logs = []) {
  const endpoint = current?.endpoint || hermesBridgeEndpoint();
  if (process.env.HERMES_AGENT_BRIDGE_ENDPOINT) return;
  const pids = collectBridgePids(current?.ping || {});
  await terminatePids(pids, logs, 'stale Hermes Bridge');
  if (endpoint.startsWith('ipc://')) await unlink(endpoint.slice('ipc://'.length)).catch(() => null);
}

async function probeHermesBridge(options = {}) {
  const endpoint = hermesBridgeEndpoint();
  try {
    const ping = await requestHermesBridge({ action: 'ping' }, { endpoint, timeoutMs: options.timeoutMs || 1200, retryMs: options.retryMs ?? 0 });
    const processInfo = await bridgeProcessSummary(ping);
    return { endpoint, running: true, ready: true, status: 'ready', error: '', ping, ...processInfo };
  } catch (error) {
    return { endpoint, running: false, ready: false, status: 'unreachable', error: String(error?.message || error) };
  }
}

function resolveExecutableSync(command) {
  if (!command) return '';
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) return existsSync(command) ? command : '';
  try {
    const resolver = process.platform === 'win32' ? 'where.exe' : '/usr/bin/which';
    return execFileSync(resolver, [command], { encoding: 'utf8', timeout: 2000, env: runtimeEnv() }).trim().split(/\r?\n/)[0] || '';
  } catch {
    return '';
  }
}

function versionedDirsSync(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareVersionDesc);
  } catch {
    return [];
  }
}

function findHermesNodeSync() {
  const runtime = findFrakioHermesRuntimeSync();
  return [
    process.env.FRAKIO_WORK_MCP_NODE,
    runtime?.node,
    resolveExecutableSync('node'),
    process.execPath,
  ].filter(Boolean).find((candidate) => existsSync(candidate)) || process.execPath;
}

function compareVersionDesc(a, b) {
  const left = String(a || '').match(/\d+/g)?.map(Number) || [];
  const right = String(b || '').match(/\d+/g)?.map(Number) || [];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (right[index] || 0) - (left[index] || 0);
    if (diff) return diff;
  }
  return String(b || '').localeCompare(String(a || ''));
}

async function versionedDirs(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(compareVersionDesc);
  } catch {
    return [];
  }
}

async function firstExistingFile(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    if (await exists(candidate)) return candidate;
  }
  return '';
}

async function findHermesBridgeScript() {
  return (await findFrakioBridgeScript())?.path || '';
}

async function findHermesBridgePython() {
  return (await findFrakioHermesRuntime())?.python || '';
}

async function findHermesAgentRoot() {
  return (await findFrakioHermesRuntime())?.pythonRoot || '';
}

async function startHermesBridge() {
  const current = await probeHermesBridge({ timeoutMs: 1000 });
  const endpoint = hermesBridgeEndpoint();
  const logs = [];
  if (current.ready) {
    const owned = Boolean(current.ownedByThisApi);
    const stale = Boolean(!process.env.HERMES_AGENT_BRIDGE_ENDPOINT && (!owned || current.startedBeforeApi));
    if (!stale) return { bridge: current, logs: ['Hermes Bridge already ready.'] };
    logs.push(`found stale Hermes Bridge broker pid=${current.brokerPid || 'unknown'} owner=${current.owner || 'unknown'}`);
    await cleanupStaleHermesBridge(current, logs);
  }
  const script = await findHermesBridgeScript();
  const python = await findHermesBridgePython();
  const agentRoot = await findHermesAgentRoot();
  if (!script) throw new Error('未找到 Hermes Agent Bridge 脚本 hermes_bridge.py。');
  if (!python) throw new Error('未找到可用 Python runtime。');
  await mkdir(hermesWorkbenchRuntimeHome, { recursive: true });
  if (endpoint.startsWith('ipc://') && !process.env.HERMES_AGENT_BRIDGE_ENDPOINT) {
    await unlink(endpoint.slice('ipc://'.length)).catch(() => null);
  }
  const args = [script, '--endpoint', endpoint, '--hermes-home', hermesHome];
  if (agentRoot) args.push('--agent-root', agentRoot);
  logs.push(`starting bridge: ${python} ${args.join(' ')}`);
  hermesBridgeProcess = spawn(python, args, {
    env: runtimeEnv({
      HERMES_HOME: hermesHome,
      HERMES_AGENT_BRIDGE_ENDPOINT: endpoint,
      ...(agentRoot ? { HERMES_AGENT_ROOT: agentRoot } : {}),
    }),
    cwd: projectRoot,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  hermesBridgeProcess.on('error', (error) => { hermesBridgeLastError = error.message; });
  hermesBridgeProcess.on('exit', (code, signal) => { hermesBridgeLastError = `Bridge exited code=${code} signal=${signal}`; });
  if (process.platform !== 'win32') hermesBridgeProcess.unref();
  const bridge = await probeHermesBridge({ timeoutMs: 1000, retryMs: 15000 });
  if (!bridge.ready) {
    hermesBridgeLastError = bridge.error || 'Bridge did not become ready.';
    throw new Error(hermesBridgeLastError);
  }
  hermesBridgeLastError = '';
  return { bridge, logs };
}

async function profileGatewayStatus(profileName) {
  const profileArg = profileName && profileName !== 'default' ? ['--profile', profileName] : [];
  const python = await findHermesBridgePython();
  if (!python) return { profileName, running: false, status: 'unknown', error: '未找到 Hermes runtime。' };
  try {
    const { stdout } = await execFileAsync(python, ['-m', 'hermes_cli.main', ...profileArg, 'gateway', 'status'], {
      timeout: 4000,
      env: runtimeEnv({ HERMES_HOME: hermesHome }),
    });
    const text = String(stdout || '').trim();
    const running = /running|运行中|"PID"\s*=|PID\s*[:=]|\bPID\s+\d+|✓\s+\S+/i.test(text);
    return { profileName, running, status: text || 'unknown', error: '' };
  } catch (error) {
    return { profileName, running: false, status: 'unknown', error: String(error?.stderr || error?.message || error).slice(0, 500) };
  }
}

async function startProfileGateway(profileName) {
  const python = await findHermesBridgePython();
  if (!python) throw new Error('未找到 Hermes runtime。');
  const profileArg = profileName && profileName !== 'default' ? ['--profile', profileName] : [];
  const child = spawn(python, ['-m', 'hermes_cli.main', ...profileArg, 'gateway', 'run', '--replace'], {
    env: runtimeEnv({ HERMES_HOME: hermesHome }),
    cwd: hermesHome,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  profileGatewayProcesses.add(child);
  child.once('exit', () => profileGatewayProcesses.delete(child));
  let spawnError = '';
  child.on('error', (error) => {
    spawnError = error.message || String(error);
  });
  if (process.platform !== 'win32') child.unref();
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (spawnError) return { profileName: profileName || 'default', running: false, status: 'unknown', error: spawnError };
  return profileGatewayStatus(profileName || 'default');
}

function resetHermesAutoStartState(status = 'starting') {
  hermesAutoStartState = {
    status,
    startedAt: now(),
    finishedAt: null,
    steps: [],
    logs: [],
    error: '',
    warnings: [],
  };
}

function addHermesAutoStartStep(id, label, status, detail = '', severity = 'standard') {
  const existingIndex = hermesAutoStartState.steps.findIndex((step) => step.id === id);
  const step = { ...runtimeStep(id, label, status, detail, severity), updatedAt: now() };
  if (existingIndex >= 0) hermesAutoStartState.steps[existingIndex] = { ...hermesAutoStartState.steps[existingIndex], ...step };
  else hermesAutoStartState.steps.push(step);
  if (detail) hermesAutoStartState.logs.push(`${label}: ${detail}`);
}

function gatewayAutoStartTargets(profiles, config) {
  if (!config.enabled) return [];
  const profileNames = profiles.map((profile) => profile.name).filter(Boolean);
  if (!profileNames.length) return ['default'];
  if (config.management === 'unified') return [profileNames.includes('default') ? 'default' : profileNames[0]];
  const included = config.include.length ? profileNames.filter((name) => config.include.includes(name)) : profileNames.filter((name) => name === 'default');
  const filtered = included.filter((name) => !config.exclude.includes(name));
  return filtered.length ? filtered : profileNames.includes('default') && !config.exclude.includes('default') ? ['default'] : [];
}

async function ensureHermesRuntimeReady({ force = false } = {}) {
  if (hermesAutoStartPromise && !force) return hermesAutoStartPromise;
  const run = (async () => {
    resetHermesAutoStartState('starting');
    try {
      addHermesAutoStartStep('home', '初始化 Hermes Home', 'running', '', 'core');
      await ensureHermesBaseConfig(hermesAutoStartState.logs);
      addHermesAutoStartStep('home', '初始化 Hermes Home', 'ready', hermesHome, 'core');

      addHermesAutoStartStep('profiles', '读取本地 Hermes Profiles', 'running');
      const profiles = await readHermesProfiles();
      addHermesAutoStartStep('profiles', '读取本地 Hermes Profiles', profiles.length ? 'ready' : 'skipped', profiles.length ? `${profiles.length} profiles` : '未发现 profile');

      addHermesAutoStartStep('bridge', '启动 Frakio Work Bridge', 'running', '', 'core');
      try {
        const startedBridge = await startHermesBridge();
        hermesAutoStartState.logs.push(...(startedBridge.logs || []));
        addHermesAutoStartStep('bridge', '启动 Frakio Work Bridge', startedBridge.bridge?.ready ? 'ready' : 'failed', startedBridge.bridge?.endpoint || '', 'core');
      } catch (error) {
        addHermesAutoStartStep('bridge', '启动 Frakio Work Bridge', 'failed', String(error?.message || error), 'core');
      }

      addHermesAutoStartStep('api', '启动外部兼容 API', 'running', '', 'optional');
      try {
        const apiLogs = [];
        const startedApi = await startHermesAgentApi(apiLogs);
        hermesAutoStartState.logs.push(...(startedApi.logs || apiLogs));
        const apiDetail = startedApi.api?.online
          ? startedApi.api?.apiBaseUrl
          : (startedApi.logs || apiLogs).slice(-8).join('\n') || startedApi.api?.apiBaseUrl || 'Runtime API 未启动';
        addHermesAutoStartStep('api', '启动外部兼容 API', startedApi.api?.online ? 'ready' : 'warning', apiDetail || 'http://127.0.0.1:8642/v1', 'optional');
      } catch (error) {
        addHermesAutoStartStep('api', '启动外部兼容 API', 'warning', String(error?.message || error), 'optional');
      }

      addHermesAutoStartStep('gateways', '启动 Profile Gateway', 'running');
      try {
        const config = await readGatewayAutoStartConfig();
        const targets = gatewayAutoStartTargets(profiles, config);
        if (!config.enabled) {
          addHermesAutoStartStep('gateways', '启动 Profile Gateway', 'skipped', 'Gateway 自动启动已关闭');
        } else if (!targets.length) {
          addHermesAutoStartStep('gateways', '启动 Profile Gateway', 'skipped', '没有匹配的 profile');
        } else {
          const failed = [];
          for (const profileName of targets) {
            const gateway = await startProfileGateway(profileName);
            if (!gateway.running) failed.push(`${profileName}: ${gateway.error || gateway.status || '未运行'}`);
          }
          addHermesAutoStartStep('gateways', '启动 Profile Gateway', failed.length ? 'failed' : 'ready', failed.length ? failed.join('; ') : targets.join(', '));
        }
      } catch (error) {
        addHermesAutoStartStep('gateways', '启动 Profile Gateway', 'failed', String(error?.message || error));
      }

      const summary = summarizeRuntimeAutoStart(hermesAutoStartState.steps);
      hermesAutoStartState.status = summary.status;
      hermesAutoStartState.error = summary.error;
      hermesAutoStartState.warnings = summary.warnings;
      hermesAutoStartState.finishedAt = now();
      return hermesAutoStartState;
    } catch (error) {
      hermesAutoStartState.status = 'failed';
      hermesAutoStartState.error = String(error?.message || error);
      hermesAutoStartState.finishedAt = now();
      return hermesAutoStartState;
    } finally {
      hermesAutoStartPromise = null;
    }
  })();
  hermesAutoStartPromise = run;
  return run;
}

async function hermesRuntimeStatus() {
  const bridge = await probeHermesBridge({ timeoutMs: 1000 });
  const profiles = await readHermesProfiles();
  const tools = await runtimeToolDiagnostics();
  const runtime = await findFrakioHermesRuntime();
  const manager = await runtimeManagerStatus();
  const gateways = [];
  for (const profile of profiles.slice(0, 24)) {
    gateways.push(await profileGatewayStatus(profile.name));
  }
  return {
    bridge,
    profiles,
    gateways,
    hermesHome,
    frakioWorkHome,
    agentRoot: runtime?.pythonRoot || '',
    runtime: runtimePublicInfo(runtime),
    manager,
    tools,
    workbenchMcp: workbenchMcpDiagnostics(profiles.find((profile) => profile.name === 'iris') ? 'iris' : profiles[0]?.name || 'default'),
    lastError: hermesBridgeLastError,
    autoStart: hermesAutoStartState,
    checkedAt: now(),
  };
}

async function hermesRuntimeDiagnostics() {
  const [profiles, bridge, runtimeApi, bridgeScript, python, agentRoot, tools, runtime, appVersion, serverFileStat] = await Promise.all([
    readHermesProfiles(),
    probeHermesBridge({ timeoutMs: 1000 }),
    probeHermesAgentApi(),
    findHermesBridgeScript(),
    findHermesBridgePython(),
    findHermesAgentRoot(),
    runtimeToolDiagnostics(),
    findFrakioHermesRuntime(),
    readFrakioPackageVersion(),
    stat(fileURLToPath(import.meta.url)).catch(() => null),
  ]);
  const buildTime = String(process.env.FRAKIO_WORK_BUILD_TIME || serverFileStat?.mtime?.toISOString?.() || '');
  const buildFingerprint = createHash('sha256').update(`${appVersion}|${buildTime}|${appRoot}`).digest('hex').slice(0, 12);
  const profileGateways = [];
  for (const profile of profiles.slice(0, 24)) {
    profileGateways.push(await profileGatewayStatus(profile.name));
  }
  return {
    checkedAt: now(),
    workbenchApi: {
      online: true,
      url: `http://127.0.0.1:${port}`,
      pid: process.pid,
      port,
      version: appVersion,
      buildTime,
      buildFingerprint,
      packaged: process.env.FRAKIO_WORK_PACKAGED === '1',
    },
    frakioWorkHome: {
      path: frakioWorkHome,
      exists: await exists(frakioWorkHome),
      apiHome: hermesWorkbenchApiHome,
      runtimeHome: hermesWorkbenchRuntimeHome,
    },
    hermesHome: {
      path: hermesHome,
      exists: await exists(hermesHome),
      configExists: await exists(path.join(hermesHome, 'config.yaml')),
      profileCount: profiles.length,
      profileNames: profiles.map((profile) => profile.name),
    },
    agentRoot: {
      path: agentRoot,
      exists: Boolean(agentRoot),
    },
    runtime: runtime ? {
      source: runtime.source,
      runtimeDir: runtime.runtimeDir,
      pythonRoot: runtime.pythonRoot,
      python: runtime.python,
      node: runtime.node,
      version: runtime.version,
      platform: runtime.platform,
      bridgeProtocolVersion: runtime.bridgeProtocolVersion,
      manifest: runtime.manifest || null,
    } : null,
    bridgeScript: {
      path: bridgeScript,
      exists: Boolean(bridgeScript),
    },
    python: {
      path: python,
      exists: Boolean(python),
    },
    tools,
    workbenchMcp: workbenchMcpDiagnostics(profiles.find((profile) => profile.name === 'iris') ? 'iris' : profiles[0]?.name || 'default'),
    bridge,
    runtimeApi,
    profileGateways,
    autoStart: hermesAutoStartState,
  };
}

function compactString(value, max = 180) {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

function firstString(...values) {
  for (const value of values) {
    const text = compactString(value);
    if (text) return text;
  }
  return '';
}

function collectToolPaths(event) {
  const candidates = [
    event?.path,
    event?.file,
    event?.filepath,
    event?.file_path,
    event?.target,
    event?.cwd,
    ...(Array.isArray(event?.paths) ? event.paths : []),
    ...(Array.isArray(event?.files) ? event.files : []),
  ];
  const paths = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'string') paths.push(candidate);
    else if (typeof candidate === 'object') paths.push(candidate.path || candidate.file || candidate.name || '');
  }
  return Array.from(new Set(paths.map((item) => compactString(item, 220)).filter(Boolean))).slice(0, 6);
}

function toolDisplayFromEvent(event, fallbackTitle) {
  const toolName = firstString(event?.toolName, event?.tool_name, event?.tool, event?.name, event?.function_name, event?.skill);
  const skillName = firstString(event?.skillName, event?.skill_name, event?.skill);
  const paths = collectToolPaths(event);
  const fileCount = Number(event?.fileCount || event?.file_count || event?.files_count || (paths.length ? paths.length : 0)) || undefined;
  const argsPreview = firstString(event?.argsPreview, event?.args_preview, event?.arguments, event?.args, event?.input, event?.command, event?.command_preview);
  const resultPreview = firstString(event?.resultPreview, event?.result_preview, event?.output_preview, event?.result, event?.output, event?.preview);
  const detail = firstString(
    event?.detail,
    paths.length ? paths.join(' · ') : '',
    fileCount ? `${fileCount} 个文件` : '',
    argsPreview,
    resultPreview,
  );
  const rawTitle = firstString(event?.title, event?.label, event?.preview);
  const title = rawTitle && rawTitle !== toolName ? rawTitle : toolName ? `调用 ${toolName}` : fallbackTitle;
  return {
    toolName,
    skillName,
    title,
    label: title,
    detail,
    paths,
    fileCount,
    argsPreview,
    resultPreview,
    callId: firstString(event?.callId, event?.call_id, event?.tool_call_id, event?.id, event?.run_step_id, `${toolName}:${rawTitle || argsPreview || detail}`),
  };
}

function normalizeBridgeEvent(event) {
  const eventName = String(event?.event || event?.type || '');
  if (/clarify.*resolved|clarify.*responded/i.test(eventName)) {
    return { event: 'clarify.responded', clarifyId: event.clarify_id || event.clarifyId || event.id || '', skipped: Boolean(event.skipped), resolved: event.resolved, error: event.error || '', raw: event };
  }
  if (/clarify.*request/i.test(eventName) || event?.clarify_id) {
    return { event: 'clarify.request', clarifyId: event.clarify_id || event.clarifyId || event.id || '', question: event.question || event.title || '需要你补充一个选择', choices: Array.isArray(event.choices) ? event.choices : [], timeoutMs: Number(event.timeout_ms || event.timeoutMs || 0) || undefined, raw: event };
  }
  if (/approval.*resolved|approval.*responded/i.test(eventName)) {
    return {
      event: 'approval.responded',
      approvalId: event.approval_id || event.approvalId || event.id || '',
      choice: event.choice || '',
      resolved: event.resolved,
      error: event.error || '',
      raw: event,
    };
  }
  if (/approval.*request/i.test(eventName) || event?.approval_id) {
    return { event: 'approval.request', approvalId: event.approval_id || event.id || '', title: event.title || event.description || '需要确认', command: event.command || event.command_preview || event.preview || '', cwd: event.cwd || '', tool: event.tool || event.tool_name || '' };
  }
  if (/tool.*start|tool.*running/i.test(eventName)) {
    const display = toolDisplayFromEvent(event, '正在调用工具');
    return { event: 'tool.running', tool: display.toolName || event.tool || event.name || '', ...display, raw: event };
  }
  if (/tool.*complete|tool.*end|tool.*result/i.test(eventName)) {
    const display = toolDisplayFromEvent(event, '工具调用完成');
    return { event: 'tool.completed', tool: display.toolName || event.tool || event.name || '', ...display, duration: event.duration || 0, error: Boolean(event.error), raw: event };
  }
  return null;
}

function approvalModeFromConfig(config) {
  const mode = String(config?.approvals?.mode || config?.approval?.mode || '').trim();
  return ['manual', 'smart', 'off'].includes(mode) ? mode : 'manual';
}

async function readApprovalConfig(profileName = 'default') {
  const targetDir = profileName && profileName !== 'default' ? path.join(hermesHome, 'profiles', profileName) : hermesHome;
  const configPath = path.join(targetDir, 'config.yaml');
  const config = await readYamlFile(configPath);
  return { profileName: profileName || 'default', configPath, mode: approvalModeFromConfig(config), raw: config?.approvals || {} };
}

async function writeApprovalMode(profileName, mode) {
  if (!['manual', 'smart', 'off'].includes(mode)) {
    const error = new Error('Unsupported approval mode.');
    error.status = 400;
    throw error;
  }
  const targetDir = profileName && profileName !== 'default' ? path.join(hermesHome, 'profiles', profileName) : hermesHome;
  await mkdir(targetDir, { recursive: true });
  const configPath = path.join(targetDir, 'config.yaml');
  const config = await readYamlFile(configPath);
  config.approvals = { ...(config.approvals || {}), mode };
  await writeFile(configPath, YAML.stringify(config), 'utf8');
  return { profileName: profileName || 'default', configPath, mode };
}

async function firstExistingDir(candidates) {
  for (const candidate of candidates) {
    if (candidate && await exists(candidate)) return candidate;
  }
  return '';
}

async function hashDirectory(dir) {
  const files = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  await walk(dir);
  const hasher = createHash('md5');
  for (const filePath of files.sort()) {
    hasher.update(path.relative(dir, filePath));
    hasher.update(await readFile(filePath).catch(() => Buffer.from('')));
  }
  return hasher.digest('hex');
}

async function syncBundledSkillsDisabled() {
  const sourceRoot = await firstExistingDir([
    path.join(hermesAgentSourcePath, 'skills'),
    path.join(hermesHome, 'hermes-agent', 'skills'),
    path.join(homeDir, '.hermes', 'hermes-agent', 'skills'),
  ]);
  if (!sourceRoot) return { sourceRoot: '', copied: [], skipped: [], disabled: [], totalBundled: 0 };
  const destRoot = path.join(hermesHome, 'skills');
  await mkdir(destRoot, { recursive: true });
  const manifestPath = path.join(destRoot, '.bundled_manifest');
  const skillFiles = await findFilesByName(sourceRoot, 'SKILL.md', 6);
  const copied = [];
  const skipped = [];
  const disabled = new Set(disabledSkillsFromConfig(await readYamlFile(path.join(hermesHome, 'config.yaml'))));

  for (const skillFile of skillFiles) {
    const sourceDir = path.dirname(skillFile);
    const raw = await readFile(skillFile, 'utf8').catch(() => '');
    const skillName = skillNameFromMarkdown(raw, path.basename(sourceDir));
    const relative = path.relative(sourceRoot, sourceDir);
    const destDir = path.join(destRoot, relative);
    if (await exists(destDir)) {
      skipped.push(skillName);
    } else {
      await mkdir(path.dirname(destDir), { recursive: true });
      await cp(sourceDir, destDir, { recursive: true, force: false, errorOnExist: false });
      copied.push(skillName);
      disabled.add(skillName);
    }
  }

  const configPath = path.join(hermesHome, 'config.yaml');
  const config = await readYamlFile(configPath);
  config.skills = { ...(typeof config.skills === 'object' && config.skills ? config.skills : {}), disabled: Array.from(disabled).sort() };
  await writeFile(configPath, YAML.stringify(config), 'utf8');

  const manifestRows = [];
  for (const skillFile of skillFiles) {
    const sourceDir = path.dirname(skillFile);
    const raw = await readFile(skillFile, 'utf8').catch(() => '');
    const skillName = skillNameFromMarkdown(raw, path.basename(sourceDir));
    manifestRows.push(`${skillName}:${await hashDirectory(sourceDir)}`);
  }
  await writeFile(manifestPath, `${manifestRows.sort().join('\n')}\n`, 'utf8');
  return { sourceRoot, copied, skipped, disabled: Array.from(disabled).sort(), totalBundled: skillFiles.length };
}

const gatewayPlatformConfigKeys = new Set([
  'platforms',
  'telegram',
  'discord',
  'whatsapp',
  'slack',
  'signal',
  'mattermost',
  'matrix',
  'homeassistant',
  'email',
  'sms',
  'dingtalk',
  'webhook',
  'msgraph_webhook',
  'feishu',
  'wecom',
  'wecom_callback',
  'weixin',
  'bluebubbles',
  'qqbot',
  'yuanbao',
]);

async function ensureSymlink(target, linkPath) {
  await mkdir(path.dirname(linkPath), { recursive: true });
  try {
    const existing = await stat(linkPath);
    if (existing) return;
  } catch {
    await symlink(target, linkPath, 'dir');
  }
}

function readRuntimePidFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
    const data = JSON.parse(raw);
    const pid = typeof data?.pid === 'number' ? data.pid : Number.parseInt(String(data?.pid || ''), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function cleanupStaleGatewayRuntimeFiles(profileDir, logs = []) {
  const runtimeFiles = ['gateway.pid', 'gateway.lock', 'gateway_state.json'];
  for (const fileName of runtimeFiles) {
    const filePath = path.join(profileDir, fileName);
    if (!(await exists(filePath))) continue;
    const pid = readRuntimePidFile(filePath);
    if (!pid) {
      pushRuntimeLog(logs, `preserved unverified runtime file: ${filePath}`);
      continue;
    }
    if (pid && isProcessAlive(pid)) continue;
    await rm(filePath, { force: true }).catch(() => null);
    pushRuntimeLog(logs, `removed stale runtime file: ${filePath}`);
  }
}

async function ensureWorkbenchApiHermesHome(options = {}) {
  const apiPort = Number(options.port || 8642);
  await mkdir(hermesWorkbenchApiHome, { recursive: true });
  for (const dirName of ['profiles', 'skills', 'plugins', 'sessions', 'logs', 'checkpoints']) {
    const sourceDir = path.join(hermesHome, dirName);
    if (await exists(sourceDir)) await ensureSymlink(sourceDir, path.join(hermesWorkbenchApiHome, dirName));
  }
  for (const fileName of ['auth.json', 'auth.lock', 'models.json']) {
    const sourceFile = path.join(hermesHome, fileName);
    const destFile = path.join(hermesWorkbenchApiHome, fileName);
    if ((await exists(sourceFile)) && !(await exists(destFile))) {
      await symlink(sourceFile, destFile);
    }
  }
  const activeProfilePath = path.join(hermesWorkbenchApiHome, 'active_profile');
  if (await exists(activeProfilePath)) await rm(activeProfilePath, { force: true });
  await writeFile(activeProfilePath, 'default\n', 'utf8');

  const sourceConfig = await readYamlFile(path.join(hermesHome, 'config.yaml'));
  const previousApiConfig = await readYamlFile(path.join(hermesWorkbenchApiHome, 'config.yaml'));
  const apiConfig = {};
  for (const [key, value] of Object.entries(sourceConfig)) {
    if (!gatewayPlatformConfigKeys.has(key)) apiConfig[key] = value;
  }
  if (previousApiConfig?.model && Object.keys(previousApiConfig.model).length) {
    apiConfig.model = previousApiConfig.model;
  }
  if (previousApiConfig?.providers && Object.keys(previousApiConfig.providers).length) {
    apiConfig.providers = previousApiConfig.providers;
  }
  try {
    const state = await readState();
    const defaultModelId = state.ui?.defaultModel || 'model_default_deepseek_v4_flash';
    const workbenchModel = state.models.find((model) => model.id === defaultModelId) || state.models.find((model) => model.id === 'model_default_deepseek_v4_flash');
    const apiKey = workbenchModel?.id ? await getModelSecret(workbenchModel.id) : '';
    if (workbenchModel?.baseUrl && workbenchModel?.model && apiKey) {
      apiConfig.model = { default: workbenchModel.model, provider: 'custom:workbench-default' };
      apiConfig.providers = {
        ...(apiConfig.providers || {}),
        'custom:workbench-default': {
          provider: 'openai',
          name: workbenchModel.name || 'Frakio Work Default',
          base_url: workbenchModel.baseUrl,
          api_key: apiKey,
          model: workbenchModel.model,
        },
      };
    }
  } catch (error) {
    console.warn('Failed to sync Frakio Work default model into Hermes API runtime:', error?.message || error);
  }
  apiConfig.platforms = {
    api_server: {
      enabled: true,
      extra: {
        host: '127.0.0.1',
        port: apiPort,
        cors_origins: [
          'http://127.0.0.1:5173',
          'http://127.0.0.1:5174',
          'http://localhost:5173',
          'http://localhost:5174',
          'http://127.0.0.1:8787',
        ],
      },
    },
  };
  await writeFile(path.join(hermesWorkbenchApiHome, 'config.yaml'), YAML.stringify(apiConfig), 'utf8');
  return hermesWorkbenchApiHome;
}

async function discoverHermesBootstrap() {
  const installed = await exists(hermesHome);
  const rootConfigExists = await exists(path.join(hermesHome, 'config.yaml'));
  const sourceExists = await exists(path.join(hermesAgentSourcePath, '.git'));
  const profiles = await readHermesProfiles();
  const profileConfigs = await readHermesProfileConfigs();
  const api = await probeHermesAgentApi();
  const selectedProfile = profiles.find((profile) => profile.name === 'default')?.name || profiles[0]?.name || 'default';
  const approval = await readApprovalConfig(selectedProfile);
  const status = api.online ? 'connected' : installed || rootConfigExists || profiles.length ? 'installed' : 'missing';
  return {
    status,
    installed,
    installPath: hermesHome,
    sourcePath: hermesAgentSourcePath,
    sourceExists,
    rootConfigExists,
    api,
    profiles,
    profileConfigCount: profileConfigs.length,
    approval,
    checkedAt: now(),
    nextAction: status === 'missing' ? 'install' : api.online ? 'import' : 'start',
  };
}

async function backupAndWriteProfileText(filePath, nextText, stamp) {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (await exists(filePath)) {
    const current = await readFile(filePath, 'utf8').catch(() => '');
    if (current.trim() === String(nextText || '').trim()) return false;
    const backupPath = `${filePath}.frakio-backup-${stamp}`;
    await writeFile(backupPath, current, 'utf8');
  }
  await writeFile(filePath, `${String(nextText || '').trim()}\n`, 'utf8');
  return true;
}

async function repairHermesProfilesFromState(state) {
  const repaired = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const agent of state.agents || []) {
    const profileName = slug(agent.profileName || agent.id || '');
    if (!profileName || isSystemHermesProfile(profileName, agent.id)) continue;
    const dir = await profileDirForName(profileName);
    if (!dir) continue;

    const soul = usefulProfileText(agent.soul);
    if (soul) {
      const soulPath = path.join(dir, 'SOUL.md');
      const currentSoul = await readFile(soulPath, 'utf8').catch(() => '');
      if (!currentSoul.trim() || isDefaultHermesSoul(currentSoul)) {
        if (await backupAndWriteProfileText(soulPath, soul, stamp)) repaired.push({ profileName, file: 'SOUL.md' });
      }
    }

    const userProfile = String(agent.userProfile || '').trim();
    if (userProfile) {
      const userPath = path.join(dir, 'memories', 'USER.md');
      const currentUser = await readFile(userPath, 'utf8').catch(() => '');
      if (!currentUser.trim()) {
        if (await backupAndWriteProfileText(userPath, userProfile, stamp)) repaired.push({ profileName, file: 'memories/USER.md' });
      }
    }

    const memory = String(agent.memory || '').trim();
    if (memory) {
      const memoryPath = path.join(dir, 'memories', 'MEMORY.md');
      const currentMemory = await readFile(memoryPath, 'utf8').catch(() => '');
      if (!currentMemory.trim()) {
        if (await backupAndWriteProfileText(memoryPath, memory, stamp)) repaired.push({ profileName, file: 'memories/MEMORY.md' });
      }
    }

  }
  return repaired;
}

async function syncHermesProfilesToState(state, discovery = null) {
  const repair = await repairHermesProfilesFromState(state);
  const bootstrap = discovery || await discoverHermesBootstrap();
  const importedProfileNames = new Set(
    (state.integrations.hermesAgent?.importedProfileNames || state.integrations.hermesStudio?.importedProfileNames || [])
      .filter((name) => !isSystemHermesProfile(name)),
  );
  const visibleProfiles = userVisibleHermesProfiles(bootstrap.profiles);

  for (const profile of visibleProfiles) {
    const canonicalAgentId = profile.name === 'default' ? 'hermes-default' : slug(profile.name);
    const existingAgent = state.agents.find((agent) => agent.profileName === profile.name || agent.id === canonicalAgentId || agent.id === slug(profile.name));
    const nextAgent = { ...agentFromProfile(profile, existingAgent), source: 'hermes-profile' };
    const existingAgentIndex = state.agents.findIndex((agent) => agent.id === nextAgent.id);
    if (existingAgentIndex >= 0) state.agents[existingAgentIndex] = { ...state.agents[existingAgentIndex], ...nextAgent };
    else state.agents.push(nextAgent);

    importedProfileNames.add(profile.name);
  }

  if (!state.agents.some((agent) => agent.id === state.ui?.defaultAgentId)) {
    state.ui = { ...(state.ui || {}), defaultAgentId: resolveDefaultAgentId(state) };
  }

  state.integrations.hermesAgent = {
    ...(state.integrations.hermesAgent || {}),
    installPath: bootstrap.installPath,
    sourcePath: bootstrap.sourcePath,
    apiBaseUrl: bootstrap.api.apiBaseUrl,
    apiStatus: bootstrap.api.online ? 'connected' : 'offline',
    selectedProfile: bootstrap.approval.profileName || bootstrap.profiles[0]?.name || 'default',
    lastCheckedAt: bootstrap.checkedAt,
    approvalMode: bootstrap.approval.mode,
    importedProfileNames: Array.from(importedProfileNames).sort(),
  };
  bootstrap.repair = repair;
  return { state, importedProfiles: visibleProfiles.map((profile) => profile.name), bootstrap, repair };
}

function profileColor(profile) {
  const palette = ['#111827', '#0f766e', '#7c3aed', '#b45309', '#2563eb', '#475569', '#be123c', '#0369a1'];
  const total = String(profile || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return palette[total % palette.length];
}

function hermesHeaders() {
  const token = String(process.env.HERMES_STUDIO_TOKEN || process.env.HERMES_WEB_UI_TOKEN || '').trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readRecentStudioUrls() {
  if (!hermesWebUiHome) return [];
  const logs = [
    path.join(hermesWebUiHome, 'logs/server.log'),
    path.join(hermesWebUiHome, 'server.log'),
    path.join(hermesWebUiHome, 'launchd-stdout.log'),
  ];
  const urls = [];
  for (const logPath of logs) {
    try {
      const raw = await readFile(logPath, 'utf8');
      for (const match of raw.matchAll(/Server:\s*(http:\/\/(?:localhost|127\.0\.0\.1):\d+)/g)) urls.push(match[1].replace('localhost', '127.0.0.1'));
    } catch {
      // Missing logs are expected on first run or after cleanup.
    }
  }
  return urls.reverse();
}

async function readMonitoringLogs(limit = 120) {
  const logFiles = [
    { source: 'Hermes Web UI', file: path.join(hermesWebUiHome, 'logs/server.log') },
    { source: 'Hermes Web UI', file: path.join(hermesWebUiHome, 'server.log') },
    { source: 'Hermes launchd', file: path.join(hermesWebUiHome, 'launchd-stdout.log') },
    { source: 'Hermes Agent', file: path.join(hermesHome, 'logs/hermes.log') },
  ];
  const rows = [];
  for (const item of logFiles) {
    try {
      const raw = await readFile(item.file, 'utf8');
      const lines = raw.split(/\r?\n/).filter(Boolean).slice(-Math.ceil(limit / 2));
      for (const line of lines) {
        rows.push({
          source: item.source,
          file: item.file,
          level: /error|fail|fatal/i.test(line) ? 'error' : /warn/i.test(line) ? 'warn' : 'info',
          message: line.slice(0, 1000),
        });
      }
    } catch {
      // Missing logs are normal when Hermes has not produced that file yet.
    }
  }
  return rows.slice(-limit).reverse();
}

function dayKey(value) {
  return String(value || now()).slice(0, 10);
}

function numberFromUsage(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function configuredPricingForRow(row = {}, models = []) {
  const normalizedId = String(row.modelId || '').toLowerCase();
  const normalizedName = String(row.modelName || '').toLowerCase();
  const normalizedProvider = String(row.provider || '').toLowerCase();
  const matched = models.find((model) => {
    const ids = [model.id, model.model, model.name].map((value) => String(value || '').toLowerCase()).filter(Boolean);
    const provider = String(model.provider || '').toLowerCase();
    return ids.includes(normalizedId) || ids.includes(normalizedName) || (provider === normalizedProvider && ids.some((value) => normalizedId.includes(value) || normalizedName.includes(value)));
  });
  if (!matched) return null;
  const pricing = normalizeModelPricing(matched.pricing);
  if ([pricing.input, pricing.output, pricing.cacheRead, pricing.cacheCreation].every((value) => value == null)) return null;
  return {
    input: pricing.input ?? 0,
    output: pricing.output ?? 0,
    cacheRead: pricing.cacheRead ?? 0,
    cacheCreation: pricing.cacheCreation ?? 0,
  };
}

function pricingForModel(row = {}, models = []) {
  const configured = configuredPricingForRow(row, models);
  if (configured) return { ...configured, source: 'configured' };
  const signature = `${row.provider || ''} ${row.modelId || ''} ${row.modelName || ''}`;
  const matched = modelPricingDefaults.find((item) => item.pattern.test(signature));
  return matched ? { input: matched.input, output: matched.output, cacheRead: matched.cacheRead, cacheCreation: matched.cacheCreation, source: 'default' } : { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, source: 'none' };
}

function costForUsage(row = {}, models = []) {
  const pricing = pricingForModel(row, models);
  if (Number.isFinite(Number(row.totalCost))) {
    return { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheCreationCost: 0, totalCost: Number(row.totalCost), pricing };
  }
  const inputCost = (Number(row.inputTokens || 0) / 1_000_000) * pricing.input;
  const outputCost = (Number(row.outputTokens || 0) / 1_000_000) * pricing.output;
  const cacheReadCost = (Number(row.cacheReadTokens || 0) / 1_000_000) * pricing.cacheRead;
  const cacheCreationCost = (Number(row.cacheCreationTokens || 0) / 1_000_000) * pricing.cacheCreation;
  return { inputCost, outputCost, cacheReadCost, cacheCreationCost, totalCost: inputCost + outputCost + cacheReadCost + cacheCreationCost, pricing };
}

function aggregateModelUsage(rows = [], models = []) {
  const byModel = new Map();
  const byDay = new Map();
  const byProfile = new Map();
  for (const row of rows) {
    const modelKey = `${row.provider || 'unknown'}:${row.modelId || row.modelName || 'unknown'}`;
    const cacheReadTokens = Number(row.cacheReadTokens || 0);
    const cacheCreationTokens = Number(row.cacheCreationTokens || 0);
    const realTotalTokens = Number(row.realTotalTokens ?? (Number(row.totalTokens || 0) + cacheReadTokens + cacheCreationTokens));
    const cost = costForUsage({ ...row, cacheReadTokens, cacheCreationTokens }, models);
    const current = byModel.get(modelKey) || {
      key: modelKey,
      provider: row.provider || 'unknown',
      modelId: row.modelId || '',
      modelName: row.modelName || row.modelId || 'unknown',
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      realTotalTokens: 0,
      totalCost: 0,
      pricing: cost.pricing,
      pricingSource: cost.pricing.source,
      estimatedRequests: 0,
      lastUsedAt: row.createdAt,
      dataSources: {},
    };
    current.requests += 1;
    current.inputTokens += Number(row.inputTokens || 0);
    current.outputTokens += Number(row.outputTokens || 0);
    current.cacheReadTokens += cacheReadTokens;
    current.cacheCreationTokens += cacheCreationTokens;
    current.totalTokens += Number(row.totalTokens || 0);
    current.realTotalTokens += realTotalTokens;
    current.totalCost += cost.totalCost;
    current.pricing = cost.pricing;
    current.pricingSource = cost.pricing.source;
    current.estimatedRequests += row.estimated ? 1 : 0;
    current.lastUsedAt = String(row.createdAt || '').localeCompare(String(current.lastUsedAt || '')) > 0 ? row.createdAt : current.lastUsedAt;
    current.dataSources[row.dataSource || row.provider || 'Frakio Work'] = (current.dataSources[row.dataSource || row.provider || 'Frakio Work'] || 0) + 1;
    byModel.set(modelKey, current);

    const day = dayKey(row.createdAt);
    const dayRow = byDay.get(day) || { day, requests: 0, totalTokens: 0, realTotalTokens: 0, totalCost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    dayRow.requests += 1;
    dayRow.totalTokens += Number(row.totalTokens || 0);
    dayRow.realTotalTokens += realTotalTokens;
    dayRow.totalCost += cost.totalCost;
    dayRow.inputTokens += Number(row.inputTokens || 0);
    dayRow.outputTokens += Number(row.outputTokens || 0);
    dayRow.cacheReadTokens += cacheReadTokens;
    dayRow.cacheCreationTokens += cacheCreationTokens;
    byDay.set(day, dayRow);

    const profileName = row.profileName || row.agentNames?.[0] || 'default';
    const profileRow = byProfile.get(profileName) || { profileName, requests: 0, totalTokens: 0, realTotalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalCost: 0 };
    profileRow.requests += 1;
    profileRow.totalTokens += Number(row.totalTokens || 0);
    profileRow.realTotalTokens += realTotalTokens;
    profileRow.inputTokens += Number(row.inputTokens || 0);
    profileRow.outputTokens += Number(row.outputTokens || 0);
    profileRow.cacheReadTokens += cacheReadTokens;
    profileRow.cacheCreationTokens += cacheCreationTokens;
    profileRow.totalCost += cost.totalCost;
    byProfile.set(profileName, profileRow);
  }
  const configuredModels = models.map((model) => {
    const key = `${model.provider || 'unknown'}:${model.model || model.name}`;
    const pricing = pricingForModel({ provider: model.provider, modelId: model.model, modelName: model.name }, models);
    return byModel.get(key) || {
      key,
      provider: model.provider,
      modelId: model.model,
      modelName: model.name,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      realTotalTokens: 0,
      totalCost: 0,
      pricing,
      pricingSource: pricing.source,
      estimatedRequests: 0,
      lastUsedAt: null,
      dataSources: {},
    };
  });
  const merged = [...configuredModels, ...Array.from(byModel.values()).filter((row) => !configuredModels.some((model) => model.key === row.key))];
  const inputTokens = rows.reduce((sum, row) => sum + Number(row.inputTokens || 0), 0);
  const outputTokens = rows.reduce((sum, row) => sum + Number(row.outputTokens || 0), 0);
  const cacheReadTokens = rows.reduce((sum, row) => sum + Number(row.cacheReadTokens || 0), 0);
  const cacheCreationTokens = rows.reduce((sum, row) => sum + Number(row.cacheCreationTokens || 0), 0);
  const totalTokens = rows.reduce((sum, row) => sum + Number(row.totalTokens || 0), 0);
  const realTotalTokens = rows.reduce((sum, row) => sum + Number(row.realTotalTokens ?? (Number(row.totalTokens || 0) + Number(row.cacheReadTokens || 0) + Number(row.cacheCreationTokens || 0))), 0);
  const totalCost = rows.reduce((sum, row) => sum + costForUsage(row, models).totalCost, 0);
  const bySource = Array.from(rows.reduce((map, row) => {
    const source = row.dataSource || row.provider || 'Frakio Work';
    const current = map.get(source) || { source, requests: 0, totalTokens: 0, realTotalTokens: 0, totalCost: 0 };
    current.requests += 1;
    current.totalTokens += Number(row.totalTokens || 0);
    current.realTotalTokens += Number(row.realTotalTokens ?? (Number(row.totalTokens || 0) + Number(row.cacheReadTokens || 0) + Number(row.cacheCreationTokens || 0)));
    current.totalCost += costForUsage(row, models).totalCost;
    map.set(source, current);
    return map;
  }, new Map()).values()).sort((a, b) => b.realTotalTokens - a.realTotalTokens);
  const cacheableInput = inputTokens + cacheReadTokens;
  return {
    totalRequests: rows.length,
    totalTokens,
    realTotalTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalCost,
    cacheHitRate: cacheableInput > 0 ? cacheReadTokens / cacheableInput : 0,
    estimatedRequests: rows.filter((row) => row.estimated).length,
    byModel: merged.sort((a, b) => b.realTotalTokens - a.realTotalTokens),
    byDay: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)).slice(-14),
    bySource,
    byProfile: Array.from(byProfile.values()).sort((a, b) => b.realTotalTokens - a.realTotalTokens),
    entries: rows.map((row) => {
      const cost = costForUsage(row, models);
      return {
        ...row,
        realTotalTokens: Number(row.realTotalTokens ?? (Number(row.totalTokens || 0) + Number(row.cacheReadTokens || 0) + Number(row.cacheCreationTokens || 0))),
        totalCost: cost.totalCost,
        pricing: cost.pricing,
        pricingSource: cost.pricing.source,
      };
    }),
    recent: rows.slice(-20).reverse(),
  };
}

function collectModuleUsage(state, kind) {
  const entries = [];
  for (const agent of state.agents || []) {
    const modules = kind === 'skills' ? agent.skills || [] : agent.plugins || [];
    for (const item of modules) {
      const name = typeof item === 'string' ? item : item.name;
      if (!name) continue;
      const usage = typeof item === 'string' ? {} : item.usage || {};
      entries.push({
        name,
        profile: agent.profileName || agent.name,
        agentName: agent.name,
        category: typeof item === 'string' ? '' : item.category || item.source || '',
        enabled: typeof item === 'string' ? true : item.enabled !== false && item.status !== 'disabled',
        useCount: Number(usage.useCount || 0),
        viewCount: Number(usage.viewCount || 0),
        patchCount: Number(usage.patchCount || 0),
        lastUsedAt: usage.lastUsedAt || null,
      });
    }
  }
  const byName = new Map();
  for (const entry of entries) {
    const current = byName.get(entry.name) || {
      name: entry.name,
      category: entry.category,
      profiles: 0,
      enabledProfiles: 0,
      useCount: 0,
      viewCount: 0,
      patchCount: 0,
      lastUsedAt: null,
    };
    current.profiles += 1;
    current.enabledProfiles += entry.enabled ? 1 : 0;
    current.useCount += entry.useCount;
    current.viewCount += entry.viewCount;
    current.patchCount += entry.patchCount;
    current.lastUsedAt = entry.lastUsedAt && (!current.lastUsedAt || String(entry.lastUsedAt).localeCompare(String(current.lastUsedAt)) > 0) ? entry.lastUsedAt : current.lastUsedAt;
    byName.set(entry.name, current);
  }
  return {
    total: entries.length,
    enabled: entries.filter((entry) => entry.enabled).length,
    byName: Array.from(byName.values()).sort((a, b) => (b.useCount + b.viewCount + b.patchCount) - (a.useCount + a.viewCount + a.patchCount)).slice(0, 24),
    entries: entries.sort((a, b) => (b.useCount + b.viewCount + b.patchCount) - (a.useCount + a.viewCount + a.patchCount)).slice(0, 80),
  };
}

function collectAgentUsage(state) {
  const byId = new Map();
  const agentLookup = new Map((state.agents || []).map((agent) => [agent.id, agent]));

  function ensureAgent(agentId, fallbackName = '') {
    if (!agentId || agentId === 'user') return null;
    const agent = agentLookup.get(agentId);
    const key = agent?.id || agentId;
    const current = byId.get(key) || {
      id: key,
      name: agent?.name || fallbackName || agentId,
      role: agent?.role || '',
      color: agent?.color || '#0f766e',
      avatarUrl: agent?.avatarUrl || '',
      profileName: agent?.profileName || '',
      conversationCount: 0,
      messageCount: 0,
      lastUsedAt: null,
    };
    byId.set(key, current);
    return current;
  }

  for (const thread of state.threads || []) {
    const threadAgents = new Set([
      ...(Array.isArray(thread.selectedAgents) ? thread.selectedAgents : []),
      thread.primaryAgentId,
      thread.defaultAgentId,
      thread.activeAgentId,
    ].filter(Boolean));

    for (const message of thread.messages || []) {
      if (message.agentId && message.agentId !== 'user') {
        threadAgents.add(message.agentId);
        const row = ensureAgent(message.agentId, message.agentName);
        if (row) {
          row.messageCount += 1;
          row.lastUsedAt = thread.updatedAt && (!row.lastUsedAt || String(thread.updatedAt).localeCompare(String(row.lastUsedAt)) > 0) ? thread.updatedAt : row.lastUsedAt;
        }
      }
    }

    for (const agentId of threadAgents) {
      const row = ensureAgent(agentId);
      if (row) {
        row.conversationCount += 1;
        row.lastUsedAt = thread.updatedAt && (!row.lastUsedAt || String(thread.updatedAt).localeCompare(String(row.lastUsedAt)) > 0) ? thread.updatedAt : row.lastUsedAt;
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.conversationCount - a.conversationCount || b.messageCount - a.messageCount || a.name.localeCompare(b.name));
}

async function candidateStudioUrls() {
  const candidates = [
    process.env.HERMES_STUDIO_URL,
    ...(await readRecentStudioUrls()),
  ].filter(Boolean).map((url) => String(url).replace(/\/$/, '').replace('localhost', '127.0.0.1'));
  return Array.from(new Set(candidates));
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 1600);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchExternalJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeStudio() {
  for (const url of await candidateStudioUrls()) {
    const health = await fetchJson(`${url}/health`);
    if (!health.ok) continue;
    const authProbe = await fetchJson(`${url}/api/hermes/profiles`, { headers: hermesHeaders(), timeoutMs: 1600 });
    return {
      url,
      online: true,
      health: health.body || null,
      authMode: authProbe.ok ? 'env-token' : authProbe.status === 401 ? 'unauthorized' : 'unknown',
      apiAuthorized: Boolean(authProbe.ok),
      apiStatus: authProbe.status,
    };
  }
  return { url: '', online: false, health: null, authMode: 'none', apiAuthorized: false, apiStatus: 0 };
}

async function readHermesProfiles() {
  const dirs = new Map();
  const rootConfig = path.join(hermesHome, 'config.yaml');
  if (await exists(rootConfig)) dirs.set('default', hermesHome);
  const profilesRoot = path.join(hermesHome, 'profiles');
  try {
    const entries = await readdir(profilesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profileDir = path.join(profilesRoot, entry.name);
      dirs.set(entry.name, profileDir);
    }
  } catch {
    // Profiles are optional. Root Hermes installs may only have ~/.hermes/config.yaml.
  }

  const profiles = [];
  for (const [name, dir] of dirs) {
    const configPath = path.join(dir, 'config.yaml');
    const hasConfig = await exists(configPath);
    const config = await readYamlFile(configPath);
    const envValues = await readEnvStatus(path.join(dir, '.env'));
    const profileYaml = await readYamlFile(path.join(dir, 'profile.yaml'));
    const providerSummaries = buildProviderSummaries(config, envValues);
    const modelName = String(config?.model?.default || config?.model || '').trim();
    const providerKey = String(config?.model?.provider || config?.provider || '').trim();
    const providerConfig = providerKey && config?.providers && typeof config.providers === 'object' ? config.providers[providerKey] : null;
    const contextLimit = Number(providerConfig?.context_limit || providerConfig?.context_window || 0) || null;
    const soulText = await readProfileText(path.join(dir, 'SOUL.md'), 16000);
    const userText = await readProfileText(path.join(dir, 'memories/USER.md'), 10000);
    const memoryText = await readProfileText(path.join(dir, 'memories/MEMORY.md'), 10000);
    const modules = await readProfileModules(dir, name, config);
    const avatarUrl = await findProfileAvatar(dir, name);
    profiles.push({
      name,
      path: dir,
      displayName: String(profileYaml?.name || profileYaml?.display_name || titleCaseProfile(name)).trim(),
      model: modelName || 'provider default',
      provider: providerKey || 'provider default',
      contextLimit,
      hasConfig,
      hasEnv: await exists(path.join(dir, '.env')),
      hasAuth: await exists(path.join(dir, 'auth.json')),
      soul: soulText,
      soulExcerpt: compactText(soulText, 700),
      userProfile: userText,
      userExcerpt: compactText(userText, 600),
      memory: memoryText,
      memoryExcerpt: compactText(memoryText, 600),
      providers: providerSummaries,
      skills: modules.skills,
      plugins: modules.plugins,
      avatarUrl,
    });
  }
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

async function sqliteQuery(sql) {
  if (!(await exists(hermesDbPath))) return [];
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-separator', '\t', hermesDbPath, sql], { timeout: 2000, maxBuffer: 1024 * 256 });
    return stdout.trim().split('\n').filter(Boolean).map((line) => line.split('\t'));
  } catch {
    return [];
  }
}

async function sqliteJsonQuery(sql) {
  if (!(await exists(hermesDbPath))) return [];
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', hermesDbPath, sql], { timeout: 2500, maxBuffer: 1024 * 512 });
    return stdout.trim() ? JSON.parse(stdout) : [];
  } catch {
    return [];
  }
}

async function sqliteJsonQueryFile(dbPath, sql) {
  if (!(await exists(dbPath))) return [];
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', dbPath, sql], { timeout: 3000, maxBuffer: 1024 * 1024 });
    return stdout.trim() ? JSON.parse(stdout) : [];
  } catch {
    return [];
  }
}

async function sqliteScalarFile(dbPath, sql) {
  if (!(await exists(dbPath))) return '';
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-noheader', dbPath, sql], { timeout: 1500, maxBuffer: 1024 * 64 });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function discoverHermesAgentStateDbs() {
  const items = [];
  const rootDb = path.join(hermesHome, 'state.db');
  if (await exists(rootDb)) items.push({ profileName: 'default', dbPath: rootDb });
  const profilesRoot = path.join(hermesHome, 'profiles');
  try {
    const entries = await readdir(profilesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dbPath = path.join(profilesRoot, entry.name, 'state.db');
      if (await exists(dbPath)) items.push({ profileName: entry.name, dbPath });
    }
  } catch {
    // Profiles are optional.
  }
  return items;
}

async function readHermesDbSummary() {
  const rooms = (await sqliteQuery('select id,name,totalTokens,tailMessageCount,maxHistoryTokens from gc_rooms order by rowid desc limit 8;'))
    .map(([idValue, name, totalTokens, tailMessageCount, maxHistoryTokens]) => ({
      id: idValue,
      name,
      totalTokens: Number(totalTokens || 0),
      tailMessageCount: Number(tailMessageCount || 0),
      maxHistoryTokens: Number(maxHistoryTokens || 0),
    }));
  const sessions = (await sqliteQuery("select profile,model,provider,title,message_count,last_active from sessions order by last_active desc limit 8;"))
    .map(([profile, model, provider, title, messageCount, lastActive]) => ({
      profile,
      model,
      provider,
      title,
      messageCount: Number(messageCount || 0),
      lastActive: Number(lastActive || 0),
    }));
  return { exists: await exists(hermesDbPath), path: hermesDbPath, rooms, sessions };
}

async function readHermesSessionUsageRows() {
  const { rows } = await readHermesAgentUsageRows();
  return rows;
}

async function readHermesAgentUsageRows() {
  const dbs = await discoverHermesAgentStateDbs();
  const rows = [];
  const profiles = [];
  for (const item of dbs) {
    const hasSessions = await sqliteScalarFile(item.dbPath, "select count(*) from sqlite_master where type='table' and name='sessions';");
    if (hasSessions !== '1') continue;
    const profileRows = await sqliteJsonQueryFile(item.dbPath, `
      select
        id,
        coalesce(nullif(model, ''), 'unknown') as model,
        coalesce(nullif(billing_provider, ''), 'Hermes Agent') as provider,
        coalesce(title, '') as title,
        coalesce(input_tokens, 0) as input_tokens,
        coalesce(output_tokens, 0) as output_tokens,
        coalesce(cache_read_tokens, 0) as cache_read_tokens,
        coalesce(cache_write_tokens, 0) as cache_write_tokens,
        coalesce(reasoning_tokens, 0) as reasoning_tokens,
        coalesce(api_call_count, 0) as api_call_count,
        coalesce(actual_cost_usd, estimated_cost_usd, 0) as cost_usd,
        started_at
      from sessions
      where (coalesce(input_tokens, 0) + coalesce(output_tokens, 0) + coalesce(cache_read_tokens, 0) + coalesce(cache_write_tokens, 0) + coalesce(reasoning_tokens, 0)) > 0
      order by started_at asc
      limit 10000;
    `);
    profiles.push({ profileName: item.profileName, dbPath: item.dbPath, sessionCount: profileRows.length });
    for (const row of profileRows) {
      const inputTokens = Number(row.input_tokens || 0);
      const outputTokens = Number(row.output_tokens || 0);
      const reasoningTokens = Number(row.reasoning_tokens || 0);
      const cacheReadTokens = Number(row.cache_read_tokens || 0);
      const cacheCreationTokens = Number(row.cache_write_tokens || 0);
      const startedAt = Number(row.started_at || 0);
      const modelName = String(row.model || 'unknown');
      rows.push({
        id: `hermes-agent-state-${item.profileName}-${row.id}`,
        createdAt: startedAt > 0 ? new Date(startedAt * 1000).toISOString() : now(),
        provider: String(row.provider || 'Hermes Agent'),
        modelId: modelName,
        modelName,
        threadId: String(row.id || ''),
        threadTitle: String(row.title || ''),
        workspaceId: null,
        agentIds: [item.profileName],
        agentNames: [item.profileName],
        profileName: item.profileName,
        inputTokens,
        outputTokens: outputTokens + reasoningTokens,
        cacheReadTokens,
        cacheCreationTokens,
        totalTokens: inputTokens + outputTokens + reasoningTokens,
        realTotalTokens: inputTokens + outputTokens + reasoningTokens + cacheReadTokens,
        totalCost: Number(row.cost_usd || 0),
        apiCallCount: Number(row.api_call_count || 0),
        estimated: false,
        dataSource: 'Hermes Agent state.db',
      });
    }
  }
  return {
    rows,
    meta: {
      databaseCount: profiles.length,
      profiles,
      usageRowCount: rows.length,
      usageSource: 'Hermes Agent state.db',
    },
  };
}

function agentFromProfile(profile, existing = null) {
  const idValue = profile.name === 'default' ? 'hermes-default' : slug(profile.name);
  const modelName = existing?.model || '';
  const providerName = profile.providers?.[0]?.providerName || providerLabel(profile.provider);
  const soul = profileTextOrExisting(profile.soul || profile.soulExcerpt, existing?.soul);
  const userProfile = String(profile.userProfile || '').trim() || String(existing?.userProfile || '').trim();
  const memory = String(profile.memory || '').trim() || String(existing?.memory || '').trim();
  const providers = profile.providers?.length ? profile.providers : existing?.providerSummary || [];
  return {
    id: existing?.id || idValue,
    name: existing?.name || profile.displayName || titleCaseProfile(profile.name),
    role: existing?.role || `Hermes Profile / ${profile.name}`,
    model: modelName,
    color: existing?.color || profileColor(profile.name),
    soul: soul || `从本机 Hermes 的 ${profile.name} Profile 导入。`,
    scope: existing?.scope || `本机 Profile: ${profile.name}。原始 provider 为 ${providerName}，原始模型为 ${profile.model}。模型 API 需要在 Frakio Work 模型中心单独配置。`,
    source: 'hermes-profile',
    profileName: profile.name,
    gatewayStatus: '',
    soulExcerpt: usefulProfileText(profile.soulExcerpt) || compactText(soul, 700) || existing?.soulExcerpt || '',
    userProfileExcerpt: profile.userExcerpt || compactText(userProfile, 600) || existing?.userProfileExcerpt || '',
    memoryExcerpt: profile.memoryExcerpt || compactText(memory, 600) || existing?.memoryExcerpt || '',
    userProfile,
    memory,
    providerSummary: providers,
    skills: profile.skills?.length ? profile.skills : existing?.skills || [],
    plugins: profile.plugins?.length ? profile.plugins : existing?.plugins || [],
    avatarUrl: profile.avatarUrl || existing?.avatarUrl || '',
  };
}

async function discoverHermesStudio() {
  const [studio, profiles, database] = await Promise.all([probeStudio(), readHermesProfiles(), readHermesDbSummary()]);
  return {
    studio,
    profiles,
    database,
    checkedAt: now(),
    paths: {
      webUiHome: hermesWebUiHome,
      hermesHome,
    },
  };
}

async function runHermesStudioChat(discovery, state, thread, message) {
  const profileName = state.integrations?.hermesStudio?.selectedProfile || 'default';
  const profile = (await readHermesProfiles()).find((item) => item.name === profileName) || (await readHermesProfiles())[0];
  const model = profile?.model && profile.model !== 'provider default' ? profile.model : state.models.find((item) => item.source === 'hermes-studio' && item.profileName === profileName)?.model;
  if (!discovery.studio.url || !model) throw new Error('Hermes Studio model is not available for chat.');
  const payload = {
    model,
    messages: [
      { role: 'system', content: 'You are connected from Frakio Work. Answer in Chinese unless the user asks otherwise.' },
      ...thread.messages.slice(-8).map((event) => ({ role: event.agentId === 'user' ? 'user' : 'assistant', content: event.content })),
      { role: 'user', content: message },
    ],
    stream: false,
  };
  const result = await fetchJson(`${discovery.studio.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...hermesHeaders() },
    body: JSON.stringify(payload),
    timeoutMs: 45000,
  });
  if (!result.ok) throw new Error(`Hermes Studio chat failed with HTTP ${result.status}`);
  const content = result.body?.choices?.[0]?.message?.content || result.body?.output_text || '';
  if (!content) throw new Error('Hermes Studio chat returned an empty response.');
  return { content, profileName, model };
}

function chatCompletionsUrl(baseUrl) {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) throw new Error('模型 Base URL 为空。');
  const parsed = new URL(clean);
  parsed.pathname = parsed.pathname
    .replace(/\/models\/?$/i, '')
    .replace(/\/responses\/?$/i, '')
    .replace(/\/chat\/completions\/?$/i, '');
  const normalized = parsed.toString().replace(/\/+$/, '');
  return /\/v\d+$/i.test(parsed.pathname) ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`;
}

async function findUsableModelForThread(state, thread, selectedAgentIds = []) {
  const selectedAgents = state.agents.filter((agent) => selectedAgentIds.includes(agent.id));
  const overrides = normalizeAgentModelOverrides(thread?.agentModelOverrides || {}, state.agents, state.models);
  const overrideSelections = selectedAgentIds
    .map((agentId) => resolveModelSelection(overrides[agentId], state.models))
    .filter(({ selectedModel }) => Boolean(selectedModel));
  const overrideModelIds = overrideSelections.map(({ selectedModel }) => selectedModel.id);
  const overrideModelNames = overrideSelections.map(({ selectedName }) => selectedName);
  const preferredNames = [
    ...overrideModelNames,
    state.ui?.defaultModel,
    ...selectedAgents.flatMap((agent) => [agent.model, agent.providerSummary?.[0]?.model]),
  ].filter(Boolean).map((value) => String(value));
  const models = state.models.filter((model) => model.baseUrl && model.model);
  const ranked = [
    ...models.filter((model) => overrideModelIds.includes(model.id)),
    ...models.filter((model) => preferredNames.some((name) => name === model.id || name === model.name || name === model.model || name.includes(model.model))),
    ...models,
  ].filter((model, index, arr) => arr.findIndex((item) => item.id === model.id) === index);
  for (const model of ranked) {
    const apiKey = await getModelSecret(model.id);
    if (apiKey) return { model, apiKey, selectedAgents };
  }
  return { model: null, apiKey: '', selectedAgents };
}

function agentSystemPrompt(agents) {
  const selected = agents.length ? agents : [];
  if (!selected.length) return '你是 Frakio Work 里的团队 Agent。请用中文回答，保持清晰、可执行。';
  const profiles = selected.map((agent) => {
    const parts = [
      `Agent: ${agent.name}`,
      `Role: ${agent.role}`,
      agent.soul ? `Soul:\n${String(agent.soul).slice(0, 8000)}` : '',
      agent.userProfile ? `User profile:\n${String(agent.userProfile).slice(0, 3000)}` : '',
      agent.memory ? `Memory:\n${String(agent.memory).slice(0, 3000)}` : '',
    ].filter(Boolean);
    return parts.join('\n');
  }).join('\n\n---\n\n');
  return `你正在 Frakio Work 中扮演被选中的 Hermes Profile。请用中文回答，遵守对应 Soul 和记忆。\n\n${profiles}`;
}

async function runConfiguredModelChat(state, thread, message, selectedAgentIds = []) {
  const { model, apiKey, selectedAgents } = await findUsableModelForThread(state, thread, selectedAgentIds);
  if (!model || !apiKey) throw new Error('没有可用的模型 API Key。请在模型中心保存 Base URL、模型 ID 和 API Key。');
  const payload = {
    model: model.model,
    messages: [
      { role: 'system', content: agentSystemPrompt(selectedAgents) },
      ...thread.messages.slice(-10).map((event) => ({ role: event.agentId === 'user' ? 'user' : 'assistant', content: event.content })),
      { role: 'user', content: message },
    ],
    stream: false,
  };
  const result = await fetchJson(chatCompletionsUrl(model.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
    timeoutMs: 60000,
  });
  if (!result.ok) {
    const providerMessage = typeof result.body?.error?.message === 'string' ? `：${result.body.error.message.slice(0, 180)}` : '';
    throw new Error(`模型调用失败，HTTP ${result.status || 'network'}${providerMessage}`);
  }
  const content = result.body?.choices?.[0]?.message?.content || result.body?.output_text || '';
  if (!content) throw new Error('模型返回为空。');
  recordModelUsage(state, model, result.body, selectedAgents, thread, message, content);
  return {
    content,
    modelName: model.name,
    provider: model.provider,
    modelId: model.model,
    agentName: selectedAgents.length === 1 ? selectedAgents[0].name : 'Hermes Profiles',
    role: selectedAgents.length === 1 ? selectedAgents[0].role : selectedAgents.map((agent) => agent.name).join(' / '),
  };
}

function modelUsageFromResponse(body, prompt, completion) {
  const usage = body?.usage || body?.response?.usage || {};
  const cacheReadTokens = numberFromUsage(usage.cache_read_input_tokens, usage.cached_input_tokens, usage.input_tokens_details?.cached_tokens, usage.prompt_tokens_details?.cached_tokens);
  const cacheCreationTokens = numberFromUsage(usage.cache_creation_input_tokens, usage.cache_creation?.input_tokens, usage.input_tokens_details?.cache_creation_tokens);
  const rawInputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokenCount ?? 0);
  const inputTokens = Math.max(0, rawInputTokens - cacheReadTokens - cacheCreationTokens);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokenCount ?? 0);
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens);
  if (totalTokens > 0) return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalTokens };
  const estimatedInput = Math.ceil(String(prompt || '').length / 3);
  const estimatedOutput = Math.ceil(String(completion || '').length / 3);
  return { inputTokens: estimatedInput, outputTokens: estimatedOutput, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: estimatedInput + estimatedOutput, estimated: true };
}

function recordModelUsage(state, model, body, selectedAgents, thread, prompt, completion) {
  const usage = modelUsageFromResponse(body, prompt, completion);
  state.observability = state.observability || { modelUsage: [], systemEvents: [] };
  state.observability.modelUsage = Array.isArray(state.observability.modelUsage) ? state.observability.modelUsage : [];
  state.observability.modelUsage.push({
    id: id('usage'),
    createdAt: now(),
    provider: model.provider,
    modelId: model.model,
    modelName: model.name,
    threadId: thread?.id || null,
    threadTitle: thread?.title || '',
    workspaceId: thread?.workspaceId || null,
    agentIds: selectedAgents.map((agent) => agent.id),
    agentNames: selectedAgents.map((agent) => agent.name),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    totalTokens: usage.totalTokens,
    estimated: Boolean(usage.estimated),
    dataSource: 'Frakio Work',
  });
  state.observability.modelUsage = state.observability.modelUsage.slice(-800);
}

async function writeState(state) {
  await writeStateJson(state);
}

async function walkMarkdown(root, limit = 2000) {
  const out = [];
  async function walk(dir) {
    if (out.length >= limit) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name.startsWith('.') && entry.name !== '.space') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const s = await stat(full);
        out.push({ path: full, relativePath: path.relative(root, full), name: entry.name, size: s.size, mtimeMs: s.mtimeMs });
      }
    }
  }
  await walk(root);
  return out;
}

function classifyDoc(doc) {
  const rel = doc.relativePath;
  if (rel.includes('00_团队索引')) return '团队规则';
  if (rel.includes('04_Agent档案')) return 'Agent 档案';
  if (rel.includes('03_团队进化与经验沉淀/SOP')) return 'SOP';
  if (rel.includes('01_产品文档')) return '产品文档';
  if (rel.includes('Frakio博客')) return '博客项目';
  if (rel.includes('01_会议记录')) return '会议记录';
  return '项目资料';
}

async function excerpt(doc) {
  try {
    const raw = await readFile(doc.path, 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('---'))
      .slice(0, 8)
      .join('\n')
      .slice(0, 700);
  } catch {
    return '';
  }
}

function vaultNameFromPath(vaultPath) {
  return path.basename(vaultPath.replace(/\/$/, '')) || 'Obsidian Vault';
}

async function buildVaultIndex(vaultPath) {
  const vaultExists = await exists(vaultPath);
  if (!vaultExists) {
    const error = new Error('路径不存在，无法添加仓库。');
    error.status = 400;
    throw error;
  }

  const docs = await walkMarkdown(vaultPath);
  const categories = docs.reduce((acc, doc) => {
    const category = classifyDoc(doc);
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});

  const highSignalNames = [
    'Agent 协作规则.md',
    '文档关系与同步机制.md',
    '团队文档与资产管理规范.md',
    '2026-06-24_Frakio博客工作总控SOP_Max.md',
    '00_Frakio_25篇博客项目总控_Max.md',
    '_项目导航.md',
  ];

  const highSignal = docs
    .filter((doc) => highSignalNames.some((name) => doc.relativePath.endsWith(name)))
    .slice(0, 12);

  const productDocs = docs.filter((doc) => doc.relativePath.includes('01_产品文档/'));
  const ruleDocs = docs.filter((doc) => doc.relativePath.includes('00_团队索引/')).slice(0, 20);
  const sopDocs = docs.filter((doc) => doc.relativePath.includes('SOP/')).slice(0, 20);
  const latestMtimeMs = docs.reduce((max, doc) => Math.max(max, doc.mtimeMs || 0), 0);

  return {
    documentCount: docs.length,
    productCount: productDocs.length,
    categories,
    latestMtimeMs,
    products: productDocs.map((doc) => doc.name.replace(/\.md$/, '')),
    highSignal: await Promise.all(highSignal.map(async (doc) => ({ ...publicDoc(doc), excerpt: await excerpt(doc) }))),
    ruleDocs: ruleDocs.map(publicDoc),
    sopDocs: sopDocs.map(publicDoc),
  };
}

function publicDoc(doc) {
  return {
    relativePath: doc.relativePath,
    name: doc.name,
    category: classifyDoc(doc),
    size: doc.size,
    mtimeMs: doc.mtimeMs,
  };
}

async function markRefreshStatus(vault) {
  if (vault?.status === 'not_indexed' && vault.path && (await exists(vault.path))) {
    const index = await buildVaultIndex(vault.path);
    return {
      ...vault,
      status: 'indexed',
      documentCount: index.documentCount,
      productCount: index.productCount,
      lastIndexedAt: now(),
      needsRefresh: false,
      index,
    };
  }
  if (!vault?.index || !vault.path || !(await exists(vault.path))) return { ...vault, needsRefresh: Boolean(vault?.index) };
  const docs = await walkMarkdown(vault.path, 2200);
  const latestMtimeMs = docs.reduce((max, doc) => Math.max(max, doc.mtimeMs || 0), 0);
  return {
    ...vault,
    needsRefresh: docs.length !== vault.documentCount || latestMtimeMs > (vault.index.latestMtimeMs || 0),
  };
}

function publicVault(vault) {
  return {
    id: vault.id,
    name: vault.name,
    path: vault.path,
    status: vault.status,
    documentCount: vault.documentCount,
    productCount: vault.productCount,
    lastIndexedAt: vault.lastIndexedAt,
    needsRefresh: Boolean(vault.needsRefresh),
  };
}

function publicSpace(space) {
  return {
    id: space.id,
    name: space.name,
    iconKind: space.iconKind,
    iconValue: space.iconValue,
    theme: normalizeSpaceTheme(space.theme),
    archivedAt: space.archivedAt || null,
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
    lastOpenedAt: space.lastOpenedAt || null,
  };
}

function publicWorkspace(workspace, state) {
  const activeThread = state.threads.find((thread) => thread.id === workspace.activeThreadId && !thread.archivedAt);
  const threads = state.threads
    .filter((thread) => thread.workspaceId === workspace.id && thread.mode !== 'direct' && !thread.archivedAt)
    .sort(sortPinnedThenUpdated)
    .map((thread) => summarizeThread(thread, state));
  return { ...workspace, activeThread: activeThread ? summarizeThread(activeThread, state) : threads[0] || null, threads };
}

function sortPinnedThenUpdated(a, b) {
  const aPinned = a.pinnedAt || '';
  const bPinned = b.pinnedAt || '';
  if (aPinned || bPinned) {
    if (!aPinned) return 1;
    if (!bPinned) return -1;
    return String(bPinned).localeCompare(String(aPinned));
  }
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}

function artifactKind(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') && /(plan|方案|report|报告|任务)/i.test(fileName)) return 'plan';
  if (lower.endsWith('.md')) return 'document';
  if (lower.endsWith('.json')) return 'data';
  if (lower.endsWith('.py') || lower.endsWith('.mjs') || lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'script';
  if (lower.endsWith('.pdf')) return 'pdf';
  return 'file';
}

const workspaceBrowserSkipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.vite']);
const workspacePreviewExtensions = new Set(['.md', '.markdown', '.txt', '.json', '.py', '.mjs', '.js', '.ts', '.tsx', '.css', '.html', '.yml', '.yaml', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif']);
const workspaceTextExtensions = new Set(['.md', '.markdown', '.txt', '.json', '.py', '.mjs', '.js', '.ts', '.tsx', '.css', '.html', '.yml', '.yaml']);

function workspaceFileMimeKind(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.txt') return 'text';
  if (ext === '.json') return 'json';
  if (['.py', '.mjs', '.js', '.ts', '.tsx', '.css', '.html', '.yml', '.yaml'].includes(ext)) return 'code';
  if (ext === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return 'image';
  return 'binary';
}

async function listWorkspaceFiles(rootPath, relativeDir = '') {
  const root = path.resolve(rootPath);
  const targetDir = assertInsideWorkspace(root, path.join(root, relativeDir || ''));
  const info = await stat(targetDir).catch(() => null);
  if (!info?.isDirectory()) {
    const error = new Error('目标路径不是文件夹。');
    error.status = 400;
    throw error;
  }
  const entries = await readdir(targetDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && workspaceBrowserSkipDirs.has(entry.name)) continue;
    const full = assertInsideWorkspace(root, path.join(targetDir, entry.name));
    const fileStat = await stat(full).catch(() => null);
    if (!fileStat) continue;
    const ext = path.extname(entry.name).toLowerCase();
    files.push({
      name: entry.name,
      relativePath: path.relative(root, full),
      kind: entry.isDirectory() ? 'directory' : 'file',
      size: entry.isFile() ? fileStat.size : undefined,
      updatedAt: new Date(fileStat.mtimeMs).toISOString(),
      previewable: entry.isFile() && workspacePreviewExtensions.has(ext),
    });
  }
  return files.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });
}

async function readWorkspaceFileContent(rootPath, relativeFilePath) {
  const root = path.resolve(rootPath);
  const target = assertInsideWorkspace(root, path.join(root, relativeFilePath || ''));
  const fileStat = await stat(target).catch(() => null);
  if (!fileStat?.isFile()) {
    const error = new Error('目标路径不是文件。');
    error.status = 400;
    throw error;
  }
  const mimeKind = workspaceFileMimeKind(target);
  const limit = 1024 * 1024;
  let content = '';
  let truncated = false;
  if (workspaceTextExtensions.has(path.extname(target).toLowerCase())) {
    const buffer = await readFile(target);
    truncated = buffer.length > limit;
    content = buffer.subarray(0, limit).toString('utf8');
  }
  return {
    name: path.basename(target),
    relativePath: path.relative(root, target),
    mimeKind,
    content,
    size: fileStat.size,
    updatedAt: new Date(fileStat.mtimeMs).toISOString(),
    truncated,
  };
}

async function collectWorkspaceArtifacts(rootPath, limit = 12) {
  const root = path.resolve(rootPath);
  if (!(await exists(root))) return [];
  const out = [];
  const allowed = new Set(['.md', '.json', '.py', '.mjs', '.js', '.ts', '.tsx', '.pdf', '.txt']);
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.vite']);
  async function walk(dir, depth = 0) {
    if (depth > 4 || out.length > 240) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.space') continue;
      if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
      const full = assertInsideWorkspace(root, path.join(dir, entry.name));
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase())) {
        const info = await stat(full).catch(() => null);
        if (!info) continue;
        out.push({
          name: entry.name,
          relativePath: path.relative(root, full),
          path: full,
          kind: artifactKind(entry.name),
          size: info.size,
          updatedAt: new Date(info.mtimeMs).toISOString(),
        });
      }
    }
  }
  await walk(root);
  return out
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit);
}

function assertInsideWorkspace(rootPath, targetPath) {
  return resolveInsideRoot(rootPath, targetPath);
}

async function ensureDirectory(targetPath) {
  const rawPath = String(targetPath || '').trim();
  if (!rawPath) {
    const error = new Error('文件夹路径不能为空。');
    error.status = 400;
    throw error;
  }
  const resolved = path.resolve(rawPath);
  await mkdir(resolved, { recursive: true });
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    const error = new Error('目标路径不是文件夹。');
    error.status = 400;
    throw error;
  }
  return resolved;
}

async function ensureVaultForRoot(state, rootPath, name) {
  const resolved = path.resolve(rootPath);
  const existing = state.vaults.find((vault) => path.resolve(vault.path) === resolved);
  if (existing) return existing;
  const index = await buildVaultIndex(resolved);
  const vault = {
    id: id('vault'),
    name: String(name || vaultNameFromPath(resolved)).slice(0, 60),
    path: resolved,
    status: 'indexed',
    documentCount: index.documentCount,
    productCount: index.productCount,
    lastIndexedAt: now(),
    needsRefresh: false,
    index,
  };
  state.vaults.push(vault);
  return vault;
}

function summaryFromVault(vault) {
  if (!vault?.index) {
    return {
      vaultRoot: vault?.path || '',
      vaultExists: false,
      documentCount: 0,
      categories: {},
      products: [],
      highSignal: [],
      ruleDocs: [],
      sopDocs: [],
      status: vault?.status || 'none',
      needsRefresh: false,
    };
  }
  return {
    vaultRoot: vault.path,
    vaultExists: true,
    documentCount: vault.documentCount,
    categories: vault.index.categories,
    products: vault.index.products,
    highSignal: vault.index.highSignal,
    ruleDocs: vault.index.ruleDocs,
    sopDocs: vault.index.sopDocs,
    status: vault.status,
    lastIndexedAt: vault.lastIndexedAt,
    needsRefresh: Boolean(vault.needsRefresh),
  };
}

function assertSafeModuleName(name) {
  const clean = String(name || '').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(clean)) {
    const error = new Error('模块名称不合法。');
    error.status = 400;
    throw error;
  }
  return clean;
}

async function resolveProfileTextFile(profileName, kind, moduleName = '') {
  const dir = await profileDirForName(profileName);
  if (!dir) {
    const error = new Error('未找到可编辑的 Hermes Profile。');
    error.status = 404;
    throw error;
  }
  const cleanKind = String(kind || '').trim();
  let target = '';
  if (cleanKind === 'notes') target = path.join(dir, 'memories', 'MEMORY.md');
  if (cleanKind === 'user') target = path.join(dir, 'memories', 'USER.md');
  if (cleanKind === 'soul') target = path.join(dir, 'SOUL.md');
  if (cleanKind === 'skill') {
    const cleanName = assertSafeModuleName(moduleName);
    target = path.join(dir, 'skills', cleanName, 'SKILL.md');
  }
  if (cleanKind === 'plugin') {
    const cleanName = assertSafeModuleName(moduleName);
    const profileYaml = path.join(dir, 'plugins', cleanName, 'plugin.yaml');
    const profileJson = path.join(dir, 'plugins', cleanName, 'plugin.json');
    const globalYaml = path.join(hermesHome, 'plugins', cleanName, 'plugin.yaml');
    const globalJson = path.join(hermesHome, 'plugins', cleanName, 'plugin.json');
    if (await exists(profileYaml)) target = profileYaml;
    else if (await exists(profileJson)) target = profileJson;
    else if (profileName === 'default' && await exists(globalYaml)) target = globalYaml;
    else if (profileName === 'default' && await exists(globalJson)) target = globalJson;
    else target = profileYaml;
  }
  if (!target) {
    const error = new Error('不支持的 Profile 文件类型。');
    error.status = 400;
    throw error;
  }
  const root = cleanKind === 'plugin' && isInside(hermesHome, target) ? hermesHome : dir;
  if (!isInside(root, target)) {
    const error = new Error('目标文件超出 Hermes Profile。');
    error.status = 403;
    throw error;
  }
  return { dir, target };
}

async function syncProfileAgent(profileName) {
  if (isSystemHermesProfile(profileName)) return { profile: null, agent: null };
  const profiles = await readHermesProfiles();
  const profile = profiles.find((item) => item.name === profileName);
  if (!profile) return { profile: null, agent: null };
  const state = await readState();
  const canonicalId = profile.name === 'default' ? 'hermes-default' : slug(profile.name);
  const index = state.agents.findIndex((agent) => agent.profileName === profile.name || agent.id === canonicalId || agent.id === slug(profile.name));
  if (index < 0) return { profile, agent: null };
  state.agents[index] = { ...state.agents[index], ...agentFromProfile(profile, state.agents[index]) };
  await writeState(state);
  return { profile, agent: state.agents[index] };
}

const userProfileBlockStart = '<!-- WORKBENCH_USER_PROFILE_START -->';
const userProfileBlockEnd = '<!-- WORKBENCH_USER_PROFILE_END -->';

function buildWorkbenchUserProfileBlock(userProfile, agent, defaultAgentId) {
  const isDefault = agent?.id === defaultAgentId;
  const address = isDefault ? userProfile.defaultAgentAddress : userProfile.otherAgentAddress;
  const rows = [
    '# Frakio Work User Profile',
    '',
    '这段资料由 Frakio Work 同步。用于让 Agent 快速理解用户，不要把它当成一次性任务记录。',
    '',
    `- 用户名/昵称：${userProfile.nickname || '未填写'}`,
    userProfile.bio ? `- 个人简介：${userProfile.bio}` : '',
    userProfile.age ? `- 年龄：${userProfile.age}` : '',
    userProfile.hobbies ? `- 爱好：${userProfile.hobbies}` : '',
    userProfile.occupation ? `- 职业信息：${userProfile.occupation}` : '',
    address ? `- 你对用户的默认称呼：${address}` : '',
    `- 当前默认 Agent：${isDefault ? '是' : '否'}`,
  ].filter(Boolean);
  return `${userProfileBlockStart}\n${rows.join('\n')}\n${userProfileBlockEnd}`;
}

function replaceWorkbenchUserProfileBlock(existing, block) {
  const text = String(existing || '');
  const pattern = new RegExp(`${userProfileBlockStart}[\\s\\S]*?${userProfileBlockEnd}\\n?`, 'm');
  const nextBlock = `${block}\n\n`;
  if (pattern.test(text)) return text.replace(pattern, nextBlock);
  return `${nextBlock}${text.replace(/^\s+/, '')}`;
}

async function syncUserProfileToHermesProfiles(state, userProfile) {
  const profiles = await readHermesProfiles();
  const agents = state.agents || [];
  const defaultAgentId = resolveDefaultAgentId(state, agents);
  for (const profile of profiles) {
    const agent = agents.find((item) => item.profileName === profile.name || (profile.name !== 'default' && item.id === slug(profile.name)) || (profile.name === 'default' && item.id === 'hermes-default'));
    const dir = await profileDirForName(profile.name);
    if (!dir || !isInside(hermesHome, dir)) continue;
    const target = path.join(dir, 'memories', 'USER.md');
    await mkdir(path.dirname(target), { recursive: true });
    const existing = await readFile(target, 'utf8').catch(() => '');
    const block = buildWorkbenchUserProfileBlock(userProfile, agent || { id: profile.name, name: profile.displayName || profile.name }, defaultAgentId);
    await writeFile(target, replaceWorkbenchUserProfileBlock(existing, block), 'utf8');
    await syncProfileAgent(profile.name);
  }
}

async function uniqueProfileName(name) {
  const base = slug(name) || 'agent';
  let candidate = base;
  let index = 2;
  while (await profileDirForName(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

async function createHermesProfileFiles(profileName, payload) {
  const dir = path.join(hermesHome, 'profiles', profileName);
  if (!isInside(hermesHome, dir)) {
    const error = new Error('Profile 路径不合法。');
    error.status = 400;
    throw error;
  }
  await mkdir(path.join(dir, 'memories'), { recursive: true });
  await mkdir(path.join(dir, 'skills'), { recursive: true });
  const displayName = String(payload.name || titleCaseProfile(profileName)).trim();
  const model = String(payload.model || '').trim();
  const role = String(payload.role || '新 Agent').trim();
  const soul = String(payload.soul || `# SOUL.md — ${displayName}\n\n## 基础身份\n你叫 ${displayName}。\n\n## 角色定位\n${role}\n`).trim();
  const userProfile = String(payload.userProfile || '').trim();
  const memory = String(payload.memory || '').trim();
  const config = {
    providers: {},
    skills: { disabled: [] },
    plugins: { enabled: [], disabled: [] },
  };
  if (model) config.model = { provider: 'custom', default: model };
  await writeFile(path.join(dir, 'profile.yaml'), YAML.stringify({ name: displayName, display_name: displayName, role }), 'utf8');
  await writeFile(path.join(dir, 'config.yaml'), YAML.stringify(config), 'utf8');
  await writeFile(path.join(dir, 'SOUL.md'), `${soul}\n`, 'utf8');
  await writeFile(path.join(dir, 'memories', 'USER.md'), `${userProfile}\n`, 'utf8');
  await writeFile(path.join(dir, 'memories', 'MEMORY.md'), `${memory}\n`, 'utf8');
  return dir;
}

async function updateHermesProfileDefaultModel(profileName, modelValue, models = []) {
  const dir = await profileDirForName(profileName);
  if (!dir) return;
  if (!isInside(hermesHome, dir)) {
    const error = new Error('Profile 路径超出 Hermes Home。');
    error.status = 403;
    throw error;
  }
  const { selectedModel, selectedName } = resolveModelSelection(modelValue, models);
  if (!selectedModel) {
    const error = new Error('没有找到对应的模型配置。');
    error.status = 400;
    throw error;
  }
  return ensureModelProviderForProfile(profileName, selectedModel, selectedName, models, { setDefault: true });
}

function providerConfigStorageKey(providerKey) {
  return String(providerKey || '').replace(/^custom:/, '');
}

function runtimeProviderType(model) {
  if (model?.apiMode === 'anthropic_messages') return 'anthropic';
  if (model?.apiMode === 'bedrock_converse') return 'bedrock';
  return 'openai';
}

async function ensureModelProviderForProfile(profileName, rawModel, requestedModelName, models = [], options = {}) {
  const dir = await profileDirForName(profileName);
  if (!dir || !isInside(hermesHome, dir)) {
    const error = new Error(dir ? 'Profile 路径超出 Hermes Home。' : '未找到可编辑的 Hermes Profile。');
    error.status = dir ? 403 : 404;
    throw error;
  }
  const selectedModel = normalizeModels([rawModel])[0];
  const availableNames = normalizeModelNames(selectedModel.models, selectedModel.model);
  const modelName = availableNames.includes(String(requestedModelName || '').trim())
    ? String(requestedModelName).trim()
    : selectedModel.model || availableNames[0] || '';
  if (!selectedModel.providerKey || !modelName) {
    const error = new Error('模型缺少可用的 Provider 或模型 ID。');
    error.status = 400;
    throw error;
  }
  const configPath = path.join(dir, 'config.yaml');
  const config = await readYamlFile(configPath);
  const storageKey = providerConfigStorageKey(selectedModel.providerKey);
  const reusableApiKey = selectedModel.id ? await getReusableModelSecret(selectedModel, models) : '';
  const preset = !String(selectedModel.providerKey).startsWith('custom:') ? providerPresetByKey(selectedModel.providerKey) : null;
  const envMapping = providerEnvMap[selectedModel.providerKey] || {};
  if (preset && (Object.keys(envMapping).length || oauthProviderKeys.has(selectedModel.providerKey))) {
    const envPath = profileEnvPath(profileName);
    const currentEnv = await readEnvValues(envPath);
    const apiKey = reusableApiKey
      || (envMapping.apiKey ? String(currentEnv[envMapping.apiKey] || process.env[envMapping.apiKey] || '').trim() : '');
    const isLocalEndpoint = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(selectedModel.baseUrl || preset.baseUrl || '');
    const requiresApiKey = Boolean(envMapping.apiKey) && !oauthProviderKeys.has(selectedModel.providerKey) && !isLocalEndpoint;
    if (requiresApiKey && !apiKey) {
      throw configValidationError(`${preset.label || selectedModel.name || providerLabel(selectedModel.providerKey)} 尚未配置 API Key。`);
    }
    const envUpdates = {};
    if (envMapping.apiKey && apiKey) envUpdates[envMapping.apiKey] = apiKey;
    if (envMapping.baseUrl && (selectedModel.baseUrl || preset.baseUrl)) envUpdates[envMapping.baseUrl] = selectedModel.baseUrl || preset.baseUrl;
    if (Object.keys(envUpdates).length) await writeEnvValues(envPath, envUpdates);
    if (options.setDefault) {
      const nextConfig = {
        ...config,
        model: {
          ...(isPlainRecord(config.model) ? config.model : {}),
          provider: selectedModel.providerKey,
          default: modelName,
        },
      };
      await mkdir(dir, { recursive: true });
      await writeFile(configPath, YAML.stringify(nextConfig), 'utf8');
    }
    return { profileName: profileName || 'default', configPath, provider: selectedModel.providerKey, model: modelName, hasApiKey: Boolean(apiKey) };
  }
  const existingProvider = isPlainRecord(config.providers?.[storageKey]) ? config.providers[storageKey] : {};
  const providerConfig = selectedModel.baseUrl
    ? {
        ...existingProvider,
        provider: runtimeProviderType(selectedModel),
        name: selectedModel.name || selectedModel.provider || storageKey,
        base_url: selectedModel.baseUrl,
        ...(reusableApiKey ? { api_key: reusableApiKey } : {}),
        model: modelName,
        api_mode: selectedModel.modelApiModes?.[modelName] || selectedModel.apiMode || 'chat_completions',
      }
    : existingProvider;
  const nextConfig = {
    ...config,
    providers: selectedModel.baseUrl ? { ...(config.providers || {}), [storageKey]: providerConfig } : (config.providers || {}),
  };
  if (options.setDefault) {
    nextConfig.model = {
      ...(isPlainRecord(config.model) ? config.model : {}),
      provider: selectedModel.providerKey,
      default: modelName,
    };
  }
  await mkdir(dir, { recursive: true });
  await writeFile(configPath, YAML.stringify(nextConfig), 'utf8');
  return { profileName: profileName || 'default', configPath, provider: selectedModel.providerKey, model: modelName, hasApiKey: Boolean(reusableApiKey || existingProvider.api_key || existingProvider.apiKey) };
}

async function runModelScopeMigration() {
  const migrationRoot = path.join(frakioWorkHome, 'backups', 'model-scope-migration');
  const markerPath = path.join(migrationRoot, 'v1-complete.json');
  if (await exists(markerPath)) return;
  const raw = JSON.parse(await readFile(statePath, 'utf8').catch(() => 'null'));
  if (!raw || !Array.isArray(raw.models)) return;
  const normalizedModels = normalizeModels(raw.models);
  const rawById = new Map(raw.models.map((model) => [model.id, model]));
  const stateUpdates = normalizedModels.filter((model) => String(rawById.get(model.id)?.providerKey || '') !== model.providerKey);
  const profilePlans = [];
  const profiles = await readHermesProfiles();
  for (const profile of profiles) {
    const candidates = normalizedModels.filter((model) => normalizeModelNames(model.models, model.model).includes(profile.model));
    if (candidates.length !== 1) continue;
    const selectedModel = candidates[0];
    if (!selectedModel.providerKey) continue;
    const dir = await profileDirForName(profile.name);
    if (!dir) continue;
    const configPath = path.join(dir, 'config.yaml');
    const config = await readYamlFile(configPath);
    const currentProvider = String(config?.model?.provider || config?.provider || '').trim();
    const currentConfig = selectedProviderConfig(config, currentProvider);
    const providerMismatch = currentProvider !== selectedModel.providerKey;
    const endpointMismatch = selectedModel.baseUrl && comparableBaseUrl(currentConfig?.base_url || currentConfig?.baseUrl) !== comparableBaseUrl(selectedModel.baseUrl);
    if (providerMismatch || endpointMismatch) profilePlans.push({ profileName: profile.name, configPath, model: selectedModel, modelName: profile.model, fromProvider: currentProvider });
  }
  const backupNeeded = stateUpdates.length || profilePlans.length;
  const backupDir = path.join(migrationRoot, new Date().toISOString().replace(/[:.]/g, '-'));
  if (backupNeeded) {
    await mkdir(backupDir, { recursive: true });
    await cp(statePath, path.join(backupDir, 'workbench-state.json'));
    for (const plan of profilePlans) {
      const target = path.join(backupDir, 'profiles', plan.profileName, 'config.yaml');
      await mkdir(path.dirname(target), { recursive: true });
      await cp(plan.configPath, target);
    }
  }
  if (stateUpdates.length) {
    const nextModels = raw.models.map((model) => {
      const normalized = normalizedModels.find((item) => item.id === model.id);
      return normalized?.providerKey ? { ...model, providerKey: normalized.providerKey } : model;
    });
    await writeFile(statePath, `${JSON.stringify({ ...raw, models: nextModels }, null, 2)}\n`, 'utf8');
  }
  for (const plan of profilePlans) {
    await ensureModelProviderForProfile(plan.profileName, plan.model, plan.modelName, normalizedModels, { setDefault: true });
  }
  await mkdir(migrationRoot, { recursive: true });
  await writeFile(markerPath, `${JSON.stringify({
    version: 1,
    completedAt: now(),
    backupDir: backupNeeded ? backupDir : '',
    modelProviderKeys: stateUpdates.map((model) => ({ modelId: model.id, providerKey: model.providerKey })),
    profiles: profilePlans.map((plan) => ({ profileName: plan.profileName, fromProvider: plan.fromProvider, toProvider: plan.model.providerKey, model: plan.modelName })),
  }, null, 2)}\n`, 'utf8');
}

async function runPresetProviderCredentialMigration() {
  const migrationRoot = path.join(frakioWorkHome, 'backups', 'model-scope-migration');
  const markerPath = path.join(migrationRoot, 'v2-preset-credentials-complete.json');
  if (await exists(markerPath)) return;
  const raw = JSON.parse(await readFile(statePath, 'utf8').catch(() => 'null'));
  if (!raw || !Array.isArray(raw.models)) return;
  const normalizedModels = normalizeModels(raw.models);
  const profiles = await readHermesProfiles();
  const plans = [];
  const skipped = [];
  for (const profile of profiles) {
    const dir = await profileDirForName(profile.name);
    if (!dir) continue;
    const configPath = path.join(dir, 'config.yaml');
    const config = await readYamlFile(configPath);
    const providerKey = String(config?.model?.provider || config?.provider || '').trim();
    if (!providerKey || providerKey.startsWith('custom:') || !providerPresetByKey(providerKey)) continue;
    const candidates = normalizedModels.filter((model) => model.providerKey === providerKey && normalizeModelNames(model.models, model.model).includes(profile.model));
    if (candidates.length !== 1) {
      skipped.push({ profileName: profile.name, provider: providerKey, reason: candidates.length ? 'ambiguous_model' : 'model_not_found' });
      continue;
    }
    const model = candidates[0];
    const envMapping = providerEnvMap[providerKey] || {};
    const apiKey = await getReusableModelSecret(model, normalizedModels);
    const currentEnv = await readEnvValues(profileEnvPath(profile.name));
    const hasExistingKey = Boolean(envMapping.apiKey && String(currentEnv[envMapping.apiKey] || '').trim());
    if (envMapping.apiKey && !apiKey && !hasExistingKey) {
      skipped.push({ profileName: profile.name, provider: providerKey, reason: 'missing_api_key' });
      continue;
    }
    const expectedBaseUrl = model.baseUrl || providerPresetByKey(providerKey)?.baseUrl || '';
    const baseUrlMatches = !envMapping.baseUrl || !expectedBaseUrl || comparableBaseUrl(currentEnv[envMapping.baseUrl]) === comparableBaseUrl(expectedBaseUrl);
    const keyMatches = !envMapping.apiKey || !apiKey || String(currentEnv[envMapping.apiKey] || '').trim() === apiKey;
    if (baseUrlMatches && keyMatches) continue;
    plans.push({ profileName: profile.name, configPath, envPath: profileEnvPath(profile.name), provider: providerKey, model, modelName: profile.model });
  }
  const backupDir = path.join(migrationRoot, new Date().toISOString().replace(/[:.]/g, '-'), 'preset-provider-credentials');
  if (plans.length) {
    for (const plan of plans) {
      const targetDir = path.join(backupDir, 'profiles', plan.profileName);
      await mkdir(targetDir, { recursive: true });
      await cp(plan.configPath, path.join(targetDir, 'config.yaml'));
      if (await exists(plan.envPath)) await cp(plan.envPath, path.join(targetDir, '.env'));
      await ensureModelProviderForProfile(plan.profileName, plan.model, plan.modelName, normalizedModels, { setDefault: false });
    }
  }
  await mkdir(migrationRoot, { recursive: true });
  await writeFile(markerPath, `${JSON.stringify({
    version: 2,
    completedAt: now(),
    backupDir: plans.length ? backupDir : '',
    profiles: plans.map((plan) => ({ profileName: plan.profileName, provider: plan.provider, model: plan.modelName, hasApiKey: true })),
    skipped,
  }, null, 2)}\n`, 'utf8');
}

function matchesLegacyFields(value, legacy, keys) {
  if (!value || !legacy) return false;
  return keys.every((key) => JSON.stringify(value[key] ?? null) === JSON.stringify(legacy[key] ?? null));
}

function isUntouchedLegacyAgent(agent) {
  const legacy = legacyDemoAgents.find((item) => item.id === agent?.id);
  if (!legacy || !matchesLegacyFields(agent, legacy, ['id', 'name', 'role', 'model', 'color', 'soul', 'scope', 'source'])) return false;
  return !String(agent.profileName || '').trim()
    && !String(agent.userProfile || '').trim()
    && !String(agent.memory || '').trim()
    && !String(agent.avatarUrl || '').trim()
    && !(agent.skills || []).length
    && !(agent.plugins || []).length;
}

function isUntouchedLegacyModel(model) {
  const legacy = legacyDefaultModels.find((item) => item.id === model?.id);
  return Boolean(legacy && matchesLegacyFields(model, legacy, ['id', 'name', 'provider', 'kind', 'protocol', 'model', 'models', 'baseUrl', 'source', 'pricing']));
}

function isUntouchedLegacyWelcomeThread(thread) {
  if (thread?.id !== 'thread_default' || thread?.title !== '欢迎使用 Frakio Work') return false;
  if (JSON.stringify(thread.messages || []) !== JSON.stringify(legacyWelcomeMessages)) return false;
  return thread.workspaceId === 'workspace_default'
    && thread.mode === 'workspace'
    && thread.primaryAgentId === 'iris'
    && thread.defaultAgentId === 'iris'
    && JSON.stringify(thread.selectedAgents || []) === JSON.stringify(['iris', 'max']);
}

function isUntouchedLegacyVault(vault) {
  return vault?.id === 'vault_creative_ai_team'
    && vault?.name === '示例知识库'
    && vault?.status === 'not_indexed'
    && Number(vault?.documentCount || 0) === 0
    && Number(vault?.productCount || 0) === 0
    && !vault?.lastIndexedAt
    && !vault?.index;
}

function modelIsReferenced(state, model, remainingAgents, remainingThreads, secrets) {
  const names = new Set([model.id, model.name, model.model].filter(Boolean));
  if (remainingAgents.some((agent) => names.has(agent.model))) return true;
  if (remainingThreads.some((thread) => Object.values(thread.agentModelOverrides || {}).some((value) => names.has(String(value || '').split('::')[0]) || names.has(String(value || '').split('::')[1])))) return true;
  if (String(secrets.models?.[model.id]?.apiKey || '').trim()) return true;
  return (state.observability?.modelUsage || []).some((usage) => names.has(usage?.modelId) || names.has(usage?.model) || names.has(usage?.modelName));
}

async function runLegacyDemoDataCleanupMigration() {
  const migrationRoot = path.join(frakioWorkHome, 'backups', 'demo-data-cleanup');
  const markerPath = path.join(migrationRoot, 'v1-complete.json');
  if (await exists(markerPath)) return;
  const raw = JSON.parse(await readFile(statePath, 'utf8').catch(() => 'null'));
  if (!raw) return;
  const secrets = await readSecrets();
  const removedAgents = (raw.agents || []).filter(isUntouchedLegacyAgent);
  const remainingAgents = (raw.agents || []).filter((agent) => !removedAgents.includes(agent));
  const removedThreads = (raw.threads || []).filter(isUntouchedLegacyWelcomeThread);
  const remainingThreads = (raw.threads || []).filter((thread) => !removedThreads.includes(thread));
  const removedVaults = (raw.vaults || []).filter((vault) => isUntouchedLegacyVault(vault) && !remainingThreads.some((thread) => thread.vaultId === vault.id));
  const remainingVaults = (raw.vaults || []).filter((vault) => !removedVaults.includes(vault));
  const removedModels = (raw.models || []).filter((model) => isUntouchedLegacyModel(model) && !modelIsReferenced(raw, model, remainingAgents, remainingThreads, secrets));
  const remainingModels = (raw.models || []).filter((model) => !removedModels.includes(model));
  const removedAgentIds = new Set(removedAgents.map((agent) => agent.id));
  const removedThreadIds = new Set(removedThreads.map((thread) => thread.id));
  const removedVaultIds = new Set(removedVaults.map((vault) => vault.id));
  const removedModelIds = new Set(removedModels.map((model) => model.id));
  const next = {
    ...raw,
    agents: remainingAgents,
    models: remainingModels,
    threads: remainingThreads,
    vaults: remainingVaults,
    defaultVaultId: removedVaultIds.has(raw.defaultVaultId) ? null : raw.defaultVaultId || null,
    ui: {
      ...(raw.ui || {}),
      defaultAgentId: removedAgentIds.has(raw.ui?.defaultAgentId) ? '' : raw.ui?.defaultAgentId || '',
      defaultModel: removedModelIds.has(raw.ui?.defaultModel) ? '' : raw.ui?.defaultModel || '',
    },
    workspaces: (raw.workspaces || []).map((workspace) => ({
      ...workspace,
      activeThreadId: removedThreadIds.has(workspace.activeThreadId) ? null : workspace.activeThreadId || null,
      vaultId: removedVaultIds.has(workspace.vaultId) ? null : workspace.vaultId || null,
    })),
  };
  const changed = removedAgents.length || removedModels.length || removedThreads.length || removedVaults.length;
  let backupPath = '';
  if (changed) {
    await mkdir(migrationRoot, { recursive: true });
    backupPath = path.join(migrationRoot, `workbench-state-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await cp(statePath, backupPath);
    await writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }
  await mkdir(migrationRoot, { recursive: true });
  await writeFile(markerPath, `${JSON.stringify({
    version: 1,
    completedAt: now(),
    backupPath,
    removedAgentIds: [...removedAgentIds],
    removedModelIds: [...removedModelIds],
    removedThreadIds: [...removedThreadIds],
    removedVaultIds: [...removedVaultIds],
  }, null, 2)}\n`, 'utf8');
}

async function updateHermesProfileSkillState(profileName, skillName, enabled) {
  const dir = await profileDirForName(profileName);
  if (!dir) {
    const error = new Error('未找到可编辑的 Hermes Profile。');
    error.status = 404;
    throw error;
  }
  if (!isInside(hermesHome, dir)) {
    const error = new Error('Profile 路径超出 Hermes Home。');
    error.status = 403;
    throw error;
  }
  const cleanName = assertSafeModuleName(skillName);
  const configPath = path.join(dir, 'config.yaml');
  const config = await readYamlFile(configPath);
  const disabled = disabledSkillsFromConfig(config);
  if (enabled) disabled.delete(cleanName);
  else disabled.add(cleanName);
  const nextConfig = {
    ...config,
    skills: {
      ...(typeof config.skills === 'object' && config.skills ? config.skills : {}),
      disabled: Array.from(disabled).sort(),
    },
  };
  await writeFile(configPath, YAML.stringify(nextConfig), 'utf8');
  return { profileName, skillName: cleanName, enabled };
}

app.get('/api/hermes-profiles/:profileName/avatar', async (req, res) => {
  const dir = await profileDirForName(req.params.profileName);
  if (!dir) return res.status(404).send('Profile not found');
  const assetsDir = path.join(dir, 'assets');
  try {
    const entries = await readdir(assetsDir, { withFileTypes: true });
    const avatar = entries.find((entry) => entry.isFile() && /^avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name));
    if (!avatar) return res.status(404).send('Avatar not found');
    const avatarPath = path.join(assetsDir, avatar.name);
    const ext = path.extname(avatar.name).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    res.type(contentType).send(await readFile(avatarPath));
  } catch {
    res.status(404).send('Avatar not found');
  }
});

app.get('/api/user-profile/avatar', async (_req, res) => {
  try {
    const assetsDir = path.join(hermesWorkbenchRuntimeHome, 'assets');
    const entries = await readdir(assetsDir, { withFileTypes: true }).catch(() => []);
    const avatar = entries.find((entry) => entry.isFile() && /^user-avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name));
    if (!avatar) return res.status(404).send('Avatar not found');
    const avatarPath = path.join(assetsDir, avatar.name);
    const ext = path.extname(avatar.name).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    res.type(contentType).send(await readFile(avatarPath));
  } catch {
    res.status(404).send('Avatar not found');
  }
});

app.get('/api/user-profile', async (_req, res) => {
  const state = await readState();
  res.json({ userProfile: state.userProfile || normalizeUserProfile() });
});

app.post('/api/user-profile/avatar', async (req, res) => {
  try {
    const mime = String(req.body?.mimeType || '');
    const data = String(req.body?.data || '');
    const match = data.match(/^data:([^;]+);base64,(.+)$/);
    const rawBase64 = match ? match[2] : data;
    const detectedMime = match ? match[1] : mime;
    const supported = /image\/(png|webp|gif|jpeg|jpg)/i.test(detectedMime);
    if (!supported) return res.status(400).json({ error: '仅支持 png、jpg、webp、gif 头像。' });
    const buffer = Buffer.from(rawBase64, 'base64');
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) return res.status(400).json({ error: '头像大小需小于 3MB。' });
    const assetsDir = path.join(hermesWorkbenchRuntimeHome, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const existing = await readdir(assetsDir, { withFileTypes: true }).catch(() => []);
    await Promise.all(existing.filter((entry) => entry.isFile() && /^user-avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name)).map((entry) => unlink(path.join(assetsDir, entry.name)).catch(() => null)));
    const avatarPath = path.join(assetsDir, 'user-avatar.png');
    if (!isInside(assetsDir, avatarPath)) return res.status(403).json({ error: '头像路径不合法。' });
    await writeFile(avatarPath, buffer);
    const fileStat = await stat(avatarPath);
    res.json({ avatarUrl: `/api/user-profile/avatar?v=${Math.round(fileStat.mtimeMs)}` });
  } catch (error) {
    res.status(500).json({ error: error.message || '头像保存失败。' });
  }
});

app.put('/api/user-profile', async (req, res) => {
  try {
    const state = await readState();
    const previous = state.userProfile || {};
    const next = normalizeUserProfile({ ...previous, ...(req.body?.userProfile || req.body || {}), updatedAt: now() });
    if (next.avatarUrl && next.nickname) next.completedAt = next.completedAt || now();
    state.userProfile = next;
    await writeState(state);
    await syncUserProfileToHermesProfiles(state, next);
    const refreshed = await readState();
    res.json({ userProfile: refreshed.userProfile, agents: refreshed.agents });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '用户资料保存失败。' });
  }
});

app.post('/api/hermes-profiles/:profileName/avatar', async (req, res) => {
  try {
    const dir = await profileDirForName(req.params.profileName);
    if (!dir) return res.status(404).json({ error: '未找到可编辑的 Hermes Profile。' });
    const mimeType = String(req.body?.mimeType || '').toLowerCase();
    if (!/image\/(png|webp|gif|jpeg|jpg)/i.test(mimeType)) return res.status(400).json({ error: '只支持 PNG、JPG、WEBP、GIF 头像。' });
    const rawData = String(req.body?.data || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    const buffer = Buffer.from(rawData, 'base64');
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: '头像文件为空或超过 5MB。' });
    const assetsDir = path.join(dir, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const entries = await readdir(assetsDir, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter((entry) => entry.isFile() && /^avatar\.(png|jpe?g|webp|gif)$/i.test(entry.name))
      .map((entry) => rm(path.join(assetsDir, entry.name), { force: true })));
    const avatarPath = path.join(assetsDir, 'avatar.png');
    if (!isInside(dir, avatarPath)) return res.status(403).json({ error: '头像路径超出 Hermes Profile。' });
    await writeFile(avatarPath, buffer);
    const synced = await syncProfileAgent(req.params.profileName);
    res.json({ avatarUrl: await findProfileAvatar(dir, req.params.profileName), agent: synced.agent, profile: synced.profile });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '头像保存失败。' });
  }
});

app.get('/api/hermes-profiles/:profileName/file', async (req, res) => {
  try {
    const { target } = await resolveProfileTextFile(req.params.profileName, req.query.kind, req.query.name);
    const content = await readFile(target, 'utf8').catch(() => '');
    res.json({ content, file: target });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '读取 Profile 文件失败。' });
  }
});

app.put('/api/hermes-profiles/:profileName/file', async (req, res) => {
  try {
    const moduleKind = String(req.body?.kind || '').trim();
    const { target } = await resolveProfileTextFile(req.params.profileName, moduleKind, req.body?.name);
    const content = String(req.body?.content || '').slice(0, 250000);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
    const synced = await syncProfileAgent(req.params.profileName);
    if (moduleKind === 'skill' || moduleKind === 'plugin') {
      captureTelemetry('feature_used', { feature: moduleKind === 'skill' ? 'skill_synced' : 'plugin_synced', outcome: 'completed' });
      captureMeaningfulActivity('feature_used');
    }
    res.json({ ok: true, file: target, agent: synced.agent, profile: synced.profile });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '保存 Profile 文件失败。' });
  }
});

app.put('/api/hermes-profiles/:profileName/skill-state', async (req, res) => {
  try {
    const result = await updateHermesProfileSkillState(req.params.profileName, req.body?.name, Boolean(req.body?.enabled));
    const synced = await syncProfileAgent(req.params.profileName);
    captureTelemetry('feature_used', { feature: 'skill_synced', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ ok: true, ...result, agent: synced.agent, profile: synced.profile });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '技能状态保存失败。' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'frakio-work-api', port });
});

app.get('/api/hermes-local/status', async (_req, res) => {
  const discovery = await discoverHermesStudio();
  const state = await readState();
  state.integrations.hermesStudio = {
    ...state.integrations.hermesStudio,
    detectedUrl: discovery.studio.url || state.integrations.hermesStudio.detectedUrl || '',
    lastCheckedAt: discovery.checkedAt,
    authMode: discovery.studio.authMode,
  };
  await writeState(state);
  res.json(discovery);
});

app.post('/api/hermes-local/import', async (req, res) => {
  const discovery = await discoverHermesStudio();
  const requested = Array.isArray(req.body?.profiles) && req.body.profiles.length ? new Set(req.body.profiles.map(String)) : null;
  const profiles = userVisibleHermesProfiles(discovery.profiles).filter((profile) => !requested || requested.has(profile.name));
  const state = await readState();
  const importedProfileNames = new Set((state.integrations.hermesStudio.importedProfileNames || []).filter((name) => !isSystemHermesProfile(name)));
  state.models = normalizeModels(state.models).filter((model) => !isBadHermesStudioModel(model) && model.source !== 'hermes-profile');

  for (const profile of profiles) {
    const canonicalAgentId = profile.name === 'default' ? 'hermes-default' : slug(profile.name);
    const existingAgent = state.agents.find((agent) => agent.profileName === profile.name || agent.id === canonicalAgentId || agent.id === slug(profile.name));
    const nextAgent = agentFromProfile(profile, existingAgent);
    const existingAgentIndex = state.agents.findIndex((agent) => agent.id === nextAgent.id);
    if (existingAgentIndex >= 0) state.agents[existingAgentIndex] = { ...state.agents[existingAgentIndex], ...nextAgent };
    else state.agents.push(nextAgent);
    importedProfileNames.add(profile.name);
  }

  state.integrations.hermesStudio = {
    ...state.integrations.hermesStudio,
    detectedUrl: discovery.studio.url,
    lastCheckedAt: discovery.checkedAt,
    selectedProfile: req.body?.selectedProfile || state.integrations.hermesStudio.selectedProfile || profiles[0]?.name || 'default',
    importedProfileNames: Array.from(importedProfileNames).sort(),
    authMode: discovery.studio.authMode,
  };
  await writeState(state);
  res.json({
    importedProfiles: profiles.map((profile) => profile.name),
    agents: state.agents,
    hermesStudio: state.integrations.hermesStudio,
    discovery,
  });
});

async function commandExists(command) {
  return Boolean(await resolveCommand(command));
}

async function resolveCommand(command) {
  try {
    return await resolveRuntimeCommand(command);
  } catch {
    return '';
  }
}

async function runLoggedCommand(command, args, options = {}, logs = []) {
  logs.push(`$ ${[command, ...args].join(' ')}`);
  if (Object.prototype.hasOwnProperty.call(options, 'input')) {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: runtimeEnv(options.env || {}),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        stderr += `\nCommand timed out after ${options.timeout || 120000}ms.`;
      }, options.timeout || 120000);
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        logs.push(String(error?.message || error));
        resolve(false);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (stdout.trim()) logs.push(stdout.trim());
        if (stderr.trim()) logs.push(stderr.trim());
        resolve(code === 0);
      });
      child.stdin.end(options.input || '');
    });
  }
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: options.timeout || 120000,
      maxBuffer: 1024 * 1024,
      cwd: options.cwd,
      env: runtimeEnv(options.env || {}),
    });
    if (stdout.trim()) logs.push(stdout.trim());
    if (stderr.trim()) logs.push(stderr.trim());
    return true;
  } catch (error) {
    logs.push(String(error?.stderr || error?.message || error));
    return false;
  }
}

function tailInstallLogs(logs, maxLines = 80) {
  return logs.slice(Math.max(0, logs.length - maxLines));
}

async function commandOutput(command, args, options = {}) {
  const { stdout } = await execFileAsync(command, args, {
    timeout: options.timeout || 120000,
    maxBuffer: options.maxBuffer || 1024 * 1024,
    cwd: options.cwd,
    env: runtimeEnv(options.env || {}),
  });
  return String(stdout || '').trim();
}

async function gitOutput(repoPath, args, options = {}) {
  return commandOutput('git', ['-C', repoPath, ...args], options);
}

async function gitCommand(repoPath, args, options = {}, logs = []) {
  return runLoggedCommand('git', ['-C', repoPath, ...args], options, logs);
}

async function readFrakioPackageVersion() {
  return resolveAppVersion({
    envVersion: process.env.FRAKIO_WORK_APP_VERSION,
    packagePath: path.join(projectRoot, 'package.json'),
    readFileImpl: readFile,
  });
}

async function readHermesAgentPackageInfo(repoPath = hermesAgentSourcePath) {
  const pyprojectPath = path.join(repoPath, 'pyproject.toml');
  const initPath = path.join(repoPath, 'hermes_cli', '__init__.py');
  const info = { version: '', releaseDate: '' };
  try {
    const raw = await readFile(pyprojectPath, 'utf8');
    info.version = raw.match(/^version\s*=\s*"([^"]+)"/m)?.[1] || '';
  } catch {}
  try {
    const raw = await readFile(initPath, 'utf8');
    info.version = info.version || raw.match(/__version__\s*=\s*"([^"]+)"/)?.[1] || '';
    info.releaseDate = raw.match(/__release_date__\s*=\s*"([^"]+)"/)?.[1] || '';
  } catch {}
  return info;
}

function versionLabel(info = {}) {
  if (!info.version) return '';
  return `v${info.version}${info.releaseDate ? ` (${info.releaseDate})` : ''}`;
}

async function latestHermesReleaseInfo(repoPath = hermesAgentSourcePath) {
  const info = { tag: '', version: '', releaseDate: '', label: '', url: '', commit: '' };
  try {
    const raw = await commandOutput('git', ['ls-remote', '--tags', '--sort=-version:refname', officialHermesAgentRepo], { timeout: 20000, maxBuffer: 1024 * 1024 });
    const tags = new Map();
    for (const line of raw.split('\n')) {
      const match = line.match(/^([a-f0-9]+)\s+refs\/tags\/(v\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?)(\^\{\})?$/i);
      if (!match) continue;
      const previous = tags.get(match[2]);
      if (!previous || match[3]) tags.set(match[2], { tag: match[2], commit: match[1] });
    }
    const latest = [...tags.values()].sort((a, b) => compareVersionDesc(a.tag, b.tag))[0];
    if (latest) {
      info.tag = latest.tag;
      info.commit = latest.commit;
    }
  } catch {}
  if (info.tag) {
    info.releaseDate = info.tag.replace(/^v/, '');
    info.url = `https://github.com/NousResearch/hermes-agent/releases/tag/${info.tag}`;
  }
  try {
    if (info.tag) {
      const response = await fetch(`https://raw.githubusercontent.com/NousResearch/hermes-agent/${encodeURIComponent(info.tag)}/pyproject.toml`, { signal: AbortSignal.timeout(15000) });
      if (response.ok) {
        const remotePyproject = await response.text();
        info.version = remotePyproject.match(/^version\s*=\s*"([^"]+)"/m)?.[1] || '';
      }
    }
  } catch {}
  info.label = info.version ? `v${info.version}${info.releaseDate ? ` (${info.releaseDate})` : ''}` : info.tag;
  return info;
}

let officialHermesReleaseCache = { checkedAt: 0, value: null };

async function cachedOfficialHermesRelease({ force = false } = {}) {
  if (!force && officialHermesReleaseCache.value && Date.now() - officialHermesReleaseCache.checkedAt < 5 * 60 * 1000) {
    return officialHermesReleaseCache.value;
  }
  const value = await latestHermesReleaseInfo();
  officialHermesReleaseCache = { checkedAt: Date.now(), value };
  return value;
}

function findBundledHermesRuntimeSync() {
  for (const root of uniquePathEntries([frakioBundledHermesRuntimeRoot, path.join(projectRoot, 'runtime', 'hermes')])) {
    for (const runtimeDir of runtimeCandidateDirs(root)) {
      const runtime = inspectHermesRuntimeDir(runtimeDir, 'bundled');
      if (runtime) return runtime;
    }
  }
  return null;
}

function runtimePublicInfo(runtime, extra = {}) {
  if (!runtime) return null;
  return {
    source: runtime.source,
    runtimeDir: runtime.runtimeDir,
    pythonRoot: runtime.pythonRoot,
    python: runtime.python,
    node: runtime.node,
    version: runtime.version,
    platform: runtime.platform,
    bridgeProtocolVersion: runtime.bridgeProtocolVersion,
    manifest: runtime.manifest || null,
    ...extra,
  };
}

function managedHermesRuntimesSync() {
  const registry = readRuntimeRegistrySync();
  const runtimes = [];
  for (const runtimeDir of runtimeCandidateDirs(frakioManagedHermesRuntimeRoot)) {
    const runtime = inspectHermesRuntimeDir(runtimeDir, 'managed');
    if (!runtime) continue;
    const registered = registry.runtimes.find((item) => item?.version === runtime.version && item?.platform === runtime.platform) || {};
    runtimes.push(runtimePublicInfo(runtime, {
      active: registry.activeVersion === runtime.version,
      installedAt: registered.installedAt || runtime.manifest?.builtAt || '',
      verified: registered.verified !== false,
      compatible: runtime.bridgeProtocolVersion === frakioBridgeProtocolVersion,
    }));
  }
  return runtimes.sort((a, b) => compareVersionDesc(a.version, b.version));
}

async function runtimeManagerStatus({ refreshOfficial = false } = {}) {
  const activeRuntime = findFrakioHermesRuntimeSync();
  const bundledRuntime = findBundledHermesRuntimeSync();
  const registry = readRuntimeRegistrySync();
  const officialLatest = await cachedOfficialHermesRelease({ force: refreshOfficial });
  return {
    activeRuntime: runtimePublicInfo(activeRuntime),
    bundledRuntime: runtimePublicInfo(bundledRuntime),
    managedRuntimes: managedHermesRuntimesSync(),
    officialLatest,
    registryPath: frakioRuntimeRegistryPath,
    managedRoot: frakioManagedHermesRuntimeRoot,
    sourcePath: hermesAgentSourcePath,
    activeVersion: registry.activeVersion || '',
    previousVersion: registry.previousVersion || '',
    bridgeProtocolVersion: frakioBridgeProtocolVersion,
    fallbackReason: runtimeFallbackReason,
  };
}

async function ensureManagedHermesSource(tag, logs) {
  await mkdir(path.dirname(hermesAgentSourcePath), { recursive: true });
  if (!(await exists(path.join(hermesAgentSourcePath, '.git')))) {
    await requireLoggedCommand('git', ['clone', '--filter=blob:none', '--no-checkout', officialHermesAgentRepo, hermesAgentSourcePath], {
      timeout: 240000,
      errorMessage: '下载 Hermes Agent 官方仓库失败。',
    }, logs);
  } else {
    const remote = await gitOutput(hermesAgentSourcePath, ['remote', 'get-url', 'origin'], { timeout: 5000 }).catch(() => '');
    if (managedHermesInstallKind(remote) !== 'managed') {
      const error = new Error('Frakio Work 的 Hermes Agent 源码缓存不是 NousResearch 官方仓库。');
      error.status = 409;
      throw error;
    }
  }
  await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'fetch', 'origin', '--tags', '--prune'], {
    timeout: 240000,
    errorMessage: '获取 Hermes Agent 官方版本失败。',
  }, logs);
  await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'checkout', '--detach', '--force', tag], {
    timeout: 120000,
    errorMessage: `无法切换到 Hermes Agent ${tag}。`,
  }, logs);
  return gitOutput(hermesAgentSourcePath, ['rev-parse', 'HEAD'], { timeout: 5000 });
}

async function repairPortablePythonLinks(runtimeDir) {
  if (process.platform === 'win32') return;
  const binDir = path.join(runtimeDir, 'python', 'bin');
  const entries = await readdir(binDir, { withFileTypes: true });
  const executable = entries
    .filter((entry) => entry.isFile() && /^python3\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareVersionDesc)[0];
  if (!executable) throw new Error('Runtime 中缺少可移植的 Python 可执行文件。');
  for (const name of ['python', 'python3']) {
    const target = path.join(binDir, name);
    await rm(target, { force: true });
    await symlink(executable, target);
  }
}

async function rewritePortablePythonEntrypoints(runtimeDir) {
  if (process.platform === 'win32') return;
  const binDir = path.join(runtimeDir, 'python', 'bin');
  const entries = await readdir(binDir, { withFileTypes: true });
  const launcher = `#!/bin/sh\n'''exec' "$(dirname "$0")/python3" "$0" "$@"\n' '''`;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(binDir, entry.name);
    const raw = await readFile(filePath, 'utf8').catch(() => '');
    if (!raw.startsWith('#!')) continue;
    let next = raw;
    if (raw.startsWith("#!/bin/sh\n'''exec' ")) {
      next = raw.replace(/^#!\/bin\/sh\n'''exec' [^\n]+\n' '''/, launcher);
    } else if (/^#![^\n]*python[^\n]*\n/.test(raw)) {
      next = raw.replace(/^#![^\n]*python[^\n]*\n/, `${launcher}\n`);
    }
    if (next !== raw) await writeFile(filePath, next, { encoding: 'utf8', mode: 0o755 });
  }
}

async function verifyManagedRuntime(runtimeDir, expectedVersion, logs) {
  const runtime = inspectHermesRuntimeDir(runtimeDir, 'managed');
  if (!runtime) throw new Error('安装后的 Runtime 缺少 Python。');
  const versionOutput = await commandOutput(runtime.python, ['-m', 'hermes_cli.main', '--version'], {
    cwd: runtimeDir,
    timeout: 30000,
    env: { HERMES_HOME: hermesHome, HERMES_AGENT_ROOT: runtime.pythonRoot },
  });
  logs.push(versionOutput);
  if (expectedVersion && !versionOutput.includes(expectedVersion)) {
    throw new Error(`Runtime 版本验证失败：期望 ${expectedVersion}，实际为 ${versionOutput || '未知'}。`);
  }
  await requireLoggedCommand(runtime.python, ['-c', `import aiohttp, hermes_cli, hermes_cli.main; assert aiohttp.__version__ == "${requiredAiohttpVersion}"; print("Hermes and aiohttp imports ready")`], {
    cwd: runtimeDir,
    timeout: 30000,
    env: { HERMES_HOME: hermesHome, HERMES_AGENT_ROOT: runtime.pythonRoot },
    errorMessage: 'Hermes Agent 模块导入失败。',
  }, logs);

  const bridgeScript = (await findFrakioBridgeScript())?.path;
  if (!bridgeScript) throw new Error('Frakio Work Bridge 不存在。');
  const endpointPath = path.join(os.tmpdir(), `frakio-bridge-${randomUUID().slice(0, 8)}.sock`);
  const endpoint = `ipc://${endpointPath}`;
  const child = spawn(runtime.python, [bridgeScript, '--endpoint', endpoint, '--hermes-home', hermesHome, '--agent-root', runtime.pythonRoot], {
    cwd: projectRoot,
    env: runtimeEnv({ HERMES_HOME: hermesHome, HERMES_AGENT_ROOT: runtime.pythonRoot, HERMES_AGENT_BRIDGE_ENDPOINT: endpoint }),
    stdio: 'ignore',
  });
  try {
    const ping = await requestHermesBridge({ action: 'ping' }, { endpoint, timeoutMs: 1500, retryMs: 15000 });
    if (!ping?.ok) throw new Error('Frakio Work Bridge 自检没有返回 ready。');
    logs.push('Frakio Work Bridge protocol check passed.');
  } finally {
    child.kill('SIGTERM');
    await unlink(endpointPath).catch(() => null);
  }
  return { runtime, versionOutput };
}

async function installManagedHermesRuntime({ tag = '' } = {}, logs = []) {
  const official = await cachedOfficialHermesRelease({ force: true });
  const targetTag = String(tag || official.tag || '').trim();
  if (!targetTag || !/^v\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?$/.test(targetTag)) {
    const error = new Error('没有找到可安装的 Hermes Agent 官方稳定版本。');
    error.status = 409;
    throw error;
  }
  const commit = await ensureManagedHermesSource(targetTag, logs);
  const packageInfo = await readHermesAgentPackageInfo(hermesAgentSourcePath);
  if (!packageInfo.version) throw new Error(`无法读取 ${targetTag} 的 Hermes Agent 版本。`);
  const platform = hermesRuntimePlatformDir();
  const destination = path.join(frakioManagedHermesRuntimeRoot, packageInfo.version, platform);
  const existing = inspectHermesRuntimeDir(destination, 'managed');
  if (existing && existing.manifest?.sourceCommit === commit) {
    logs.push(`Hermes Agent ${packageInfo.version} 已安装。`);
    return runtimePublicInfo(existing);
  }

  const bundled = findBundledHermesRuntimeSync();
  if (!bundled) throw new Error('缺少内置 Runtime，无法创建用户 Runtime。');
  const staging = path.join(frakioRuntimeStagingRoot, `hermes-${packageInfo.version}-${randomUUID()}`);
  await mkdir(frakioRuntimeStagingRoot, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  try {
    logs.push(`creating isolated runtime from bundled base: ${bundled.runtimeDir}`);
    await cp(bundled.runtimeDir, staging, { recursive: true, dereference: true, preserveTimestamps: true });
    await repairPortablePythonLinks(staging);
    const stagingRuntime = inspectHermesRuntimeDir(staging, 'managed');
    await requireLoggedCommand(stagingRuntime.python, ['-m', 'pip', 'install', '--upgrade', '--force-reinstall', '--no-cache-dir', hermesAgentSourcePath, `aiohttp==${requiredAiohttpVersion}`], {
      cwd: hermesAgentSourcePath,
      timeout: 30 * 60 * 1000,
      env: { HERMES_HOME: hermesHome, HERMES_AGENT_ROOT: stagingRuntime.pythonRoot },
      errorMessage: `Hermes Agent ${packageInfo.version} 安装失败。`,
    }, logs);
    await rewritePortablePythonEntrypoints(staging);
    const manifest = {
      schema: 1,
      platform,
      targetOs: process.platform,
      targetArch: process.arch,
      hermesAgentVersion: packageInfo.version,
      sourceRepo: officialHermesAgentRepo,
      sourceTag: targetTag,
      sourceCommit: commit,
      pythonDependencies: { aiohttp: requiredAiohttpVersion },
      builtAt: now(),
      bridgeProtocolVersion: frakioBridgeProtocolVersion,
    };
    await writeFile(path.join(staging, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await verifyManagedRuntime(staging, packageInfo.version, logs);
    await mkdir(path.dirname(destination), { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
    const registry = readRuntimeRegistrySync();
    const entry = { version: packageInfo.version, platform, runtimeDir: destination, installedAt: now(), verified: true, sourceTag: targetTag, sourceCommit: commit, bridgeProtocolVersion: frakioBridgeProtocolVersion };
    await writeRuntimeRegistry({ ...registry, runtimes: [...registry.runtimes.filter((item) => !(item?.version === entry.version && item?.platform === entry.platform)), entry] });
    return runtimePublicInfo(inspectHermesRuntimeDir(destination, 'managed'), { installedAt: entry.installedAt, verified: true, compatible: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => null);
    throw error;
  }
}

async function stopOwnedHermesRuntime(logs = []) {
  const bridge = await probeHermesBridge({ timeoutMs: 700 });
  if (bridge.ready && !process.env.HERMES_AGENT_BRIDGE_ENDPOINT) {
    await terminatePids(collectBridgePids(bridge.ping || {}), logs, 'Hermes Bridge');
    const endpoint = hermesBridgeEndpoint();
    if (endpoint.startsWith('ipc://')) await unlink(endpoint.slice('ipc://'.length)).catch(() => null);
  }
  hermesBridgeProcess = null;
  if (hermesApiProcess?.pid) await terminatePids([hermesApiProcess.pid], logs, 'Hermes Runtime API');
  hermesApiProcess = null;
}

async function activateManagedHermesRuntime(version, logs = []) {
  const cleanVersion = String(version || '').trim();
  const runtimeDir = path.join(frakioManagedHermesRuntimeRoot, cleanVersion, hermesRuntimePlatformDir());
  const runtime = inspectHermesRuntimeDir(runtimeDir, 'managed');
  if (!runtime) {
    const error = new Error(`Hermes Agent Runtime ${cleanVersion} 未安装。`);
    error.status = 404;
    throw error;
  }
  if (runtime.bridgeProtocolVersion !== frakioBridgeProtocolVersion) {
    const error = new Error(`Runtime Bridge 协议 ${runtime.bridgeProtocolVersion} 与 Frakio Work ${frakioBridgeProtocolVersion} 不兼容。`);
    error.status = 409;
    throw error;
  }
  await verifyManagedRuntime(runtimeDir, cleanVersion, logs);
  const registry = readRuntimeRegistrySync();
  const previousVersion = registry.activeVersion || '';
  await writeRuntimeRegistry({ ...registry, activeVersion: cleanVersion, previousVersion });
  await stopOwnedHermesRuntime(logs);
  const autoStart = await ensureHermesRuntimeReady({ force: true });
  if (autoStart.status === 'failed') {
    await writeRuntimeRegistry({ ...readRuntimeRegistrySync(), activeVersion: previousVersion, previousVersion: cleanVersion });
    await stopOwnedHermesRuntime(logs);
    await ensureHermesRuntimeReady({ force: true });
    const error = new Error(`Runtime ${cleanVersion} 启动失败，已恢复原 Runtime。${autoStart.error ? ` ${autoStart.error}` : ''}`);
    error.status = 500;
    throw error;
  }
  return runtimePublicInfo(findFrakioHermesRuntimeSync());
}

async function activateBundledHermesRuntime(logs = []) {
  const registry = readRuntimeRegistrySync();
  await writeRuntimeRegistry({ ...registry, activeVersion: '', previousVersion: registry.activeVersion || registry.previousVersion || '' });
  await stopOwnedHermesRuntime(logs);
  await ensureHermesRuntimeReady({ force: true });
  return runtimePublicInfo(findFrakioHermesRuntimeSync());
}

function managedHermesInstallKind(remoteUrl = '') {
  const normalized = String(remoteUrl || '').toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized.includes('github.com/nousresearch/hermes-agent')) return 'managed';
  return 'external';
}

function parsePorcelainFile(line = '') {
  const raw = String(line || '').trim();
  if (!raw) return '';
  if (raw.includes(' -> ')) return raw.split(' -> ').pop().trim();
  if (raw.startsWith('?? ')) return raw.slice(3).trim();
  if (/^[A-Z?]{1,2}\s+/.test(raw)) return raw.replace(/^[A-Z?]{1,2}\s+/, '').trim();
  return raw.slice(3).trim();
}

async function directorySize(target) {
  let total = 0;
  async function walk(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        try { total += (await stat(full)).size; } catch {}
      }
    }
  }
  try {
    const s = await stat(target);
    if (s.isDirectory()) await walk(target);
    else total += s.size;
  } catch {}
  return total;
}

async function copyIfExists(source, target) {
  if (!(await exists(source))) return false;
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true, errorOnExist: false });
  return true;
}

async function copyHermesConfigSnapshot(snapshotDir) {
  const configDir = path.join(snapshotDir, 'config');
  const copied = [];
  const candidates = [
    ['hermes/config.yaml', path.join(hermesHome, 'config.yaml')],
    ['hermes/.env', path.join(hermesHome, '.env')],
    ['hermes/profiles', path.join(hermesHome, 'profiles')],
    ['hermes/mcp_servers.json', path.join(hermesHome, 'mcp_servers.json')],
    ['hermes/mcp.json', path.join(hermesHome, 'mcp.json')],
    ['hermes/channels.yaml', path.join(hermesHome, 'channels.yaml')],
    ['hermes/channels.json', path.join(hermesHome, 'channels.json')],
    ['hermes/models.yaml', path.join(hermesHome, 'models.yaml')],
    ['hermes/models.json', path.join(hermesHome, 'models.json')],
    ['frakio/workbench-state.json', statePath],
    ['frakio/model-secrets.json', secretsPath],
  ];
  for (const [relative, source] of candidates) {
    if (await copyIfExists(source, path.join(configDir, relative))) copied.push(relative);
  }
  return copied;
}

async function restoreHermesConfigSnapshot(snapshotDir, scopes = {}) {
  const configDir = path.join(snapshotDir, 'config');
  const restored = [];
  const includeProfiles = scopes.profiles === true;
  const includeMcp = scopes.mcp === true;
  const includeChannels = scopes.channels === true;
  const includeModels = scopes.models === true;
  const candidates = [
    ['hermes/config.yaml', path.join(hermesHome, 'config.yaml'), true],
    ['hermes/.env', path.join(hermesHome, '.env'), true],
    ['hermes/profiles', path.join(hermesHome, 'profiles'), includeProfiles],
    ['hermes/mcp_servers.json', path.join(hermesHome, 'mcp_servers.json'), includeMcp],
    ['hermes/mcp.json', path.join(hermesHome, 'mcp.json'), includeMcp],
    ['hermes/channels.yaml', path.join(hermesHome, 'channels.yaml'), includeChannels],
    ['hermes/channels.json', path.join(hermesHome, 'channels.json'), includeChannels],
    ['hermes/models.yaml', path.join(hermesHome, 'models.yaml'), includeModels],
    ['hermes/models.json', path.join(hermesHome, 'models.json'), includeModels],
    ['frakio/workbench-state.json', statePath, includeModels || includeProfiles || includeMcp || includeChannels],
    ['frakio/model-secrets.json', secretsPath, includeModels],
  ];
  for (const [relative, target, enabled] of candidates) {
    if (!enabled) continue;
    const source = path.join(configDir, relative);
    if (await copyIfExists(source, target)) restored.push(relative);
  }
  return restored;
}

async function createHermesRollbackPoint(reason = 'manual', logs = [], options = {}) {
  await mkdir(hermesAgentBackupRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const idValue = `${timestamp}-${reason.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const backupDir = path.join(hermesAgentBackupRoot, idValue);
  const filesDir = path.join(backupDir, 'untracked-files');
  await mkdir(backupDir, { recursive: true });
  const repoStatus = await gitRepoStatus(hermesAgentSourcePath);
  const packageInfo = await readHermesAgentPackageInfo();
  const dirtyFiles = repoStatus.dirtyFiles || [];
  let tagDescription = '';
  try { tagDescription = await gitOutput(hermesAgentSourcePath, ['describe', '--tags', '--always', '--dirty'], { timeout: 5000 }); } catch {}
  let patchSaved = false;
  try {
    const patch = await gitOutput(hermesAgentSourcePath, ['diff', '--binary'], { timeout: 20000, maxBuffer: 30 * 1024 * 1024 });
    if (patch) {
      await writeFile(path.join(backupDir, 'tracked-changes.patch'), patch, 'utf8');
      patchSaved = true;
    }
  } catch (error) {
    logs.push(`patch backup skipped: ${error.message || error}`);
  }
  const untracked = dirtyFiles.filter((line) => line.startsWith('?? ')).map(parsePorcelainFile).filter(Boolean);
  const copiedUntracked = [];
  for (const relative of untracked) {
    const source = path.join(hermesAgentSourcePath, relative);
    const target = path.join(filesDir, relative);
    if (await copyIfExists(source, target)) copiedUntracked.push(relative);
  }
  const configFiles = await copyHermesConfigSnapshot(backupDir);
  const manifest = {
    id: idValue,
    createdAt: now(),
    reason,
    status: 'ready',
    path: backupDir,
    repoPath: hermesAgentSourcePath,
    before: {
      commit: repoStatus.currentCommit || '',
      branch: repoStatus.currentBranch || '',
      tagDescription,
      version: packageInfo.version,
      releaseDate: packageInfo.releaseDate,
      displayVersion: versionLabel(packageInfo),
    },
    after: options.after || null,
    dirtyFiles,
    patchSaved,
    untrackedFiles: copiedUntracked,
    configFiles,
    scopes: ['runtime', 'profiles', 'mcp', 'channels', 'models'],
  };
  await writeFile(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  manifest.size = await directorySize(backupDir);
  await writeFile(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  logs.push(`created rollback point: ${backupDir}`);
  return manifest;
}

async function updateHermesRollbackPoint(manifest, updates = {}) {
  if (!manifest?.path) return manifest;
  const next = { ...manifest, ...updates };
  next.size = await directorySize(manifest.path);
  await writeFile(path.join(manifest.path, 'manifest.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

async function listHermesBackups() {
  await mkdir(hermesAgentBackupRoot, { recursive: true });
  const entries = await readdir(hermesAgentBackupRoot, { withFileTypes: true }).catch(() => []);
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const backupDir = path.join(hermesAgentBackupRoot, entry.name);
    try {
      const manifest = JSON.parse(await readFile(path.join(backupDir, 'manifest.json'), 'utf8'));
      backups.push({ ...manifest, path: backupDir, size: await directorySize(backupDir) });
    } catch {}
  }
  backups.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return backups;
}

async function readHermesBackup(idValue) {
  const backups = await listHermesBackups();
  return backups.find((backup) => backup.id === idValue) || null;
}

async function cleanHermesCheckout(logs = []) {
  await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'reset', '--hard', 'HEAD'], {
    timeout: 120000,
    errorMessage: '恢复 Hermes Agent tracked 文件失败。',
  }, logs);
  await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'clean', '-fd'], {
    timeout: 120000,
    errorMessage: '清理 Hermes Agent 未跟踪文件失败。',
  }, logs);
}

async function gitRepoStatus(repoPath, options = {}) {
  const status = {
    path: repoPath,
    isGitRepo: false,
    installKind: 'unknown',
    currentCommit: '',
    currentBranch: '',
    currentTagDescription: '',
    displayVersion: '',
    version: '',
    releaseDate: '',
    latestVersion: '',
    latestReleaseTag: '',
    latestReleaseUrl: '',
    remoteUrl: '',
    upstreamCommit: '',
    dirtyFiles: [],
    dirtyKind: 'none',
    updateAvailable: false,
    canFastForward: false,
    blockedReason: '',
    packageVersion: options.packageVersion || undefined,
  };
  if (!(await exists(repoPath))) {
    status.blockedReason = '路径不存在。';
    return status;
  }
  try {
    const inside = await gitOutput(repoPath, ['rev-parse', '--is-inside-work-tree'], { timeout: 5000 });
    status.isGitRepo = inside === 'true';
  } catch {
    status.blockedReason = options.notGitReason || '当前路径不是 git 仓库，无法自动更新。';
    return status;
  }
  if (!status.isGitRepo) {
    status.blockedReason = options.notGitReason || '当前路径不是 git 仓库，无法自动更新。';
    return status;
  }
  try { status.currentCommit = await gitOutput(repoPath, ['rev-parse', 'HEAD'], { timeout: 5000 }); } catch {}
  try { status.currentBranch = await gitOutput(repoPath, ['branch', '--show-current'], { timeout: 5000 }); } catch {}
  try { status.currentTagDescription = await gitOutput(repoPath, ['describe', '--tags', '--always', '--dirty'], { timeout: 5000 }); } catch {}
  try { status.remoteUrl = await gitOutput(repoPath, ['remote', 'get-url', 'origin'], { timeout: 5000 }); } catch {}
  status.installKind = options.installKind || managedHermesInstallKind(status.remoteUrl);
  if (options.hermesAgent) {
    const packageInfo = await readHermesAgentPackageInfo(repoPath);
    const latest = await latestHermesReleaseInfo(repoPath);
    status.version = packageInfo.version;
    status.releaseDate = packageInfo.releaseDate;
    status.displayVersion = versionLabel(packageInfo) || status.currentTagDescription;
    status.latestVersion = latest.label;
    status.latestReleaseTag = latest.tag;
    status.latestReleaseUrl = latest.url;
  }
  try {
    const dirty = await gitOutput(repoPath, ['status', '--porcelain'], { timeout: 5000 });
    status.dirtyFiles = dirty ? dirty.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 80) : [];
  } catch {}
  if (status.dirtyFiles.length) {
    const tracked = status.dirtyFiles.filter((line) => !line.startsWith('?? ')).map(parsePorcelainFile).filter(Boolean);
    const untracked = status.dirtyFiles.filter((line) => line.startsWith('?? '));
    if (tracked.length === 1 && tracked[0] === 'uv.lock' && !untracked.length) status.dirtyKind = 'install-artifact';
    else if (tracked.length || untracked.length) status.dirtyKind = 'source-or-files';
  }
  const upstreamRefs = ['@{u}', 'origin/main', 'origin/master'];
  for (const ref of upstreamRefs) {
    try {
      status.upstreamCommit = await gitOutput(repoPath, ['rev-parse', ref], { timeout: 5000 });
      if (status.upstreamCommit) break;
    } catch {}
  }
  status.updateAvailable = Boolean(status.currentCommit && status.upstreamCommit && status.currentCommit !== status.upstreamCommit);
  if (status.currentCommit && status.upstreamCommit) {
    status.canFastForward = await gitCommand(repoPath, ['merge-base', '--is-ancestor', 'HEAD', status.upstreamCommit], { timeout: 5000 }, []);
  }
  if (!status.remoteUrl) status.blockedReason = '缺少 origin remote，无法检查远端更新。';
  else if (status.dirtyFiles.length && options.blockDirty !== false) status.blockedReason = `有本地改动，更新前会先备份并恢复官方状态：${status.dirtyFiles.slice(0, 3).join('、')}${status.dirtyFiles.length > 3 ? ' 等' : ''}`;
  else if (status.updateAvailable && !status.canFastForward) status.blockedReason = '远端更新不能 fast-forward，需要手动处理分支差异。';
  return status;
}

async function updatesStatus() {
  const backups = await listHermesBackups();
  const packageVersion = await readFrakioPackageVersion();
  const [hermesAgent, release] = await Promise.all([
    gitRepoStatus(hermesAgentSourcePath, { hermesAgent: true, blockDirty: false, notGitReason: 'Hermes Agent 不是 git checkout，无法自动更新。' }),
    appUpdateStatus({
      currentVersion: packageVersion,
      packaged: process.env.FRAKIO_WORK_PACKAGED === '1',
      platform: process.platform,
      arch: process.arch,
    }),
  ]);
  const frakioWork = {
    path: release.installMode === 'desktop-release'
      ? (process.platform === 'win32' ? '当前 Windows 安装包' : '当前 macOS 安装包')
      : projectRoot,
    isGitRepo: true,
    installKind: release.installMode,
    currentCommit: '',
    currentBranch: '',
    currentTagDescription: `v${packageVersion}`,
    displayVersion: `v${packageVersion}`,
    version: packageVersion,
    latestVersion: release.latestVersion ? `v${release.latestVersion}` : '',
    latestReleaseUrl: release.releaseUrl,
    remoteUrl: release.repositoryUrl,
    upstreamCommit: '',
    dirtyFiles: [],
    dirtyKind: 'none',
    updateAvailable: Boolean(release.updateAvailable),
    canFastForward: true,
    blockedReason: release.error || '',
    packageVersion,
    release,
  };
  return { checkedAt: now(), hermesAgent, frakioWork, backups, backupRoot: hermesAgentBackupRoot };
}

async function fetchUpdateStatus(target, logs) {
  const repoPath = target === 'hermes-agent' ? hermesAgentSourcePath : projectRoot;
  await requireLoggedCommand('git', ['-C', repoPath, 'fetch', 'origin', '--tags', '--prune'], {
    timeout: 180000,
    errorMessage: '检查远端更新失败。',
  }, logs);
  return updatesStatus();
}

function assertUpdateAllowed(target, status) {
  const item = target === 'hermes-agent' ? status.hermesAgent : status.frakioWork;
  if (!item?.isGitRepo) {
    const error = new Error(item?.blockedReason || '当前路径不是 git 仓库，无法自动更新。');
    error.status = 409;
    throw error;
  }
  if (item.dirtyFiles?.length) {
    const error = new Error(item.blockedReason || '有本地改动，无法自动更新。');
    error.status = 409;
    throw error;
  }
  if (!item.updateAvailable) {
    const error = new Error('当前已经是最新版本。');
    error.status = 409;
    throw error;
  }
  if (!item.canFastForward) {
    const error = new Error(item.blockedReason || '远端更新不能 fast-forward，需要手动处理。');
    error.status = 409;
    throw error;
  }
}

function assertUpdatePreflight(target, status) {
  const item = target === 'hermes-agent' ? status.hermesAgent : status.frakioWork;
  if (!item?.isGitRepo) {
    const error = new Error(item?.blockedReason || '当前路径不是 git 仓库，无法自动更新。');
    error.status = 409;
    throw error;
  }
  if (item.dirtyFiles?.length) {
    const error = new Error(item.blockedReason || '有本地改动，无法自动更新。');
    error.status = 409;
    throw error;
  }
}

async function requireLoggedCommand(command, args, options = {}, logs = []) {
  if (await runLoggedCommand(command, args, options, logs)) return;
  throw new Error(options.errorMessage || `${command} ${args.join(' ')} failed.`);
}

async function verifyHermesCli(logs = []) {
  const candidate = await resolveHermesExecutable();
  if (!candidate) throw new Error('Hermes CLI 未创建成功。');
  const args = ['--help'];
  logs.push(`verifying hermes cli: ${candidate}`);
  const ok = await runLoggedCommand(candidate, args, { timeout: 30000 }, logs);
  if (!ok) throw new Error('Hermes CLI 无法执行。');
  return candidate;
}

async function runOfficialHermesSetup(logs = []) {
  const setupScript = path.join(hermesAgentSourcePath, 'setup-hermes.sh');
  const installScript = path.join(hermesAgentSourcePath, 'scripts', 'install.sh');
  const env = {
    HERMES_HOME: hermesHome,
    CI: '1',
    NONINTERACTIVE: '1',
    PATH: `${path.join(homeDir, '.local', 'bin')}:${path.join(homeDir, '.cargo', 'bin')}:${process.env.PATH || ''}`,
  };
  if (await exists(setupScript)) {
    await requireLoggedCommand('/bin/bash', [setupScript], {
      cwd: hermesAgentSourcePath,
      timeout: 900000,
      env,
      input: 'n\nn\n',
      errorMessage: '官方 setup-hermes.sh 执行失败。',
    }, logs);
    return;
  }
  if (await exists(installScript)) {
    await requireLoggedCommand('/bin/bash', [installScript], {
      cwd: hermesAgentSourcePath,
      timeout: 900000,
      env,
      input: 'n\nn\n',
      errorMessage: '官方 scripts/install.sh 执行失败。',
    }, logs);
    return;
  }
  await requireLoggedCommand('/bin/sh', ['-lc', 'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/setup-hermes.sh | bash'], {
    cwd: hermesHome,
    timeout: 900000,
    env,
    input: 'n\nn\n',
    errorMessage: '官方远程安装脚本执行失败。',
  }, logs);
}

async function ensureHermesBaseConfig(logs) {
  await mkdir(hermesHome, { recursive: true });
  const configPath = path.join(hermesHome, 'config.yaml');
  if (!(await exists(configPath))) {
    await writeFile(configPath, '{}\n', { encoding: 'utf8', mode: 0o600 });
    logs.push(`created empty Hermes config: ${configPath}`);
  } else {
    logs.push(`preserved existing Hermes config and credentials: ${hermesHome}`);
  }
}

app.get('/api/hermes-bootstrap/status', async (_req, res) => {
  try {
    const bootstrap = await discoverHermesBootstrap();
    const state = await readState();
    state.integrations.hermesAgent = {
      ...(state.integrations.hermesAgent || {}),
      installPath: bootstrap.installPath,
      sourcePath: bootstrap.sourcePath,
      apiBaseUrl: bootstrap.api.apiBaseUrl,
      apiStatus: bootstrap.api.online ? 'connected' : bootstrap.status,
      selectedProfile: bootstrap.approval.profileName,
      lastCheckedAt: bootstrap.checkedAt,
      approvalMode: bootstrap.approval.mode,
    };
    await writeState(state);
    res.json(bootstrap);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes bootstrap status failed.' });
  }
});

app.post('/api/hermes-bootstrap/install', async (req, res) => {
  const logs = [];
  let phase = 'verify-runtime';
  try {
    const runtime = findFrakioHermesRuntimeSync();
    if (!runtime) return res.status(409).json({ error: 'Frakio Work 安装包缺少内置 Hermes Runtime。', phase, logs });
    logs.push(`using ${runtime.source} runtime ${runtime.version}: ${runtime.runtimeDir}`);
    phase = 'write-config';
    await ensureHermesBaseConfig(logs);
    const moduleSync = { skipped: true, reason: 'Frakio Work does not mutate user Hermes skills or config during startup.' };

    phase = 'start-runtime';
    await startHermesAgentApi(logs);

    phase = 'detect';
    const bootstrap = await discoverHermesBootstrap();
    res.json({ ok: true, phase, logs: tailInstallLogs(logs), bootstrap, moduleSync, runtime: await hermesRuntimeStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(500).json({ error: error.message || 'Hermes bootstrap install failed.', phase, logs: tailInstallLogs(logs) });
  }
});

app.post('/api/hermes-bootstrap/start', async (_req, res) => {
  const logs = [];
  try {
    await startHermesAgentApi(logs);
    const bootstrap = await discoverHermesBootstrap();
    res.json({ ok: bootstrap.api.online, logs, bootstrap });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(500).json({ error: error.message || 'Hermes bootstrap start failed.', logs });
  }
});

app.post('/api/hermes-bootstrap/import', async (_req, res) => {
  try {
    const state = await readState();
    const moduleSync = { skipped: true, reason: 'Profile import is read-only for user Hermes configuration.' };
    const result = await syncHermesProfilesToState(state);
    await writeState(result.state);
    res.json({
      importedProfiles: result.importedProfiles,
      agents: result.state.agents,
      hermesAgent: result.state.integrations.hermesAgent,
      bootstrap: result.bootstrap,
      moduleSync,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes profile import failed.' });
  }
});

app.get('/api/app-update/status', async (req, res) => {
  res.json(await appUpdateStatus({
    currentVersion: await readFrakioPackageVersion(),
    force: String(req.query.refresh || '') === '1',
    packaged: process.env.FRAKIO_WORK_PACKAGED === '1',
    platform: process.platform,
    arch: process.arch,
  }));
});

app.get('/api/updates/status', async (_req, res) => {
  try {
    res.json(await updatesStatus());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Update status failed.' });
  }
});

app.post('/api/updates/check', async (_req, res) => {
  const logs = [];
  let phase = 'fetch-remote';
  try {
    const status = await updatesStatus();
    if (status.hermesAgent.isGitRepo) await fetchUpdateStatus('hermes-agent', logs).catch((error) => logs.push(`Hermes Agent: ${error.message || error}`));
    phase = 'status';
    res.json({ ok: true, target: 'all', phase, logs: tailInstallLogs(logs), status: await updatesStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(error.status || 500).json({ error: error.message || 'Update check failed.', target: 'all', phase, logs: tailInstallLogs(logs), status: await updatesStatus().catch(() => null) });
  }
});

app.post('/api/updates/hermes-agent', async (_req, res) => {
  const target = 'hermes-agent';
  const logs = [];
  let phase = 'fetch-remote';
  let rollbackPoint = null;
  try {
    let status = await updatesStatus();
    if (!status.hermesAgent?.isGitRepo) {
      const error = new Error(status.hermesAgent?.blockedReason || 'Hermes Agent 不是 git checkout，无法自动更新。');
      error.status = 409;
      throw error;
    }
    if (status.hermesAgent.installKind !== 'managed') {
      const error = new Error('当前 Hermes Agent 不是 Frakio Work 管理的官方 checkout。请先接管后再自动恢复和更新。');
      error.status = 409;
      throw error;
    }
    phase = 'backup';
    rollbackPoint = await createHermesRollbackPoint('update', logs);
    if (status.hermesAgent.dirtyFiles?.length) {
      phase = 'restore-clean';
      await cleanHermesCheckout(logs);
    }
    phase = 'fetch-remote';
    await fetchUpdateStatus(target, logs);
    status = await updatesStatus();
    if (!status.hermesAgent.updateAvailable) {
      await updateHermesRollbackPoint(rollbackPoint, { status: 'ready', note: 'created before update check; no update was available' });
      const error = new Error('当前已经是最新版本。');
      error.status = 409;
      throw error;
    }
    if (!status.hermesAgent.canFastForward) {
      const error = new Error(status.hermesAgent.blockedReason || '远端更新不能 fast-forward，需要手动处理分支差异。');
      error.status = 409;
      throw error;
    }

    phase = 'pull';
    await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'pull', '--ff-only'], {
      timeout: 180000,
      errorMessage: 'Hermes Agent 更新失败。',
    }, logs);

    phase = 'setup-runtime';
    await runOfficialHermesSetup(logs);

    phase = 'verify-cli';
    await verifyHermesCli(logs);

    phase = 'write-config';
    await ensureHermesBaseConfig(logs);

    phase = 'restart-runtime';
    await startHermesAgentApi(logs);
    const bootstrap = await discoverHermesBootstrap();
    status = await updatesStatus();
    const afterInfo = await readHermesAgentPackageInfo();
    const afterStatus = status.hermesAgent;
    if (rollbackPoint) {
      rollbackPoint = await updateHermesRollbackPoint(rollbackPoint, {
        status: 'ready',
        after: {
          commit: afterStatus.currentCommit || '',
          branch: afterStatus.currentBranch || '',
          tagDescription: afterStatus.currentTagDescription || '',
          version: afterInfo.version,
          releaseDate: afterInfo.releaseDate,
          displayVersion: versionLabel(afterInfo),
        },
      });
    }
    captureTelemetry('feature_used', { feature: 'update_completed', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ ok: true, target, phase, logs: tailInstallLogs(logs), status: await updatesStatus(), backup: rollbackPoint, bootstrap, runtime: await hermesRuntimeStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(error.status || 500).json({ error: error.message || 'Hermes Agent update failed.', target, phase, logs: tailInstallLogs(logs), status: await updatesStatus().catch(() => null) });
  }
});

app.post('/api/updates/hermes-agent/backup', async (req, res) => {
  const logs = [];
  try {
    const reason = String(req.body?.reason || 'manual');
    const backup = await createHermesRollbackPoint(reason, logs);
    captureTelemetry('feature_used', { feature: 'backup_created', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ ok: true, target: 'hermes-agent', phase: 'backup', logs: tailInstallLogs(logs), backup, status: await updatesStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(500).json({ error: error.message || 'Hermes Agent backup failed.', target: 'hermes-agent', phase: 'backup', logs: tailInstallLogs(logs), status: await updatesStatus().catch(() => null) });
  }
});

app.post('/api/updates/hermes-agent/backups/:id/rollback', async (req, res) => {
  const logs = [];
  let phase = 'backup-current';
  try {
    const backup = await readHermesBackup(req.params.id);
    if (!backup) {
      const error = new Error('找不到这个回滚点。');
      error.status = 404;
      throw error;
    }
    const status = await updatesStatus();
    if (!status.hermesAgent?.isGitRepo || status.hermesAgent.installKind !== 'managed') {
      const error = new Error('当前 Hermes Agent 不是 Frakio Work 管理的官方 checkout，无法自动回滚。');
      error.status = 409;
      throw error;
    }
    const currentBackup = await createHermesRollbackPoint('pre-rollback', logs, { after: backup.before || null });
    if (status.hermesAgent.dirtyFiles?.length) await cleanHermesCheckout(logs);

    phase = 'checkout-version';
    const targetCommit = backup.before?.commit || '';
    if (!targetCommit) {
      const error = new Error('回滚点缺少更新前 commit。');
      error.status = 409;
      throw error;
    }
    await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'fetch', 'origin', '--tags', '--prune'], {
      timeout: 180000,
      errorMessage: '刷新 Hermes Agent 远端信息失败。',
    }, logs);
    await requireLoggedCommand('git', ['-C', hermesAgentSourcePath, 'checkout', targetCommit], {
      timeout: 120000,
      errorMessage: '切换 Hermes Agent 版本失败。',
    }, logs);
    await cleanHermesCheckout(logs);

    phase = 'restore-config';
    const restoredConfig = await restoreHermesConfigSnapshot(backup.path, req.body?.scopes || {});
    logs.push(`restored config files: ${restoredConfig.length}`);

    phase = 'setup-runtime';
    await runOfficialHermesSetup(logs);
    phase = 'verify-cli';
    await verifyHermesCli(logs);
    phase = 'restart-runtime';
    await startHermesAgentApi(logs);
    const bootstrap = await discoverHermesBootstrap();
    captureTelemetry('feature_used', { feature: 'rollback_completed', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ ok: true, target: 'hermes-agent', phase, logs: tailInstallLogs(logs), backup, currentBackup, restoredConfig, status: await updatesStatus(), bootstrap, runtime: await hermesRuntimeStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(error.status || 500).json({ error: error.message || 'Hermes Agent rollback failed.', target: 'hermes-agent', phase, logs: tailInstallLogs(logs), status: await updatesStatus().catch(() => null) });
  }
});

app.delete('/api/updates/hermes-agent/backups/:id', async (req, res) => {
  try {
    const backup = await readHermesBackup(req.params.id);
    if (!backup) return res.status(404).json({ error: '找不到这个备份。', status: await updatesStatus() });
    await rm(backup.path, { recursive: true, force: true });
    res.json({ ok: true, target: 'hermes-agent', phase: 'delete-backup', deleted: backup.id, status: await updatesStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Delete backup failed.', status: await updatesStatus().catch(() => null) });
  }
});

app.post('/api/updates/hermes-agent/backups/cleanup', async (req, res) => {
  try {
    const mode = req.body?.mode === 'older-than-30-days' ? 'older-than-30-days' : 'keep-latest-10';
    const backups = await listHermesBackups();
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const targets = mode === 'older-than-30-days'
      ? backups.filter((backup) => new Date(backup.createdAt || 0).getTime() < cutoff)
      : backups.slice(10);
    for (const backup of targets) await rm(backup.path, { recursive: true, force: true });
    res.json({ ok: true, target: 'hermes-agent', phase: 'cleanup-backups', mode, deleted: targets.map((backup) => backup.id), status: await updatesStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Cleanup backups failed.', status: await updatesStatus().catch(() => null) });
  }
});

app.post('/api/updates/frakio-work', async (_req, res) => {
  const status = await appUpdateStatus({ currentVersion: await readFrakioPackageVersion(), force: true, packaged: process.env.FRAKIO_WORK_PACKAGED === '1' });
  res.status(410).json({
    error: '已停用在安装目录执行 git pull 的更新方式，请从 GitHub Releases 下载新版。',
    target: 'frakio-work',
    phase: 'release-download',
    releaseUrl: status.releaseUrl,
    asset: status.asset,
  });
});

app.get('/api/hermes-runtime/status', async (_req, res) => {
  try {
    res.json(await hermesRuntimeStatus());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes runtime status failed.' });
  }
});

app.post('/api/hermes-runtime/check-update', async (_req, res) => {
  try {
    res.json({ ok: true, manager: await runtimeManagerStatus({ refreshOfficial: true }), runtime: await hermesRuntimeStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes Runtime update check failed.' });
  }
});

app.post('/api/hermes-runtime/install', async (req, res) => {
  const logs = [];
  let phase = 'check-release';
  try {
    phase = 'install-runtime';
    const installed = await installManagedHermesRuntime({ tag: req.body?.tag }, logs);
    res.json({ ok: true, phase, installed, logs: tailInstallLogs(logs), manager: await runtimeManagerStatus(), runtime: await hermesRuntimeStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(error.status || 500).json({ error: error.message || 'Hermes Runtime install failed.', phase, logs: tailInstallLogs(logs), manager: await runtimeManagerStatus().catch(() => null) });
  }
});

app.post('/api/hermes-runtime/activate', async (req, res) => {
  const logs = [];
  try {
    const active = await activateManagedHermesRuntime(req.body?.version, logs);
    res.json({ ok: true, active, logs: tailInstallLogs(logs), manager: await runtimeManagerStatus(), runtime: await hermesRuntimeStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(error.status || 500).json({ error: error.message || 'Hermes Runtime activation failed.', logs: tailInstallLogs(logs), manager: await runtimeManagerStatus().catch(() => null), runtime: await hermesRuntimeStatus().catch(() => null) });
  }
});

app.post('/api/hermes-runtime/use-bundled', async (_req, res) => {
  const logs = [];
  try {
    const active = await activateBundledHermesRuntime(logs);
    res.json({ ok: true, active, logs: tailInstallLogs(logs), manager: await runtimeManagerStatus(), runtime: await hermesRuntimeStatus() });
  } catch (error) {
    logs.push(String(error?.message || error));
    res.status(500).json({ error: error.message || 'Bundled Hermes Runtime activation failed.', logs: tailInstallLogs(logs), runtime: await hermesRuntimeStatus().catch(() => null) });
  }
});

app.delete('/api/hermes-runtime/versions/:version', async (req, res) => {
  try {
    const version = String(req.params.version || '').trim();
    const registry = readRuntimeRegistrySync();
    if (registry.activeVersion === version) return res.status(409).json({ error: '正在使用的 Runtime 不能删除，请先切换到内置 Runtime。' });
    const runtimeDir = path.join(frakioManagedHermesRuntimeRoot, version, hermesRuntimePlatformDir());
    if (!isInside(frakioManagedHermesRuntimeRoot, runtimeDir)) return res.status(403).json({ error: 'Runtime 路径无效。' });
    if (!(await exists(runtimeDir))) return res.status(404).json({ error: 'Runtime 不存在。' });
    await rm(path.join(frakioManagedHermesRuntimeRoot, version), { recursive: true, force: true });
    await writeRuntimeRegistry({ ...registry, runtimes: registry.runtimes.filter((item) => item?.version !== version), previousVersion: registry.previousVersion === version ? '' : registry.previousVersion });
    res.json({ ok: true, deleted: version, manager: await runtimeManagerStatus(), runtime: await hermesRuntimeStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes Runtime delete failed.' });
  }
});

app.get('/api/hermes-runtime/diagnostics', async (_req, res) => {
  try {
    res.json(await hermesRuntimeDiagnostics());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes runtime diagnostics failed.' });
  }
});

app.post('/api/hermes-runtime/start', async (_req, res) => {
  try {
    const autoStart = await ensureHermesRuntimeReady({ force: true });
    res.json({ ok: autoStart.status === 'ready', autoStart, runtime: await hermesRuntimeStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes Runtime start failed.', runtime: await hermesRuntimeStatus().catch(() => null) });
  }
});

app.post('/api/hermes-runtime/profiles/:name/gateway/start', async (req, res) => {
  try {
    const gateway = await startProfileGateway(req.params.name || 'default');
    captureTelemetry('feature_used', { feature: 'channel_connected', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ ok: true, gateway, runtime: await hermesRuntimeStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes profile gateway start failed.' });
  }
});

app.patch('/api/hermes-runtime/profiles/:name/model', async (req, res) => {
  try {
    const state = await readState();
    const modelValue = String(req.body?.modelId || req.body?.modelValue || '').trim();
    if (!modelValue) return res.status(400).json({ error: '模型不能为空。' });
    const profileName = req.params.name || 'default';
    const updated = await updateHermesProfileDefaultModel(profileName, modelValue, state.models || []);
    const { selectedModel, selectedName } = resolveModelSelection(modelValue, state.models || []);
    const agentModel = selectedModel?.name || selectedName || modelValue;
    for (const agent of state.agents || []) {
      if (agent.profileName === profileName || agent.id === slug(profileName) || (profileName === 'default' && agent.id === 'hermes-default')) agent.model = agentModel;
    }
    const synced = await syncHermesProfilesToState(state);
    await writeState(synced.state);
    const profile = synced.bootstrap.profiles.find((item) => item.name === profileName) || null;
    const agent = synced.state.agents.find((item) => item.profileName === profileName || item.id === slug(profileName)) || null;
    res.json({
      ok: true,
      updated,
      profile,
      agent,
      agents: synced.state.agents,
      models: synced.state.models.map(publicModel),
      bootstrap: synced.bootstrap,
      runtime: await hermesRuntimeStatus(),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes Profile 模型更新失败。' });
  }
});

app.post('/api/hermes-bootstrap/sync-modules', async (_req, res) => {
  try {
    const moduleSync = await syncBundledSkillsDisabled();
    const state = await readState();
    const result = await syncHermesProfilesToState(state);
    await writeState(result.state);
    res.json({
      ok: true,
      moduleSync,
      importedProfiles: result.importedProfiles,
      agents: result.state.agents,
      hermesAgent: result.state.integrations.hermesAgent,
      bootstrap: result.bootstrap,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes module sync failed.' });
  }
});

app.patch('/api/hermes-bootstrap/approvals', async (req, res) => {
  try {
    const state = await readState();
    const profileName = String(req.body?.profileName || state.integrations.hermesAgent?.selectedProfile || 'default');
    const mode = String(req.body?.mode || '');
    const approval = await writeApprovalMode(profileName, mode);
    state.integrations.hermesAgent = {
      ...(state.integrations.hermesAgent || {}),
      selectedProfile: profileName,
      approvalMode: approval.mode,
      lastCheckedAt: now(),
    };
    await writeState(state);
    res.json({ approval, hermesAgent: state.integrations.hermesAgent });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Approval mode update failed.' });
  }
});

app.get('/api/hermes/config', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const config = await readYamlFile(profileConfigPath(profile));
    const envValues = await readEnvValues(profileEnvPath(profile));
    const platformConfig = readPlatformEnvAsConfig(envValues);
    const proxy = readProxyEnvAsConfig(envValues);
    const gatewayAutoStart = await readGatewayAutoStartConfig();
    const mergedPlatforms = { ...(config.platforms || {}) };
    for (const [platform, values] of Object.entries(platformConfig)) {
      mergedPlatforms[platform] = deepMerge(mergedPlatforms[platform] || {}, values);
    }
    const body = { ...config, platforms: mergedPlatforms, proxy, gatewayAutoStart };
    const sections = String(req.query?.sections || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (sections.length) {
      return res.json(Object.fromEntries(sections.map((section) => [section, hermesPlatformSections.has(section) ? body.platforms?.[section] || {} : body[section] || {}])));
    }
    res.json(body);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes config read failed.' });
  }
});

app.put('/api/hermes/config', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const section = String(req.body?.section || '').trim();
    const values = req.body?.values && typeof req.body.values === 'object' && !Array.isArray(req.body.values) ? req.body.values : null;
    if (!section || !values) return res.status(400).json({ error: 'section and values are required.' });
    if (section === 'proxy') {
      await writeEnvValues(profileEnvPath(profile), Object.fromEntries(hermesProxyEnvKeys.map((key) => [key, values[key] || ''])));
      return res.json({ success: true });
    }
    if (section === 'gatewayAutoStart') {
      const gatewayAutoStart = await writeGatewayAutoStartConfig(values);
      return res.json({ success: true, gatewayAutoStart });
    }
    if (!hermesConfigSections.has(section)) return res.status(400).json({ error: `Unsupported Hermes config section: ${section}` });
    const config = await updateProfileYaml(profile, (current) => {
      if (hermesPlatformSections.has(section)) {
        current.platforms = current.platforms || {};
        current.platforms[section] = deepMerge(current.platforms[section] || {}, values);
      } else {
        current[section] = deepMerge(current[section] || {}, values);
      }
      return current;
    });
    const gateway = hermesPlatformSections.has(section) ? await startProfileGateway(profile) : null;
    res.json({ success: true, [section]: hermesPlatformSections.has(section) ? config.platforms?.[section] || {} : config[section] || {}, gateway });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes config update failed.' });
  }
});

app.get('/api/hermes/config/auxiliary-models', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const config = await readYamlFile(profileConfigPath(profile));
    const auxiliary = isPlainRecord(config.auxiliary) ? config.auxiliary : {};
    res.json({
      tasks: auxiliaryModelTasks,
      auxiliary: Object.fromEntries(auxiliaryModelTasks.map((task) => [task.key, publicAuxiliarySettings(auxiliary[task.key], task)])),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || '辅助模型配置读取失败。' });
  }
});

app.put('/api/hermes/config/auxiliary-models', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const state = await readState();
    const input = req.body?.auxiliary;
    if (!isPlainRecord(input)) return res.status(400).json({ error: 'auxiliary 配置不能为空。' });
    const updates = {};
    for (const [taskKey, value] of Object.entries(input)) {
      const task = auxiliaryModelTaskByKey.get(taskKey);
      if (!task) continue;
      updates[taskKey] = normalizeAuxiliaryUpdate(value, task);
    }
    for (const settings of Object.values(updates)) {
      if (['auto', 'main'].includes(settings.provider)) continue;
      const configuredModels = normalizeModels(state.models || []);
      let selectedModel = configuredModels.find((model) => model.providerKey === settings.provider && normalizeModelNames(model.models, model.model).includes(settings.model));
      if (!selectedModel) {
        const preset = providerPresetByKey(settings.provider);
        if (preset && (preset.models.includes(settings.model) || !preset.models.length)) {
          selectedModel = normalizeModels([{
            id: `preset-${preset.value}`,
            name: preset.label,
            provider: preset.label,
            providerKey: preset.value,
            model: settings.model,
            models: preset.models.length ? preset.models : [settings.model],
            baseUrl: preset.baseUrl,
            apiMode: preset.apiMode,
            source: 'manual',
          }])[0];
        }
      }
      if (!selectedModel) throw configValidationError(`找不到 Provider「${settings.provider}」下的模型「${settings.model}」。`);
      await ensureModelProviderForProfile(profile, selectedModel, settings.model, state.models || [], { setDefault: false });
    }
    const config = await updateProfileYaml(profile, (current) => {
      const auxiliary = isPlainRecord(current.auxiliary) ? { ...current.auxiliary } : {};
      for (const [taskKey, settings] of Object.entries(updates)) {
        const previous = isPlainRecord(auxiliary[taskKey]) ? { ...auxiliary[taskKey] } : {};
        for (const field of auxiliaryEditableFields) delete previous[field];
        auxiliary[taskKey] = { ...previous, ...settings };
      }
      current.auxiliary = auxiliary;
      return current;
    });
    const auxiliary = isPlainRecord(config.auxiliary) ? config.auxiliary : {};
    res.json({
      success: true,
      auxiliary: Object.fromEntries(auxiliaryModelTasks.map((task) => [task.key, publicAuxiliarySettings(auxiliary[task.key], task)])),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '辅助模型配置保存失败。' });
  }
});

app.get('/api/hermes/config/moa', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const config = await readYamlFile(profileConfigPath(profile));
    res.json(normalizeMoaConfig(config.moa));
  } catch (error) {
    res.status(500).json({ error: error.message || '组合模型配置读取失败。' });
  }
});

app.put('/api/hermes/config/moa', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    if (!isPlainRecord(req.body?.moa)) return res.status(400).json({ error: 'moa 配置不能为空。' });
    const normalized = normalizeMoaConfig(req.body.moa, true);
    const config = await updateProfileYaml(profile, (current) => {
      const previous = isPlainRecord(current.moa) ? current.moa : {};
      current.moa = {
        ...previous,
        default_preset: normalized.default_preset,
        active_preset: normalized.active_preset,
        save_traces: normalized.save_traces,
        trace_dir: normalized.trace_dir,
        presets: Object.fromEntries(Object.entries(normalized.presets).map(([name, preset]) => [name, {
          ...(isPlainRecord(previous.presets?.[name]) ? previous.presets[name] : {}),
          ...preset,
        }])),
      };
      return current;
    });
    res.json({ success: true, moa: normalizeMoaConfig(config.moa) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '组合模型配置保存失败。' });
  }
});

app.put('/api/hermes/config/credentials', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const platform = String(req.body?.platform || '').trim();
    const values = req.body?.values && typeof req.body.values === 'object' && !Array.isArray(req.body.values) ? req.body.values : null;
    const envMap = hermesPlatformEnvByPlatform[platform];
    if (!platform || !values || !envMap) return res.status(400).json({ error: 'valid platform and values are required.' });
    const flatValues = {};
    for (const [key, value] of Object.entries(values)) {
      if (key === 'extra' && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [subKey, subValue] of Object.entries(value)) flatValues[`extra.${subKey}`] = subValue;
      } else {
        flatValues[key] = value;
      }
    }
    const envUpdates = {};
    await updateProfileYaml(profile, (current) => {
      current.platforms = current.platforms || {};
      current.platforms[platform] = current.platforms[platform] || {};
      for (const [keyPath, value] of Object.entries(flatValues)) {
        const envKey = envMap[keyPath];
        if (!envKey) continue;
        envUpdates[envKey] = value;
        removeNestedValue(current.platforms[platform], keyPath);
      }
      if (Object.keys(current.platforms[platform] || {}).length === 0) delete current.platforms[platform];
      if (Object.keys(current.platforms || {}).length === 0) delete current.platforms;
      return current;
    });
    await writeEnvValues(profileEnvPath(profile), envUpdates);
    const gateway = await startProfileGateway(profile);
    res.json({ success: true, gateway });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes credentials update failed.' });
  }
});

app.get('/api/hermes/weixin/qrcode', async (req, res) => {
  try {
    const url = new URL('/ilink/bot/get_bot_qrcode', weixinIlinkBase);
    url.searchParams.set('bot_type', '3');
    const response = await fetchExternalJson(url, { timeoutMs: 15000 });
    if (!response.ok) return res.status(response.status || 502).json({ error: response.body?.error || 'Failed to get Weixin QR code.' });
    const data = response.body || {};
    if (!data.qrcode) return res.status(502).json({ error: 'Failed to get Weixin QR code.' });
    res.json({ qrcode: data.qrcode, qrcode_url: data.qrcode_img_content || data.qrcode_url || '' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to connect to Weixin iLink API.' });
  }
});

app.get('/api/hermes/weixin/qrcode/status', async (req, res) => {
  const qrcode = String(req.query?.qrcode || '').trim();
  if (!qrcode) return res.status(400).json({ error: 'Missing qrcode parameter.' });
  try {
    const url = new URL('/ilink/bot/get_qrcode_status', weixinIlinkBase);
    url.searchParams.set('qrcode', qrcode);
    const response = await fetchExternalJson(url, { timeoutMs: 35000 });
    if (!response.ok) return res.status(response.status || 502).json({ error: response.body?.error || 'Failed to poll Weixin QR status.' });
    const data = response.body || {};
    const status = data.status || 'wait';
    if (status === 'confirmed') {
      return res.json({ status, account_id: data.ilink_bot_id, token: data.bot_token, base_url: data.baseurl });
    }
    res.json({ status });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to poll Weixin QR status.' });
  }
});

app.post('/api/hermes/weixin/save', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const accountId = String(req.body?.account_id || '').trim();
    const token = String(req.body?.token || '').trim();
    const baseUrl = String(req.body?.base_url || '').trim();
    if (!accountId || !token) return res.status(400).json({ error: 'Missing account_id or token.' });
    const entries = { WEIXIN_ACCOUNT_ID: accountId, WEIXIN_TOKEN: token };
    if (baseUrl) entries.WEIXIN_BASE_URL = baseUrl;
    await updateProfileYaml(profile, (current) => {
      if (current.platforms?.weixin) {
        removeNestedValue(current.platforms.weixin, 'token');
        removeNestedValue(current.platforms.weixin, 'extra.account_id');
        removeNestedValue(current.platforms.weixin, 'extra.base_url');
        if (Object.keys(current.platforms.weixin || {}).length === 0) delete current.platforms.weixin;
        if (Object.keys(current.platforms || {}).length === 0) delete current.platforms;
      }
      return current;
    });
    await writeEnvValues(profileEnvPath(profile), entries);
    const gateway = await startProfileGateway(profile);
    captureTelemetry('feature_used', { feature: 'channel_connected', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ success: true, gateway });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes Weixin credentials save failed.' });
  }
});

app.get('/api/hermes/mcp/servers', async (req, res) => {
  try {
    res.json(await readMcpConfig(requestedHermesProfile(req, 'default')));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'MCP servers read failed.' });
  }
});

app.post('/api/hermes/mcp/servers', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const name = sanitizeMcpServerName(req.body?.name);
    const serverConfig = normalizeMcpServerConfig(req.body || {});
    const payload = await updateMcpServers(profile, (servers) => {
      if (servers[name]) throw Object.assign(new Error('这个 MCP Server 已存在。'), { status: 409 });
      return { ...servers, [name]: serverConfig };
    });
    res.json(payload);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'MCP server create failed.' });
  }
});

app.patch('/api/hermes/mcp/servers/:name', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const name = sanitizeMcpServerName(req.params.name);
    const payload = await updateMcpServers(profile, (servers) => {
      if (!servers[name]) throw Object.assign(new Error('未找到这个 MCP Server。'), { status: 404 });
      const current = servers[name] || {};
      const next = req.body?.config ? preserveMaskedMcpSecrets(current, normalizeMcpServerConfig(req.body.config)) : { ...current };
      if ('enabled' in (req.body || {})) next.enabled = Boolean(req.body.enabled);
      for (const key of ['timeout', 'connect_timeout', 'supports_parallel_tool_calls', 'tools']) {
        if (key in (req.body || {})) next[key] = req.body[key];
      }
      return { ...servers, [name]: next };
    });
    res.json(payload);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'MCP server update failed.' });
  }
});

app.delete('/api/hermes/mcp/servers/:name', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const name = sanitizeMcpServerName(req.params.name);
    const payload = await updateMcpServers(profile, (servers) => {
      if (!servers[name]) throw Object.assign(new Error('未找到这个 MCP Server。'), { status: 404 });
      const next = { ...servers };
      delete next[name];
      return next;
    });
    res.json(payload);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'MCP server delete failed.' });
  }
});

app.post('/api/hermes/mcp/servers/:name/test', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const name = sanitizeMcpServerName(req.params.name);
    const config = await readYamlFile(mcpConfigPathForProfile(profile));
    const serverConfig = config?.mcp_servers?.[name];
    if (!serverConfig) return res.status(404).json({ error: '未找到这个 MCP Server。' });
    if (isWorkbenchMcpServer(name, serverConfig)) {
      try {
        const tools = await probeStdioMcpTools(serverConfig);
        return res.json({ ok: true, server: publicMcpServer(name, serverConfig, { tools, status: 'connected' }), tools, output: `Frakio Work MCP connected · ${tools.length} tools` });
      } catch (error) {
        const output = String(error?.message || error);
        const tools = knownManagedMcpTools(name, serverConfig);
        return res.status(500).json({ ok: false, error: output, server: publicMcpServer(name, serverConfig, { tools, status: 'failed', error: output }), output });
      }
    }
    const hermesBin = await resolveHermesExecutable();
    if (!hermesBin) return res.status(500).json({ error: '未找到 Hermes CLI。' });
    try {
      const { stdout, stderr } = await execFileAsync(hermesBin, ['mcp', 'test', name], {
        cwd: profileConfigDir(profile),
        env: runtimeEnv({ HERMES_HOME: profileConfigDir(profile) }),
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      const parsedTools = parseHermesMcpTestTools(output);
      const tools = parsedTools.length ? parsedTools : knownManagedMcpTools(name, serverConfig);
      res.json({ ok: true, server: publicMcpServer(name, serverConfig, { tools, status: 'connected' }), tools, output });
    } catch (error) {
      const output = String(`${error.stdout || ''}\n${error.stderr || ''}`.trim() || error.message || error);
      const tools = knownManagedMcpTools(name, serverConfig);
      res.status(500).json({ ok: false, error: output, server: publicMcpServer(name, serverConfig, { tools, status: 'failed', error: output }), output });
    }
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'MCP server test failed.' });
  }
});

app.post('/api/hermes/mcp/workbench/install', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const payload = await updateMcpServers(profile, (servers) => ({
      ...servers,
      'hermes-workbench-api': workbenchMcpServerConfig('api', profile),
      'hermes-workbench-use': workbenchMcpServerConfig('use', profile),
    }));
    res.json(payload);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Frakio Work 内置 MCP 安装失败。' });
  }
});

app.post('/api/hermes/mcp/reload', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const server = String(req.query?.server || req.body?.server || '').trim();
    let bridge = await probeHermesBridge({ timeoutMs: 1000 });
    if (bridge.ready) {
      const message = server ? `/reload-mcp ${server}` : '/reload-mcp';
      await requestHermesBridge({ action: 'chat', session_id: `mcp-reload-${profile}`, profile, message, source: 'frakio-workbench' }, { timeoutMs: 30000, retryMs: 1000 });
      return res.json({ ok: true, profile, server, runtime: await readMcpConfig(profile) });
    }
    res.json({ ok: false, profile, server, error: hermesBridgeLastError || '本机 Hermes Bridge 未连接，配置已保存，下一次 Hermes 会话启动或手动 reload 后生效。', runtime: await readMcpConfig(profile) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'MCP reload failed.' });
  }
});

app.get('/api/hermes/jobs', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const jobsPath = path.join(profileConfigDir(profile), 'cron', 'jobs.json');
    const parsed = await readJsonFile(jobsPath);
    const rawJobs = Array.isArray(parsed) ? parsed : Array.isArray(parsed.jobs) ? parsed.jobs : [];
    const includeDisabled = String(req.query?.include_disabled || '').toLowerCase() === 'true';
    const jobs = rawJobs.map(normalizeJob).filter((job) => includeDisabled || job.enabled !== false);
    res.json({ jobs });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Hermes jobs read failed.' });
  }
});

app.post('/api/hermes/jobs', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const schedule = String(req.body?.schedule || '').trim();
    const prompt = String(req.body?.prompt || '').trim();
    if (!schedule) return res.status(400).json({ error: 'schedule is required.' });
    const before = await readJsonFile(path.join(profileConfigDir(profile), 'cron', 'jobs.json'));
    const beforeIds = new Set((Array.isArray(before) ? before : before.jobs || []).map((job) => job.job_id || job.id));
    const args = ['cron', 'create', '--profile', profile];
    if (req.body?.name) args.push('--name', String(req.body.name));
    if (req.body?.deliver) args.push('--deliver', String(req.body.deliver));
    if (req.body?.repeat !== undefined && req.body.repeat !== null && req.body.repeat !== '') args.push('--repeat', String(req.body.repeat));
    for (const skill of Array.isArray(req.body?.skills) ? req.body.skills : []) args.push('--skill', String(skill));
    args.push(schedule);
    if (prompt) args.push(prompt);
    await runHermesCommand(args, { profile });
    const after = await readJsonFile(path.join(profileConfigDir(profile), 'cron', 'jobs.json'));
    const jobs = (Array.isArray(after) ? after : after.jobs || []).map(normalizeJob);
    const job = jobs.find((item) => !beforeIds.has(item.job_id || item.id)) || jobs[0] || null;
    res.json({ job });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes job create failed.' });
  }
});

app.patch('/api/hermes/jobs/:id', async (req, res) => {
  try {
    const profile = requestedHermesProfile(req, 'default');
    const args = ['cron', 'edit', '--profile', profile, req.params.id];
    if (req.body?.schedule !== undefined) args.push('--schedule', String(req.body.schedule));
    if (req.body?.prompt !== undefined) args.push('--prompt', String(req.body.prompt));
    if (req.body?.name !== undefined) args.push('--name', String(req.body.name));
    if (req.body?.deliver !== undefined) args.push('--deliver', String(req.body.deliver));
    if (req.body?.repeat !== undefined) args.push('--repeat', req.body.repeat === null || req.body.repeat === '' ? '0' : String(req.body.repeat));
    if (Array.isArray(req.body?.skills)) {
      if (!req.body.skills.length) args.push('--clear-skills');
      for (const skill of req.body.skills) args.push('--skill', String(skill));
    }
    await runHermesCommand(args, { profile });
    const parsed = await readJsonFile(path.join(profileConfigDir(profile), 'cron', 'jobs.json'));
    const jobs = (Array.isArray(parsed) ? parsed : parsed.jobs || []).map(normalizeJob);
    const job = jobs.find((item) => item.job_id === req.params.id || item.id === req.params.id);
    res.json({ job });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes job update failed.' });
  }
});

for (const [routeAction, cliAction] of [['delete', 'remove'], ['pause', 'pause'], ['resume', 'resume'], ['run', 'run']]) {
  const method = routeAction === 'delete' ? 'delete' : 'post';
  const route = routeAction === 'delete' ? '/api/hermes/jobs/:id' : `/api/hermes/jobs/:id/${routeAction}`;
  app[method](route, async (req, res) => {
    try {
      const profile = requestedHermesProfile(req, 'default');
      await runHermesCommand(['cron', cliAction, '--profile', profile, req.params.id], { profile });
      if (routeAction === 'delete') return res.json({ ok: true });
      const parsed = await readJsonFile(path.join(profileConfigDir(profile), 'cron', 'jobs.json'));
      const jobs = (Array.isArray(parsed) ? parsed : parsed.jobs || []).map(normalizeJob);
      const job = jobs.find((item) => item.job_id === req.params.id || item.id === req.params.id);
      res.json({ job });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || `Hermes job ${routeAction} failed.` });
    }
  });
}

app.get('/api/hermes/kanban/boards', async (req, res) => {
  try {
    const args = ['kanban', 'boards', 'list', '--json'];
    if (String(req.query?.includeArchived || '').toLowerCase() === 'true') args.push('--all');
    const { stdout } = await runHermesCommand(args);
    res.json({ boards: JSON.parse(stdout || '[]') });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban boards read failed.' });
  }
});

app.post('/api/hermes/kanban/boards', async (req, res) => {
  try {
    const board = kanbanBoard(req.body?.slug);
    const args = ['kanban', 'boards', 'create', board];
    if (req.body?.name) args.push('--name', String(req.body.name));
    if (req.body?.description) args.push('--description', String(req.body.description));
    if (req.body?.icon) args.push('--icon', String(req.body.icon));
    if (req.body?.color) args.push('--color', String(req.body.color));
    await runHermesCommand(args);
    res.json({ ok: true, board });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban board create failed.' });
  }
});

app.get('/api/hermes/kanban/tasks', async (req, res) => {
  try {
    const board = kanbanBoard(req.query?.board || 'default');
    const args = ['kanban', '--board', board, 'list', '--json'];
    if (req.query?.status) args.push('--status', String(req.query.status));
    if (req.query?.assignee) args.push('--assignee', String(req.query.assignee));
    if (String(req.query?.includeArchived || '').toLowerCase() === 'true') args.push('--archived');
    const { stdout } = await runHermesCommand(args);
    res.json({ tasks: JSON.parse(stdout || '[]') });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban tasks read failed.' });
  }
});

app.post('/api/hermes/kanban/tasks', async (req, res) => {
  try {
    const board = kanbanBoard(req.body?.board || req.query?.board || 'default');
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required.' });
    const args = ['kanban', '--board', board, 'create', title, '--json'];
    if (req.body?.body) args.push('--body', String(req.body.body));
    if (req.body?.assignee) args.push('--assignee', String(req.body.assignee));
    if (req.body?.priority !== undefined) args.push('--priority', String(req.body.priority));
    if (req.body?.tenant) args.push('--tenant', String(req.body.tenant));
    if (req.body?.workspace) args.push('--workspace', String(req.body.workspace));
    if (req.body?.triage) args.push('--triage');
    for (const skill of Array.isArray(req.body?.skills) ? req.body.skills : []) args.push('--skill', String(skill));
    const { stdout } = await runHermesCommand(args);
    res.json({ task: JSON.parse(stdout || '{}') });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban task create failed.' });
  }
});

app.patch('/api/hermes/kanban/tasks/:id', async (req, res) => {
  try {
    const board = kanbanBoard(req.body?.board || req.query?.board || 'default');
    const status = String(req.body?.status || '').trim();
    const assignee = req.body?.assignee;
    if (assignee !== undefined) await runHermesCommand(['kanban', '--board', board, 'assign', req.params.id, String(assignee || 'none')]);
    if (status) {
      if (!kanbanStatuses.has(status)) return res.status(400).json({ error: 'invalid status.' });
      if (status === 'done') await runHermesCommand(['kanban', '--board', board, 'complete', req.params.id, '--summary', String(req.body?.summary || 'Completed from Frakio Work')]);
      else if (status === 'blocked') await runHermesCommand(['kanban', '--board', board, 'block', req.params.id, String(req.body?.reason || 'Blocked from Frakio Work')]);
      else if (status === 'ready') await runHermesCommand(['kanban', '--board', board, 'unblock', req.params.id]);
      else if (status === 'archived') await runHermesCommand(['kanban', '--board', board, 'archive', req.params.id]);
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban task update failed.' });
  }
});

app.get('/api/hermes/kanban/stats', async (req, res) => {
  try {
    const board = kanbanBoard(req.query?.board || 'default');
    const { stdout } = await runHermesCommand(['kanban', '--board', board, 'stats', '--json']);
    res.json({ stats: JSON.parse(stdout || '{}') });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Hermes kanban stats read failed.' });
  }
});

app.get('/api/agents', (_req, res) => {
  readState().then((state) => res.json({ agents: state.agents }));
});

app.get('/api/models', async (_req, res) => {
  const state = await readState();
  res.json({ models: state.models.map(publicModel) });
});

app.get('/api/model-capabilities', async (_req, res) => {
  const state = await readState();
  const providerCatalog = flattenProviderCatalog(modelCatalogCache);
  res.json({
    runtimeVersion: '0.18.2',
    capabilities: capabilitiesForModels(state.models, { providerCatalog }),
    providers: Object.fromEntries(state.models.map((model) => [model.id, catalogStatus(modelCatalogCache, model)])),
  });
});

app.get('/api/model-providers/presets', async (req, res) => {
  const profile = await requestedModelProfile(req);
  const selectablePresets = loadProviderPresets().filter((preset) => preset.selectable);
  const codexPreset = selectablePresets.find((preset) => preset.value === 'openai-codex');
  if (codexPreset && oauthProviderAuthenticated(profile, codexPreset.value) && catalogStatus(modelCatalogCache, oauthCatalogModel(codexPreset.value)).stale) {
    const accessToken = oauthProviderAccessToken(profile, codexPreset.value);
    if (accessToken) await refreshCodexOAuthModels(accessToken).catch(() => {});
  }
  const providers = selectablePresets.map((preset) => {
    const { selectable: _selectable, ...publicPreset } = preset;
    if (!preset.authType) return { ...publicPreset, authenticated: false };
    const state = oauthProviderState(profile, preset.value);
    return { ...publicPreset, models: state.models, authenticated: state.authenticated, catalog: state.catalog };
  });
  res.json({ profile, providers });
});

async function fetchProviderModelsForRequest(body) {
  const apiKey = String(body?.apiKey || body?.api_key || '').trim();
  const provider = {
    providerKey: String(body?.providerKey || '').trim(), apiMode: normalizeApiMode(body?.apiMode),
    baseUrl: String(body?.baseUrl || body?.base_url || '').trim(), modelsUrl: String(body?.modelsUrl || '').trim(),
  };
  const urls = candidateModelUrls(provider);
  if (!urls.length) throw Object.assign(new Error('Base URL 格式不正确。'), { status: 400 });
  let lastError = null;
  for (const url of urls) {
    const result = await fetchJson(url, { method: 'GET', headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, timeoutMs: 9000 });
    if (!result.ok) {
      const providerMessage = typeof result.body?.error?.message === 'string' ? `：${result.body.error.message.slice(0, 180)}` : '';
      lastError = Object.assign(new Error(result.status === 401 || result.status === 403
        ? `API Key 未授权，或供应商拒绝访问模型列表${providerMessage}。`
        : `模型列表获取失败，HTTP ${result.status || 'network'}${providerMessage}。`), { status: result.status || 502 });
      if ([401, 403].includes(result.status)) break;
      continue;
    }
    const parsed = parseCatalogResponse(result.body, provider);
    if (!parsed.ids.length) {
      lastError = Object.assign(new Error('供应商返回了响应，但没有识别到模型 ID。'), { status: 502 });
      continue;
    }
    await updateProviderCatalog(modelCatalogCachePath, modelCatalogCache, provider, parsed);
    return { models: parsed.ids, records: parsed.records, rich: parsed.rich, provider, url };
  }
  await recordCatalogError(modelCatalogCachePath, modelCatalogCache, provider, lastError || '模型目录不可用。');
  throw lastError || Object.assign(new Error('模型列表获取失败。'), { status: 502 });
}

async function refreshStaleProviderCatalogs() {
  const state = await readState();
  const seen = new Set();
  for (const model of state.models) {
    const signature = `${model.providerKey}|${model.apiMode}|${comparableBaseUrl(model.baseUrl)}`;
    if (seen.has(signature) || !model.baseUrl || !catalogStatus(modelCatalogCache, model).stale) continue;
    seen.add(signature);
    const apiKey = await getReusableModelSecret(model, state.models);
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(model.baseUrl);
    if (!apiKey && !local) continue;
    await fetchProviderModelsForRequest({ ...model, apiKey }).catch(() => {});
  }
}

app.post('/api/models/fetch', async (req, res) => {
  try {
    const state = await readState();
    const savedModel = req.body?.modelId ? state.models.find((item) => item.id === req.body.modelId) : null;
    if (req.body?.modelId && !savedModel) return res.status(404).json({ error: '模型不存在。' });
    const requestedBaseUrl = String(req.body?.baseUrl || req.body?.base_url || '').trim();
    const apiKey = savedModel
      ? await credentialForModelDraft(savedModel, requestedBaseUrl, req.body?.apiKey || req.body?.api_key, state.models)
      : String(req.body?.apiKey || req.body?.api_key || '').trim();
    const fetched = await fetchProviderModelsForRequest({ ...req.body, apiKey });
    const models = fetched.models;
    const capabilityModel = normalizeModels([{
      id: 'fetched',
      name: req.body?.provider || req.body?.providerKey || 'Provider',
      provider: req.body?.provider || 'Custom',
      providerKey: req.body?.providerKey || '',
      apiMode: req.body?.apiMode || '',
      baseUrl: req.body?.baseUrl || '',
      model: models[0],
      models,
      capabilityMode: req.body?.capabilityMode,
      capabilityOverrides: req.body?.capabilityOverrides,
    }])[0];
    captureTelemetry('feature_used', { feature: 'model_connected', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({
      models,
      capabilities: Object.fromEntries(models.map((modelName) => [modelName, resolveModelCapability(capabilityModel, modelName, { providerCatalog: flattenProviderCatalog(modelCatalogCache) })])),
      catalog: { source: fetched.rich ? 'provider_catalog' : 'model_ids', rich: fetched.rich, url: fetched.url, ...catalogStatus(modelCatalogCache, fetched.provider) },
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '模型列表获取失败。' });
  }
});

app.post('/api/model-providers/fetch', async (req, res) => {
  try {
    const fetched = await fetchProviderModelsForRequest(req.body);
    const models = fetched.models;
    captureTelemetry('feature_used', { feature: 'model_connected', outcome: 'completed' });
    captureMeaningfulActivity('feature_used');
    res.json({ models, catalog: { source: fetched.rich ? 'provider_catalog' : 'model_ids', rich: fetched.rich, url: fetched.url, ...catalogStatus(modelCatalogCache, fetched.provider) } });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '模型列表获取失败。' });
  }
});

function providerInferenceUrl(model) {
  const base = String(model.baseUrl || '').trim().replace(/\/+$/, '').replace(/\/(chat\/completions|responses|messages)$/i, '');
  if (model.apiMode === 'anthropic_messages') return /\/v1$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`;
  if (model.apiMode === 'codex_responses' || model.apiMode === 'openai_responses') return /\/v1$/i.test(base) ? `${base}/responses` : `${base}/v1/responses`;
  return /\/v1$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

function verificationModelFromRequest(savedModel, body = {}) {
  const configuration = body?.configuration && typeof body.configuration === 'object' ? body.configuration : null;
  const modelId = String(configuration?.model || body?.modelId || savedModel.model || '').trim().slice(0, 100);
  if (!configuration) return { ...savedModel, model: modelId, models: normalizeModelNames(savedModel.models, modelId) };
  const next = { ...savedModel, model: modelId, models: normalizeModelNames(savedModel.models, modelId) };
  if ('name' in configuration) {
    const name = String(configuration.name || '').trim();
    if (!name) throw Object.assign(new Error('模型名称不能为空。'), { status: 400 });
    next.name = name.slice(0, 60);
  }
  if ('provider' in configuration) next.provider = String(configuration.provider || 'Custom').trim().slice(0, 40);
  if ('kind' in configuration && ['official', 'relay', 'local'].includes(configuration.kind)) next.kind = configuration.kind;
  if ('models' in configuration) next.models = normalizeModelNames(configuration.models, modelId);
  if ('baseUrl' in configuration) {
    const baseUrl = String(configuration.baseUrl || '').trim().slice(0, 240);
    try {
      const parsed = new URL(baseUrl);
      const isGeminiOAuthRoute = savedModel.providerKey === geminiProviderKey && baseUrl === 'cloudcode-pa://google';
      if (!['http:', 'https:'].includes(parsed.protocol) && !isGeminiOAuthRoute) throw new Error('unsupported protocol');
    } catch {
      throw Object.assign(new Error('Base URL 格式不正确。'), { status: 400 });
    }
    next.baseUrl = baseUrl;
  }
  if ('apiMode' in configuration) {
    const apiMode = normalizeApiMode(configuration.apiMode);
    if (!apiMode) throw Object.assign(new Error('API 协议不受支持。'), { status: 400 });
    next.apiMode = apiMode;
    next.protocol = modelProtocolFromApiMode(apiMode);
  }
  if ('modelApiModes' in configuration) next.modelApiModes = normalizeModelApiModes(configuration.modelApiModes);
  if ('compat' in configuration) next.compat = normalizeModelCompat(configuration.compat);
  if ('modelCompat' in configuration) next.modelCompat = normalizeModelCompatMap(configuration.modelCompat);
  if ('modelsUrl' in configuration) next.modelsUrl = String(configuration.modelsUrl || '').trim().slice(0, 300);
  if ('contextLimit' in configuration) next.contextLimit = Number.isFinite(Number(configuration.contextLimit)) && Number(configuration.contextLimit) > 0 ? Number(configuration.contextLimit) : null;
  if ('pricing' in configuration) next.pricing = normalizeModelPricing(configuration.pricing);
  if ('capabilityMode' in configuration) next.capabilityMode = configuration.capabilityMode === 'manual' ? 'manual' : 'auto';
  if ('capabilityOverrides' in configuration) next.capabilityOverrides = normalizeCapabilityOverrides(configuration.capabilityOverrides);
  return next;
}

async function persistVerifiedModelDraft(state, savedModel, verifiedModel, explicitApiKey) {
  for (const key of ['name', 'provider', 'kind', 'protocol', 'model', 'models', 'baseUrl', 'apiMode', 'modelsUrl', 'modelApiModes', 'compat', 'modelCompat', 'contextLimit', 'capabilityMode', 'capabilityOverrides', 'pricing']) {
    savedModel[key] = verifiedModel[key];
  }
  const provided = String(explicitApiKey || '').trim();
  if (provided) {
    savedModel.apiKeyState = 'provided';
    await setModelSecret(savedModel.id, provided);
  }
  savedModel.apiKey = '';
  await writeState(state);
}

app.post('/api/models/:id/verify', async (req, res) => {
  let verificationContext = null;
  try {
    const state = await readState();
    const model = state.models.find((item) => item.id === req.params.id);
    if (!model) return res.status(404).json({ error: '模型不存在。' });
    const savedRoutePrefix = verificationRoutePrefix(model);
    const verificationModel = verificationModelFromRequest(model, req.body);
    const modelId = verificationModel.model;
    verificationContext = { model: verificationModel, modelId, recordFailure: !oauthProviderKeys.has(model.providerKey) };
    const capability = resolveModelCapability(verificationModel, modelId, { providerCatalog: flattenProviderCatalog(modelCatalogCache) });
    const saveOnSuccess = req.body?.saveOnSuccess === true && Boolean(req.body?.configuration);
    if (oauthProviderKeys.has(model.providerKey)) {
      const profileName = model.profileName || await requestedModelProfile(req);
      const officialBaseUrl = officialOAuthBaseUrl(model.providerKey, verificationModel.baseUrl);
      let nativeVerification;
      if (model.providerKey === 'openai-codex') nativeVerification = await verifyCodexOAuthProvider(profileName, modelId);
      else if (model.providerKey === 'claude-oauth') nativeVerification = await verifyClaudeOAuthProvider(profileName, modelId, officialBaseUrl);
      else if (model.providerKey === geminiProviderKey) nativeVerification = await verifyGeminiOAuthProvider(profileName, modelId);
      else throw providerVerificationError('当前 OAuth Provider 暂不支持原生验证。', 400, 'provider_rejected');
      if (saveOnSuccess) {
        await persistVerifiedModelDraft(state, model, verificationModel, '');
        await updateHermesModelProviderConfig(profileName, model.providerKey, model.model);
        const verifiedRoutePrefix = verificationRoutePrefix(verificationModel);
        if (savedRoutePrefix !== verifiedRoutePrefix) {
          modelCatalogCache.verifications = Object.fromEntries(Object.entries(modelCatalogCache.verifications || {}).filter(([key]) => !key.startsWith(savedRoutePrefix)));
        }
      }
      const verifiedAt = nativeVerification.verifiedAt || now();
      modelCatalogCache.verifications = modelCatalogCache.verifications || {};
      modelCatalogCache.verifications[verificationKey(verificationModel, modelId)] = {
        status: 'confirmed', modelId, verifiedAt,
        reasoning: capability.defaultReasoning || 'default',
        serviceTier: capability.serviceTiers?.[0]?.id || 'standard',
        verificationKind: nativeVerification.verificationKind,
      };
      await writeCatalogCache(modelCatalogCachePath, modelCatalogCache);
      return res.json({
        verified: true, mode: 'connection', modelId,
        requestedReasoning: capability.defaultReasoning || 'default', effectiveReasoning: capability.defaultReasoning || 'default',
        requestedServiceTier: capability.serviceTiers?.[0]?.id || 'standard', effectiveServiceTier: capability.serviceTiers?.[0]?.id || 'standard',
        capabilitySource: capability.source, capability, probeResults: [], verifiedAt,
        verificationKind: nativeVerification.verificationKind, usageConsumed: nativeVerification.usageConsumed,
        ...(nativeVerification.catalog ? { catalog: nativeVerification.catalog } : {}),
        saved: saveOnSuccess,
        ...(saveOnSuccess ? { model: publicModel(model), models: state.models.map(publicModel) } : {}),
      });
    }
    const apiKey = await credentialForModelDraft(model, verificationModel.baseUrl, req.body?.apiKey, state.models);
    if (!apiKey) return res.status(400).json({ error: '验证需要可用的 API Key。' });
    const headers = verificationModel.apiMode === 'anthropic_messages'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
      : { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const mode = req.body?.mode === 'discover' ? 'discover' : 'connection';
    const canDiscover = verificationModel.capabilityMode !== 'manual'
      && String(verificationModel.providerKey || '').startsWith('custom:')
      && (verificationModel.apiMode === 'codex_responses' || verificationModel.apiMode === 'openai_responses')
      && ['unknown', 'verification_failed'].includes(capability.status);
    if (mode === 'discover' && !canDiscover) {
      const reason = verificationModel.capabilityMode === 'manual'
        ? '当前使用手动能力设置。'
        : !String(verificationModel.providerKey || '').startsWith('custom:')
          ? '只有自定义中转站支持主动探测。'
          : !['codex_responses', 'openai_responses'].includes(verificationModel.apiMode)
            ? '主动探测需要 OpenAI Responses 或 OpenAI Codex Responses 协议。'
            : '当前线路已有明确能力记录。';
      return res.status(400).json({ error: reason });
    }

    if (mode === 'discover') {
      const discovery = await probeResponsesCapabilities({
        modelId,
        request: async (body) => {
          try {
            return await fetchExternalJson(providerInferenceUrl(verificationModel), { method: 'POST', headers, body: JSON.stringify(body), timeoutMs: 12000 });
          } catch (error) {
            return { ok: false, status: 0, error: String(error?.name === 'AbortError' ? '请求超时' : error?.message || error) };
          }
        },
      });
      if (saveOnSuccess) {
        await persistVerifiedModelDraft(state, model, verificationModel, req.body?.apiKey);
        const verifiedRoutePrefix = verificationRoutePrefix(verificationModel);
        if (savedRoutePrefix !== verifiedRoutePrefix) {
          modelCatalogCache.verifications = Object.fromEntries(Object.entries(modelCatalogCache.verifications || {}).filter(([key]) => !key.startsWith(savedRoutePrefix)));
        }
      }
      await recordActiveProbeCapability(modelCatalogCachePath, modelCatalogCache, verificationModel, discovery.capability);
      modelCatalogCache.verifications = modelCatalogCache.verifications || {};
      modelCatalogCache.verifications[verificationKey(verificationModel, modelId)] = {
        status: 'confirmed', modelId, verifiedAt: discovery.verifiedAt,
        reasoning: discovery.capability.defaultReasoning || 'default',
        serviceTier: discovery.capability.serviceTiers[0]?.id || 'standard',
        probeResults: discovery.probeResults,
      };
      await writeCatalogCache(modelCatalogCachePath, modelCatalogCache);
      return res.json({
        verified: true, mode, modelId,
        requestedReasoning: 'discover', effectiveReasoning: discovery.capability.defaultReasoning || 'default',
        requestedServiceTier: 'discover', effectiveServiceTier: discovery.capability.serviceTiers[0]?.id || 'standard',
        capabilitySource: discovery.capability.source,
        capability: discovery.capability,
        probeResults: discovery.probeResults,
        verifiedAt: discovery.verifiedAt,
        verificationKind: 'api_key',
        usageConsumed: true,
        saved: saveOnSuccess,
        ...(saveOnSuccess ? { model: publicModel(model), models: state.models.map(publicModel) } : {}),
      });
    }

    const mapped = mapRunSettings(verificationModel, capability, { reasoningEffort: req.body?.reasoningEffort, serviceTier: req.body?.serviceTier || req.body?.speedMode });
    const requestOverrides = mapped.runtimeOverrides.request_overrides || {};
    const expandedRequestOverrides = directHttpRequestOverrides(requestOverrides);
    let body;
    if (verificationModel.apiMode === 'anthropic_messages') body = { model: modelId, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 8, ...expandedRequestOverrides };
    else if (verificationModel.apiMode === 'codex_responses' || verificationModel.apiMode === 'openai_responses') body = { model: modelId, input: 'Reply OK.', max_output_tokens: 8, ...(mapped.runtimeOverrides.reasoning_config ? { reasoning: mapped.runtimeOverrides.reasoning_config } : {}), ...(mapped.runtimeOverrides.service_tier ? { service_tier: mapped.runtimeOverrides.service_tier } : {}), ...expandedRequestOverrides };
    else body = { model: modelId, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 8, ...expandedRequestOverrides };
    const result = await fetchExternalJson(providerInferenceUrl(verificationModel), { method: 'POST', headers, body: JSON.stringify(body), timeoutMs: 30000 });
    if (!result.ok) {
      const message = String(result.body?.error?.message || `HTTP ${result.status}`).slice(0, 500);
      throw Object.assign(new Error(`配置验证失败：${message}`), { status: result.status || 502, code: 'provider_rejected' });
    }
    modelCatalogCache.verifications = modelCatalogCache.verifications || {};
    if (saveOnSuccess) {
      await persistVerifiedModelDraft(state, model, verificationModel, req.body?.apiKey);
      const verifiedRoutePrefix = verificationRoutePrefix(verificationModel);
      if (savedRoutePrefix !== verifiedRoutePrefix) {
        modelCatalogCache.verifications = Object.fromEntries(Object.entries(modelCatalogCache.verifications || {}).filter(([key]) => !key.startsWith(savedRoutePrefix)));
      }
    }
    const key = verificationKey(verificationModel, modelId);
    const verifiedAt = now();
    modelCatalogCache.verifications[key] = { status: 'confirmed', modelId, verifiedAt, reasoning: mapped.effectiveReasoning, serviceTier: mapped.effectiveServiceTier };
    await writeCatalogCache(modelCatalogCachePath, modelCatalogCache);
    res.json({ verified: true, mode, modelId, requestedReasoning: mapped.requestedReasoning, effectiveReasoning: mapped.effectiveReasoning, requestedServiceTier: mapped.requestedServiceTier, effectiveServiceTier: mapped.effectiveServiceTier, capabilitySource: capability.source, capability, probeResults: [], verifiedAt, verificationKind: 'api_key', usageConsumed: true, saved: saveOnSuccess, ...(saveOnSuccess ? { model: publicModel(model), models: state.models.map(publicModel) } : {}) });
  } catch (error) {
    if (verificationContext?.recordFailure) {
      modelCatalogCache.verifications = modelCatalogCache.verifications || {};
      modelCatalogCache.verifications[verificationKey(verificationContext.model, verificationContext.modelId)] = { status: 'verification_failed', modelId: verificationContext.modelId, verifiedAt: now(), error: String(error.message || error).slice(0, 500) };
      await writeCatalogCache(modelCatalogCachePath, modelCatalogCache).catch(() => {});
    }
    res.status(error.status || 500).json({ error: error.message || '配置验证失败。', ...(error.code ? { code: error.code } : {}) });
  }
});

function cleanupAuthSessions(store) {
  const cutoff = Date.now() - oauthPollMaxMs - 60000;
  for (const [sessionId, session] of store.entries()) {
    if (session.createdAt < cutoff) {
      if (session.server) {
        try { session.server.close(); } catch {}
      }
      store.delete(sessionId);
    }
  }
}

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makePkcePair(size = 32) {
  const verifier = randomBytes(size).toString('base64url');
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function codexLoginWorker(session) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < oauthPollMaxMs) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    if (session.status !== 'pending') return;
    try {
      const pollRes = await fetch(codexDeviceTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_auth_id: session.deviceAuthId, user_code: session.userCode }),
        signal: AbortSignal.timeout(10000),
      });
      if (pollRes.status === 403 || pollRes.status === 404) continue;
      if (!pollRes.ok) {
        session.status = 'error';
        session.error = `Codex 轮询失败：HTTP ${pollRes.status}`;
        return;
      }
      const pollData = await pollRes.json();
      const tokenRes = await fetch(codexOAuthTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: pollData.authorization_code,
          redirect_uri: codexRedirectUri,
          client_id: codexClientId,
          code_verifier: pollData.code_verifier,
        }).toString(),
        signal: AbortSignal.timeout(15000),
      });
      if (!tokenRes.ok) {
        session.status = 'error';
        session.error = `Codex token 交换失败：HTTP ${tokenRes.status}`;
        return;
      }
      const tokenData = await tokenRes.json();
      await saveCodexOAuthTokens(session.profile, tokenData.access_token, tokenData.refresh_token || '');
      try {
        await refreshCodexOAuthModels(tokenData.access_token);
      } catch {}
      const providerState = oauthProviderPayload(session.profile, 'openai-codex');
      session.models = providerState.models;
      session.catalog = providerState.catalog;
      session.capabilities = providerState.capabilities;
      session.status = 'approved';
      return;
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') continue;
      session.status = 'error';
      session.error = error?.message || String(error);
      return;
    }
  }
  session.status = 'expired';
}

app.post('/api/auth/codex/start', async (req, res) => {
  try {
    cleanupAuthSessions(codexAuthSessions);
    const response = await fetch(codexDeviceAuthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'node-fetch' },
      body: JSON.stringify({ client_id: codexClientId }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      let body = {};
      try { body = await response.json(); } catch {}
      const message = body?.error?.code === 'unsupported_country_region_territory'
        ? 'OpenAI 当前不支持你的网络区域。'
        : `Codex 授权码获取失败：HTTP ${response.status}`;
      return res.status(502).json({ error: message, code: body?.error?.code || '' });
    }
    const data = await response.json();
    const session = { id: randomUUID(), profile: await requestedModelProfile(req), userCode: data.user_code, deviceAuthId: data.device_auth_id, status: 'pending', createdAt: Date.now(), error: '' };
    codexAuthSessions.set(session.id, session);
    codexLoginWorker(session).catch((error) => {
      session.status = 'error';
      session.error = error?.message || String(error);
    });
    res.json({ session_id: session.id, user_code: session.userCode, verification_url: codexVerificationUrl, expires_in: 900 });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Codex 授权启动失败。' });
  }
});

app.get('/api/auth/codex/:sessionId', (req, res) => {
  const session = codexAuthSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: '授权会话不存在。' });
  res.json({ status: session.status, error: session.error || null, authenticated: session.status === 'approved', models: session.models || [], catalog: session.catalog || null, capabilities: session.capabilities || {} });
});

app.post('/api/auth/codex/catalog', async (req, res) => {
  const profile = await requestedModelProfile(req);
  const accessToken = oauthProviderAccessToken(profile, 'openai-codex');
  if (!accessToken) return res.status(401).json({ error: '请先完成 OpenAI Codex 授权。', authenticated: false, models: [] });
  try {
    await refreshCodexOAuthModels(accessToken);
    const state = oauthProviderPayload(profile, 'openai-codex');
    res.json(state);
  } catch (error) {
    const state = oauthProviderPayload(profile, 'openai-codex');
    res.status(state.models.length ? 200 : 502).json({ ...state, error: error.message || 'Codex 模型目录获取失败。' });
  }
});

app.post('/api/auth/claude/start', async (req, res) => {
  try {
    cleanupAuthSessions(claudeAuthSessions);
    const { verifier, challenge } = makePkcePair();
    const state = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({
      code: 'true',
      client_id: claudeClientId,
      response_type: 'code',
      redirect_uri: claudeRedirectUri,
      scope: claudeScopes,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    const session = { id: randomUUID(), profile: await requestedModelProfile(req), verifier, state, status: 'pending', createdAt: Date.now(), error: '' };
    claudeAuthSessions.set(session.id, session);
    res.json({ session_id: session.id, authorization_url: `${claudeAuthorizeUrl}?${params.toString()}`, expires_in: 900 });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Claude 授权启动失败。' });
  }
});

app.post('/api/auth/claude/:sessionId/submit', async (req, res) => {
  const session = claudeAuthSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: '授权会话不存在。' });
  if (Date.now() - session.createdAt > oauthPollMaxMs) {
    session.status = 'expired';
    return res.json({ status: session.status, error: null });
  }
  const rawCode = String(req.body?.code || '').trim();
  const [code, receivedState = ''] = rawCode.split('#', 2);
  if (!code) return res.status(400).json({ error: '请输入 Claude 返回的授权 code。' });
  if (receivedState && receivedState !== session.state) {
    session.status = 'error';
    session.error = 'OAuth state 不匹配。';
    return res.status(400).json({ status: session.status, error: session.error });
  }
  try {
    const response = await fetch(claudeTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'frakio-work/0.1' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: claudeClientId,
        code: code.trim(),
        state: receivedState || session.state,
        redirect_uri: claudeRedirectUri,
        code_verifier: session.verifier,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Claude token 交换失败：HTTP ${response.status}${text ? ` ${text.slice(0, 160)}` : ''}`);
    }
    await saveClaudeOAuthTokens(session.profile, await response.json());
    session.status = 'approved';
    const providerState = oauthProviderPayload(session.profile, 'claude-oauth');
    res.json({ status: session.status, error: null, ...providerState });
  } catch (error) {
    session.status = 'error';
    session.error = error.message || String(error);
    res.status(502).json({ status: session.status, error: session.error });
  }
});

async function fetchGoogleEmail(accessToken) {
  try {
    const response = await fetch(googleUserInfoEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return '';
    const body = await response.json();
    return String(body.email || '').trim();
  } catch {
    return '';
  }
}

async function exchangeGeminiCode(session, code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: session.verifier,
    client_id: googleClientId,
    redirect_uri: session.redirectUri,
  });
  if (googleClientSecret) body.set('client_secret', googleClientSecret);
  const response = await fetch(googleTokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google token 交换失败：HTTP ${response.status}${text ? ` ${text.slice(0, 160)}` : ''}`);
  }
  const tokenData = await response.json();
  await saveGeminiOAuthTokens(session.profile, tokenData, await fetchGoogleEmail(tokenData.access_token));
}

function startGeminiCallbackServer(sessionId, preferredPort = geminiRedirectPort) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void (async () => {
        const session = geminiAuthSessions.get(sessionId);
        const url = new URL(req.url || '/', `http://${geminiRedirectHost}`);
        if (!session || url.pathname !== geminiRedirectPath) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        try {
          if (url.searchParams.get('state') !== session.state) throw new Error('OAuth state 不匹配。');
          const code = url.searchParams.get('code') || '';
          const denied = url.searchParams.get('error') || '';
          if (denied) throw new Error(`Google 拒绝授权：${denied}`);
          if (!code) throw new Error('Google 回调没有返回 code。');
          await exchangeGeminiCode(session, code);
          session.status = 'approved';
          try { server.close(); } catch {}
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><meta charset="utf-8"><title>Frakio Work</title><body style="font:16px system-ui;text-align:center;margin-top:10vh"><h1>Google Gemini 授权完成</h1><p>可以关闭这个页面，回到 Frakio Work。</p></body>');
        } catch (error) {
          session.status = 'error';
          session.error = error.message || String(error);
          try { server.close(); } catch {}
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><meta charset="utf-8"><title>Frakio Work</title><body style="font:16px system-ui;text-align:center;margin-top:10vh"><h1>授权失败</h1><p>${String(session.error).replace(/[<>&]/g, '')}</p></body>`);
        }
      })();
    });
    server.on('error', reject);
    server.listen(preferredPort, geminiCallbackBindHost, () => {
      const address = server.address();
      const portValue = typeof address === 'object' && address ? address.port : preferredPort;
      resolve({ server, redirectUri: `http://${geminiRedirectHost}:${portValue}${geminiRedirectPath}` });
    });
  });
}

app.post('/api/auth/gemini/start', async (req, res) => {
  try {
    cleanupAuthSessions(geminiAuthSessions);
    const { verifier, challenge } = makePkcePair(64);
    const state = randomBytes(32).toString('base64url');
    const session = { id: randomUUID(), profile: await requestedModelProfile(req), verifier, state, status: 'pending', createdAt: Date.now(), error: '', server: null, redirectUri: '' };
    geminiAuthSessions.set(session.id, session);
    const callback = await startGeminiCallbackServer(session.id);
    session.server = callback.server;
    session.redirectUri = callback.redirectUri;
    const params = new URLSearchParams({
      client_id: googleClientId,
      response_type: 'code',
      redirect_uri: session.redirectUri,
      scope: googleScopes,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    res.json({ session_id: session.id, authorization_url: `${googleAuthEndpoint}?${params.toString()}`, expires_in: 900 });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Google Gemini 授权启动失败。' });
  }
});

app.get('/api/auth/gemini/:sessionId', (req, res) => {
  const session = geminiAuthSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: '授权会话不存在。' });
  if (Date.now() - session.createdAt > oauthPollMaxMs && session.status === 'pending') {
    session.status = 'expired';
    try { session.server?.close(); } catch {}
  }
  const providerState = session.status === 'approved' ? oauthProviderPayload(session.profile, geminiProviderKey) : null;
  res.json({ status: session.status, error: session.error || null, ...(providerState || {}) });
});

app.post('/api/models', async (req, res) => {
  const state = await readState();
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '模型名称不能为空。' });
  const providerKey = String(req.body?.providerKey || '').trim().slice(0, 120);
  const apiMode = normalizeApiMode(req.body?.apiMode);
  if (providerKey.startsWith('custom:') && !apiMode) return res.status(400).json({ error: '自定义 Provider 必须选择 API 协议。' });
  const profileName = await requestedModelProfile(req);
  const oauthAuthenticated = oauthProviderKeys.has(providerKey) && oauthProviderAuthenticated(profileName, providerKey);
  if (oauthProviderKeys.has(providerKey) && !oauthAuthenticated) return res.status(400).json({ error: '请先完成 Provider 授权。' });
  const hasCredential = String(req.body?.apiKey || '').trim() || oauthAuthenticated;
  const modelNames = normalizeModelNames(req.body?.models, req.body?.model);
  if (!modelNames.length) return res.status(400).json({ error: '请先获取或填写至少一个模型。' });
  const defaultModel = modelNames.includes(String(req.body?.model || '').trim()) ? String(req.body.model).trim() : modelNames[0];
  const model = {
    id: id('model'),
    name: name.slice(0, 60),
    provider: String(req.body?.provider || 'Custom').trim().slice(0, 40),
    kind: ['official', 'relay', 'local'].includes(req.body?.kind) ? req.body.kind : 'official',
    protocol: ['OpenAI Compatible', 'Anthropic Compatible', 'Custom'].includes(req.body?.protocol) ? req.body.protocol : modelProtocolFromApiMode(apiMode),
    model: defaultModel.slice(0, 100),
    models: modelNames,
    baseUrl: String(req.body?.baseUrl || '').trim().slice(0, 240),
    apiKey: '',
    apiKeyState: hasCredential ? (oauthProviderKeys.has(providerKey) ? 'authorized' : 'provided') : '',
    source: 'manual',
    profileName: oauthProviderKeys.has(providerKey) ? profileName : '',
    providerKey,
    apiMode,
    modelsUrl: String(req.body?.modelsUrl || '').trim().slice(0, 300),
    modelApiModes: normalizeModelApiModes(req.body?.modelApiModes),
    compat: normalizeModelCompat(req.body?.compat),
    modelCompat: normalizeModelCompatMap(req.body?.modelCompat),
    contextLimit: Number.isFinite(Number(req.body?.contextLimit)) && Number(req.body.contextLimit) > 0 ? Number(req.body.contextLimit) : null,
    capabilityMode: req.body?.capabilityMode === 'manual' ? 'manual' : 'auto',
    capabilityOverrides: normalizeCapabilityOverrides(req.body?.capabilityOverrides),
    pricing: normalizeModelPricing(req.body?.pricing),
  };
  model.providerKey = normalizeModels([...state.models, model]).find((item) => item.id === model.id)?.providerKey || providerKey;
  state.models.push(model);
  await setModelSecret(model.id, req.body?.apiKey);
  await writeState(state);
  if (oauthProviderKeys.has(providerKey)) await updateHermesModelProviderConfig(profileName, providerKey, defaultModel);
  res.json({ model: publicModel(model), models: state.models.map(publicModel) });
});

app.delete('/api/models/:id', async (req, res) => {
  const state = await readState();
  const model = state.models.find((item) => item.id === req.params.id);
  if (!model) return res.status(404).json({ error: '模型不存在。' });
  state.models = state.models.filter((item) => item.id !== req.params.id);
  await deleteModelSecret(req.params.id);
  for (const agent of state.agents) {
    if (agent.model === model.name) agent.model = '';
  }
  await writeState(state);
  res.json({ deletedModelId: req.params.id, models: state.models.map(publicModel), agents: state.agents });
});

app.patch('/api/models/:id', async (req, res) => {
  const state = await readState();
  const model = state.models.find((item) => item.id === req.params.id);
  if (!model) return res.status(404).json({ error: '模型不存在。' });
  const previousVerificationPrefix = verificationRoutePrefix(model);
  if ('name' in req.body) {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: '模型名称不能为空。' });
    model.name = name.slice(0, 60);
  }
  if ('provider' in req.body) model.provider = String(req.body.provider || 'Custom').trim().slice(0, 40);
  if ('kind' in req.body && ['official', 'relay', 'local'].includes(req.body.kind)) model.kind = req.body.kind;
  if ('protocol' in req.body && ['OpenAI Compatible', 'Anthropic Compatible', 'Custom'].includes(req.body.protocol)) model.protocol = req.body.protocol;
  if ('models' in req.body) model.models = normalizeModelNames(req.body.models, model.model);
  if ('model' in req.body) {
    const modelName = String(req.body.model || '').trim().slice(0, 100);
    model.model = modelName;
    model.models = normalizeModelNames(model.models, modelName);
  }
  if ('baseUrl' in req.body) model.baseUrl = String(req.body.baseUrl || '').trim().slice(0, 240);
  if ('providerKey' in req.body) model.providerKey = String(req.body.providerKey || '').trim().slice(0, 120);
  if ('apiMode' in req.body) {
    model.apiMode = normalizeApiMode(req.body.apiMode);
    if (!('protocol' in req.body)) model.protocol = modelProtocolFromApiMode(model.apiMode);
  }
  if ('modelsUrl' in req.body) model.modelsUrl = String(req.body.modelsUrl || '').trim().slice(0, 300);
  if ('modelApiModes' in req.body) model.modelApiModes = normalizeModelApiModes(req.body.modelApiModes);
  if ('compat' in req.body) model.compat = normalizeModelCompat(req.body.compat);
  if ('modelCompat' in req.body) model.modelCompat = normalizeModelCompatMap(req.body.modelCompat);
  if ('contextLimit' in req.body) model.contextLimit = Number.isFinite(Number(req.body.contextLimit)) && Number(req.body.contextLimit) > 0 ? Number(req.body.contextLimit) : null;
  if ('capabilityMode' in req.body) model.capabilityMode = req.body.capabilityMode === 'manual' ? 'manual' : 'auto';
  if ('capabilityOverrides' in req.body) model.capabilityOverrides = normalizeCapabilityOverrides(req.body.capabilityOverrides);
  if ('pricing' in req.body) model.pricing = normalizeModelPricing(req.body.pricing);
  if (oauthProviderKeys.has(model.providerKey)) model.apiKeyState = 'authorized';
  if (String(req.body?.apiKey || '').trim()) {
    model.apiKeyState = 'provided';
    await setModelSecret(model.id, req.body.apiKey);
  }
  model.providerKey = normalizeModels(state.models).find((item) => item.id === model.id)?.providerKey || model.providerKey;
  model.apiKey = '';
  await writeState(state);
  if (oauthProviderKeys.has(model.providerKey) && model.model) {
    await updateHermesModelProviderConfig(model.profileName || await requestedModelProfile(req), model.providerKey, model.model);
  }
  const nextVerificationPrefix = verificationRoutePrefix(model);
  modelCatalogCache.verifications = Object.fromEntries(Object.entries(modelCatalogCache.verifications || {})
    .filter(([key]) => !key.startsWith(previousVerificationPrefix) && !key.startsWith(nextVerificationPrefix)));
  await writeCatalogCache(modelCatalogCachePath, modelCatalogCache).catch(() => {});
  res.json({ model: publicModel(model), models: state.models.map(publicModel) });
});

app.post('/api/agents', async (req, res) => {
  try {
    const state = await readState();
    const requestId = String(req.body?.requestId || '').trim().slice(0, 120);
    const previousAgentId = requestId ? state.integrations?.hermesAgent?.agentCreationRequests?.[requestId]?.agentId : '';
    const previousAgent = previousAgentId ? state.agents.find((item) => item.id === previousAgentId) : null;
    if (previousAgent) {
      const runtime = await hermesRuntimeStatus().catch(() => null);
      const profileName = previousAgent.profileName || previousAgent.id;
      const gateway = runtime?.gateways?.find((item) => item.profileName === profileName) || null;
      return res.json({ agent: previousAgent, agents: state.agents, gateway, runtime, idempotentReplay: true });
    }
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Agent 名称不能为空。' });
    const profileName = await uniqueProfileName(name);
    await createHermesProfileFiles(profileName, req.body || {});
    const profile = (await readHermesProfiles()).find((item) => item.name === profileName);
    const agent = {
      id: profileName,
      name: name.slice(0, 32),
      role: String(req.body?.role || '新 Agent').trim().slice(0, 60),
      model: String(req.body?.model || '').trim().slice(0, 60),
      color: String(req.body?.color || profileColor(profileName)).trim().slice(0, 20),
      soul: profile?.soul || String(req.body?.soul || req.body?.scope || '待定义 Soul。').trim(),
      scope: String(req.body?.scope || req.body?.role || '待定义职责范围。').trim().slice(0, 300),
      source: 'hermes-profile',
      profileName,
      gatewayStatus: '',
      soulExcerpt: profile?.soulExcerpt || '',
      userProfileExcerpt: profile?.userExcerpt || '',
      memoryExcerpt: profile?.memoryExcerpt || '',
      userProfile: profile?.userProfile || '',
      memory: profile?.memory || '',
      providerSummary: profile?.providers || [],
      skills: profile?.skills || [],
      plugins: profile?.plugins || [],
      avatarUrl: profile?.avatarUrl || '',
    };
    const firstAgent = state.agents.length === 0;
    state.agents.push(agent);
    if (firstAgent || !state.agents.some((item) => item.id === state.ui?.defaultAgentId)) {
      state.ui = { ...(state.ui || {}), defaultAgentId: agent.id };
    }
    if (requestId) {
      const previousRequests = Object.entries(state.integrations?.hermesAgent?.agentCreationRequests || {}).slice(-99);
      state.integrations.hermesAgent = {
        ...(state.integrations.hermesAgent || {}),
        agentCreationRequests: Object.fromEntries([...previousRequests, [requestId, { agentId: agent.id, createdAt: now() }]]),
      };
    }
    await writeState(state);
    const warnings = [];
    try {
      await registerProfileGatewayAutoStart(profileName);
    } catch (error) {
      warnings.push(`自动启动配置保存失败：${error?.message || error}`);
    }
    let gateway = null;
    try {
      gateway = await startProfileGateway(profileName);
      if (!gateway?.running) warnings.push(gateway?.error || gateway?.status || '网关未能启动。');
    } catch (error) {
      warnings.push(`网关启动失败：${error?.message || error}`);
    }
    const runtime = await hermesRuntimeStatus().catch(() => null);
    res.json({ agent, agents: state.agents, profile, gateway, runtime, ...(warnings.length ? { gatewayWarning: warnings.join('\n') } : {}) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Agent 创建失败。' });
  }
});

app.delete('/api/agents/:id', async (req, res) => {
  try {
    if (isSystemHermesProfile('', req.params.id)) {
      return res.status(409).json({ error: 'Hermes Default 是受保护的系统 Profile。', code: 'system_profile_protected' });
    }
    const state = await readState();
    const agent = state.agents.find((item) => item.id === req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent 不存在。' });
    const profileName = agent.profileName || '';
    if (isSystemHermesProfile(profileName, agent.id)) {
      return res.status(409).json({ error: 'Hermes Default 是受保护的系统 Profile。', code: 'system_profile_protected' });
    }
    const profileDir = profileName ? resolveDeletableHermesProfileDir(hermesHome, profileName) : null;
    if (profileDir) {
      await rm(profileDir, { recursive: true, force: true });
    }
    state.agents = state.agents.filter((item) => item.id !== agent.id);
    await writeState(state);
    res.json({ ok: true, deletedAgentId: agent.id, deletedProfileName: profileName, agents: state.agents });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Agent 删除失败。', ...(error.code ? { code: error.code } : {}) });
  }
});

app.patch('/api/agents/:id', async (req, res) => {
  const state = await readState();
  const agent = state.agents.find((item) => item.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent 不存在。' });
  if ('name' in req.body) agent.name = String(req.body.name || agent.name).trim().slice(0, 32);
  if ('role' in req.body) agent.role = String(req.body.role || agent.role).trim().slice(0, 60);
  if ('model' in req.body) {
    const requestedModel = String(req.body.model || agent.model).trim();
    const { selectedName } = resolveModelSelection(requestedModel, state.models);
    if (agent.profileName) {
      const updated = await updateHermesProfileDefaultModel(agent.profileName, requestedModel, state.models);
      agent.model = String(updated?.model || selectedName || requestedModel).trim().slice(0, 120);
    } else {
      agent.model = String(selectedName || requestedModel).trim().slice(0, 120);
    }
  }
  if ('color' in req.body) agent.color = String(req.body.color || agent.color).trim().slice(0, 20);
  if ('soul' in req.body) agent.soul = String(req.body.soul || agent.soul || agent.scope || '').trim().slice(0, 500);
  if ('scope' in req.body) agent.scope = String(req.body.scope || agent.scope).trim().slice(0, 300);
  await writeState(state);
  res.json({ agent, agents: state.agents });
});

app.get('/api/state', async (_req, res) => {
  const state = await readState();
  res.json({ ui: state.ui, defaultVaultId: state.defaultVaultId, spaces: state.spaces.map(publicSpace), workspaces: state.workspaces, integrations: state.integrations });
});

app.patch('/api/state/ui', async (req, res) => {
  const state = await readState();
  const next = { ...(req.body || {}) };
  if ('defaultAgentId' in next && !state.agents.some((agent) => agent.id === next.defaultAgentId)) delete next.defaultAgentId;
  if ('activeSpaceId' in next && !state.spaces.some((space) => space.id === next.activeSpaceId && !space.archivedAt)) delete next.activeSpaceId;
  if ('telemetryEnabled' in next) next.telemetryEnabled = Boolean(next.telemetryEnabled);
  if ('telemetryNoticeSeenAt' in next) next.telemetryNoticeSeenAt = String(next.telemetryNoticeSeenAt || '').slice(0, 40);
  if ('agentMentionMaxDepth' in next) next.agentMentionMaxDepth = normalizeAgentMentionMaxDepth(next.agentMentionMaxDepth, 2);
  state.ui = { ...state.ui, ...next };
  await writeState(state);
  if ('telemetryEnabled' in next) await telemetry.setEnabled(next.telemetryEnabled);
  res.json({ ui: state.ui });
});

app.get('/api/telemetry/status', async (_req, res) => {
  await telemetry.initialize();
  res.json(telemetry.status());
});

app.post('/api/telemetry/onboarding-completed', async (req, res) => {
  const importResult = ['completed', 'skipped', 'failed'].includes(req.body?.importResult) ? req.body.importResult : 'skipped';
  captureTelemetry('onboarding_completed', { hermes_source: process.env.FRAKIO_WORK_HERMES_SOURCE || 'unknown', import_result: importResult });
  res.json({ ok: true });
});

app.get('/api/user-profile/summary', async (_req, res) => {
  try {
    const state = await readState();
    const hermesUsage = await readHermesAgentUsageRows();
    const hermesUsageRows = hermesUsage.rows;
    const workbenchUsageRows = (state.observability?.modelUsage || [])
      .filter((row) => row.dataSource !== 'Hermes Agent' && row.provider !== 'Hermes Agent')
      .map((row) => ({ ...row, dataSource: row.dataSource || 'Frakio Work local usage' }));
    const usageRows = [...hermesUsageRows, ...workbenchUsageRows];
    const usage = aggregateModelUsage(usageRows, state.models || []);
    const peakDay = (usage.byDay || []).reduce((peak, row) => Number(row.realTotalTokens || row.totalTokens || 0) > Number(peak.realTotalTokens || peak.totalTokens || 0) ? row : peak, { day: '', totalTokens: 0, realTotalTokens: 0 });
    const agents = collectAgentUsage(state);
    const skills = collectModuleUsage(state, 'skills');
    const plugins = collectModuleUsage(state, 'plugins');
    res.json({
      checkedAt: now(),
      userProfile: state.userProfile,
      stats: {
        totalTokens: Number(usage.realTotalTokens || usage.totalTokens || 0),
        peakDayTokens: Number(peakDay.realTotalTokens || peakDay.totalTokens || 0),
        peakDay: peakDay.day || '',
        requests: Number(usage.totalRequests || 0),
        conversations: (state.threads || []).length,
        activeAgents: agents.filter((agent) => agent.conversationCount > 0 || agent.messageCount > 0).length,
      },
      usage: {
        byDay: usage.byDay || [],
        entries: usage.entries || [],
      },
      hermesAgent: hermesUsage.meta,
      agents,
      modules: { skills, plugins },
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.get('/api/monitoring/summary', async (_req, res) => {
  try {
    const state = await readState();
    const logs = await readMonitoringLogs(160);
    const hermesDb = await readHermesDbSummary();
    const hermesUsage = await readHermesAgentUsageRows();
    const hermesUsageRows = hermesUsage.rows;
    const workbenchUsageRows = (state.observability?.modelUsage || [])
      .filter((row) => row.dataSource !== 'Hermes Agent' && row.provider !== 'Hermes Agent')
      .map((row) => ({ ...row, dataSource: row.dataSource || 'Frakio Work local usage' }));
    const usageRows = [...hermesUsageRows, ...workbenchUsageRows];
    res.json({
      checkedAt: now(),
      logs,
      modelRuns: (state.observability?.modelRuns || []).slice(-200).reverse(),
      usage: aggregateModelUsage(usageRows, state.models || []),
      hermesStudio: { databaseExists: hermesDb.exists, roomCount: hermesDb.rooms.length, sessionCount: hermesDb.sessions.length, usageRowCount: hermesUsageRows.length, usageSource: 'legacy hermes-web-ui db' },
      hermesAgent: hermesUsage.meta,
      modules: {
        skills: collectModuleUsage(state, 'skills'),
        plugins: collectModuleUsage(state, 'plugins'),
      },
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.get('/api/vaults', async (_req, res) => {
  const state = await readState();
  const vaults = await Promise.all(state.vaults.map(markRefreshStatus));
  state.vaults = vaults;
  await writeState(state);
  res.json({ vaults: vaults.map(publicVault), defaultVaultId: state.defaultVaultId });
});

app.post('/api/vaults', async (req, res) => {
  try {
    const vaultPath = path.resolve(String(req.body?.path || '').trim());
    if (!vaultPath) return res.status(400).json({ error: '请输入 Obsidian 仓库路径。' });
    const state = await readState();
    const existing = state.vaults.find((vault) => path.resolve(vault.path) === vaultPath);
    const index = await buildVaultIndex(vaultPath);
    const vault = existing || { id: id('vault'), name: String(req.body?.name || '').trim() || vaultNameFromPath(vaultPath), path: vaultPath };
    Object.assign(vault, {
      name: String(req.body?.name || '').trim() || vault.name || vaultNameFromPath(vaultPath),
      path: vaultPath,
      status: 'indexed',
      documentCount: index.documentCount,
      productCount: index.productCount,
      lastIndexedAt: now(),
      needsRefresh: false,
      index,
    });
    if (!existing) state.vaults.push(vault);
    state.defaultVaultId = vault.id;
    await writeState(state);
    captureTelemetry('feature_used', { feature: 'vault_indexed', outcome: 'completed' });
    captureMeaningfulActivity('vault_indexed');
    res.json({ vault: publicVault(vault), summary: summaryFromVault(vault) });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.post('/api/vaults/:id/index', async (req, res) => {
  try {
    const state = await readState();
    const vault = state.vaults.find((item) => item.id === req.params.id);
    if (!vault) return res.status(404).json({ error: '仓库不存在。' });
    const index = await buildVaultIndex(vault.path);
    Object.assign(vault, {
      status: 'indexed',
      documentCount: index.documentCount,
      productCount: index.productCount,
      lastIndexedAt: now(),
      needsRefresh: false,
      index,
    });
    await writeState(state);
    captureTelemetry('feature_used', { feature: 'vault_indexed', outcome: 'completed' });
    captureMeaningfulActivity('vault_indexed');
    res.json({ vault: publicVault(vault), summary: summaryFromVault(vault) });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.delete('/api/vaults/:id', async (req, res) => {
  const state = await readState();
  const vault = state.vaults.find((item) => item.id === req.params.id);
  if (!vault) return res.status(404).json({ error: '仓库不存在，可能已经被移除。' });

  const detachedWorkspaceIds = state.workspaces
    .filter((workspace) => workspace.vaultId === vault.id)
    .map((workspace) => workspace.id);
  const detachedThreadIds = state.threads
    .filter((thread) => thread.vaultId === vault.id)
    .map((thread) => thread.id);

  state.workspaces.forEach((workspace) => {
    if (workspace.vaultId === vault.id) {
      workspace.vaultId = null;
      workspace.updatedAt = now();
    }
  });
  state.threads.forEach((thread) => {
    if (thread.vaultId === vault.id) {
      thread.vaultId = null;
      thread.updatedAt = now();
    }
  });
  state.vaults = state.vaults.filter((item) => item.id !== vault.id);
  if (state.defaultVaultId === vault.id) state.defaultVaultId = state.vaults[0]?.id || null;

  await writeState(state);
  res.json({
    ok: true,
    deletedVaultId: vault.id,
    defaultVaultId: state.defaultVaultId,
    detachedWorkspaceIds,
    detachedThreadIds,
  });
});

app.get('/api/vaults/:id/summary', async (req, res) => {
  const state = await readState();
  const vault = state.vaults.find((item) => item.id === req.params.id);
  if (!vault) return res.status(404).json({ error: '仓库不存在。' });
  res.json(summaryFromVault(await markRefreshStatus(vault)));
});

app.get('/api/vault/summary', async (_req, res) => {
  const state = await readState();
  const vault = state.vaults.find((item) => item.id === state.defaultVaultId) || state.vaults[0];
  res.json(summaryFromVault(await markRefreshStatus(vault)));
});

app.get('/api/spaces', async (_req, res) => {
  const state = await readState();
  const includeArchived = String(_req.query?.includeArchived || '').toLowerCase() === 'true';
  const spaces = state.spaces
    .filter((space) => includeArchived || !space.archivedAt)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .map(publicSpace);
  res.json({ spaces, activeSpaceId: state.ui.activeSpaceId || spaces[0]?.id || null });
});

app.post('/api/spaces', async (req, res) => {
  const state = await readState();
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: '工作区名称不能为空。' });
  const space = normalizeSpace({
    id: id('space'),
    name,
    iconKind: req.body?.iconKind,
    iconValue: req.body?.iconValue,
    theme: req.body?.theme,
    lastOpenedAt: now(),
  }, name);
  state.spaces.push(space);
  state.ui.activeSpaceId = space.id;
  await writeState(state);
  res.json({ space: publicSpace(space), activeSpaceId: space.id });
});

app.patch('/api/spaces/:id', async (req, res) => {
  const state = await readState();
  const space = state.spaces.find((item) => item.id === req.params.id);
  if (!space) return res.status(404).json({ error: '工作区不存在。' });
  if ('name' in req.body) space.name = String(req.body.name || space.name).slice(0, 60);
  if ('iconKind' in req.body) space.iconKind = req.body.iconKind === 'icon' ? 'icon' : req.body.iconKind === 'emoji' ? 'emoji' : 'dot';
  if ('iconValue' in req.body) space.iconValue = String(req.body.iconValue || space.iconValue || '').slice(0, 16);
  if ('theme' in req.body) space.theme = normalizeSpaceTheme({ ...(space.theme || {}), ...(req.body.theme || {}) });
  if ('active' in req.body && req.body.active) {
    space.lastOpenedAt = now();
    state.ui.activeSpaceId = space.id;
  }
  space.updatedAt = now();
  await writeState(state);
  res.json({ space: publicSpace(space), activeSpaceId: state.ui.activeSpaceId });
});

app.get('/api/workspaces', async (_req, res) => {
  const state = await readState();
  const includeArchived = String(_req.query?.includeArchived || '').toLowerCase() === 'true';
  res.json({ workspaces: state.workspaces.filter((workspace) => includeArchived || !workspace.archivedAt).sort(sortPinnedThenUpdated).map((workspace) => publicWorkspace(workspace, state)) });
});

app.post('/api/workspaces', async (req, res) => {
  try {
    const state = await readState();
    const defaultAgentId = resolveDefaultAgentId(state);
    const name = String(req.body?.name || '').trim().slice(0, 60);
    const mode = req.body?.mode === 'existing' ? 'existing' : 'create';
    if (mode === 'create' && !name) return res.status(400).json({ error: '项目名称不能为空。' });
    if (mode === 'existing' && !String(req.body?.rootPath || '').trim()) return res.status(400).json({ error: '请选择或输入已有文件夹路径。' });
    const parentPath = await ensureDirectory(req.body?.parentPath || defaultProjectsRoot);
    const requestedSpaceId = state.spaces.some((space) => space.id === req.body?.spaceId && !space.archivedAt) ? req.body.spaceId : state.ui.activeSpaceId || state.spaces[0]?.id || null;
    const requestedRoot = mode === 'existing'
      ? String(req.body?.rootPath || '').trim()
      : path.join(parentPath, slug(name) || 'new-project');
    const rootPath = await ensureDirectory(requestedRoot);
    const existingWorkspace = state.workspaces.find((workspace) => path.resolve(workspace.rootPath) === rootPath);
    if (existingWorkspace) return res.status(409).json({ error: '这个文件夹已经绑定到一个项目。', workspace: publicWorkspace(existingWorkspace, state) });
    const workspaceName = name || vaultNameFromPath(rootPath);
    const vault = await ensureVaultForRoot(state, rootPath, workspaceName);
    const workspace = {
      id: id('workspace'),
      spaceId: requestedSpaceId,
      name: workspaceName,
      rootPath,
      vaultId: vault.id,
      environment: 'local',
      activeThreadId: null,
      archivedAt: null,
      pinnedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    const thread = createThreadRecord({
      spaceId: workspace.spaceId,
      workspaceId: workspace.id,
      title: workspace.name,
      vaultId: vault.id,
      selectedAgents: Array.from(new Set([defaultAgentId, 'max'].filter(Boolean))),
      mode: 'workspace',
      primaryAgentId: defaultAgentId,
      defaultAgentId,
      agents: state.agents,
      intro: `项目已创建，项目目录是 ${rootPath}。后续产物和文件改动只会写入这个文件夹。`,
    });
    workspace.activeThreadId = thread.id;
    state.workspaces.push(workspace);
    state.threads.unshift(thread);
    state.defaultVaultId = vault.id;
    if (requestedSpaceId) state.ui.activeSpaceId = requestedSpaceId;
    await writeState(state);
    captureTelemetry('project_created', { mode });
    captureMeaningfulActivity('project_created');
    res.json({ workspace: publicWorkspace(workspace, state), vault: publicVault(vault), thread });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.patch('/api/workspaces/:id', async (req, res) => {
  const state = await readState();
  const workspace = state.workspaces.find((item) => item.id === req.params.id);
  if (!workspace) return res.status(404).json({ error: 'Workspace 不存在。' });
  if ('name' in req.body) workspace.name = String(req.body.name || workspace.name).slice(0, 60);
  if ('archived' in req.body) workspace.archivedAt = req.body.archived ? now() : null;
  if ('pinned' in req.body) workspace.pinnedAt = req.body.pinned ? now() : null;
  workspace.updatedAt = now();
  await writeState(state);
  res.json({ workspace: publicWorkspace(workspace, state) });
});

app.delete('/api/workspaces/:id', async (req, res) => {
  const state = await readState();
  const workspace = state.workspaces.find((item) => item.id === req.params.id);
  if (!workspace) return res.status(404).json({ error: 'Workspace 不存在。' });
  const deletedThreadIds = state.threads.filter((thread) => thread.workspaceId === workspace.id).map((thread) => thread.id);
  state.threads = state.threads.filter((thread) => thread.workspaceId !== workspace.id);
  state.workspaces = state.workspaces.filter((item) => item.id !== workspace.id);
  if (state.defaultVaultId === workspace.vaultId) state.defaultVaultId = state.vaults.find((vault) => state.workspaces.some((item) => item.vaultId === vault.id))?.id || state.vaults[0]?.id || null;
  await writeState(state);
  await attachmentStore.removeForThreads(deletedThreadIds);
  res.json({ ok: true, deletedWorkspaceId: workspace.id, deletedThreadIds });
});

app.get('/api/conversations', async (_req, res) => {
  const state = await readState();
  await healStaleRunningThreads(state);
  const conversations = state.threads
    .filter((thread) => thread.mode === 'direct' && !thread.archivedAt)
    .sort(sortPinnedThenUpdated)
    .map((thread) => summarizeThread(thread, state));
  res.json({ conversations });
});

app.get('/api/threads/archived', async (_req, res) => {
  const state = await readState();
  const threads = state.threads
    .filter((thread) => thread.archivedAt)
    .sort((a, b) => String(b.archivedAt || '').localeCompare(String(a.archivedAt || '')))
    .map((thread) => summarizeThread(thread, state));
  res.json({ threads });
});

app.post('/api/conversations', async (req, res) => {
  const state = await readState();
  const defaultAgentId = resolveDefaultAgentId(state);
  const spaceId = state.spaces.some((space) => space.id === req.body?.spaceId && !space.archivedAt) ? req.body.spaceId : state.ui.activeSpaceId || state.spaces[0]?.id || null;
  const primaryAgentId = state.agents.some((agent) => agent.id === req.body?.primaryAgentId) ? req.body.primaryAgentId : defaultAgentId;
  const primaryAgent = state.agents.find((agent) => agent.id === primaryAgentId);
  const selectedAgents = Array.from(new Set([primaryAgentId || defaultAgentId].filter(Boolean)));
  const agentModelOverrides = normalizeAgentModelOverrides(req.body?.agentModelOverrides, state.agents, state.models);
  const agentRunOverrides = normalizeAgentRunOverrides(req.body?.agentRunOverrides, state.agents);
  const thread = createThreadRecord({
    spaceId,
    workspaceId: null,
    title: String(req.body?.title || (primaryAgent ? `${primaryAgent.name} 对话` : '新的对话')).slice(0, 60),
    vaultId: null,
    selectedAgents,
    agentModelOverrides,
    agentRunOverrides,
    mode: 'direct',
    primaryAgentId,
    defaultAgentId: primaryAgentId,
    agents: state.agents,
    intro: primaryAgent ? `已开启临时对话，当前默认 Agent 是 ${primaryAgent.name}。需要更多成员时，直接 @Agent。` : '已开启临时对话。需要某个 Agent 参与时，直接 @Agent。',
  });
  state.threads.unshift(thread);
  if (spaceId) state.ui.activeSpaceId = spaceId;
  await writeState(state);
  captureTelemetry('conversation_created', { kind: 'direct' });
  captureMeaningfulActivity('conversation_created');
  res.json({ thread, conversation: summarizeThread(thread, state) });
});

app.get('/api/workspaces/:id/threads', async (req, res) => {
  const state = await readState();
  await healStaleRunningThreads(state);
  const threads = state.threads
    .filter((thread) => thread.workspaceId === req.params.id && thread.mode !== 'direct' && !thread.archivedAt)
    .sort(sortPinnedThenUpdated)
    .map((thread) => summarizeThread(thread, state));
  res.json({ threads });
});

app.get('/api/workspaces/:id/artifacts', async (req, res) => {
  try {
    const state = await readState();
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace 不存在。' });
    const artifacts = await collectWorkspaceArtifacts(workspace.rootPath);
    res.json({ artifacts });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.get('/api/workspaces/:id/files', async (req, res) => {
  try {
    const state = await readState();
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace 不存在。' });
    const entries = await listWorkspaceFiles(workspace.rootPath, String(req.query.dir || ''));
    res.json({ rootPath: workspace.rootPath, dir: String(req.query.dir || ''), entries });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.get('/api/workspaces/:id/files/content', async (req, res) => {
  try {
    const state = await readState();
    const workspace = state.workspaces.find((item) => item.id === req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace 不存在。' });
    const file = await readWorkspaceFileContent(workspace.rootPath, String(req.query.path || ''));
    res.json({ file });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

app.post('/api/workspaces/:id/threads', async (req, res) => {
  const state = await readState();
  const workspace = state.workspaces.find((item) => item.id === req.params.id);
  if (!workspace) return res.status(404).json({ error: 'Workspace 不存在。' });
  const defaultAgentId = resolveDefaultAgentId(state);
  const vaultId = workspace.vaultId || null;
  const thread = createThreadRecord({
    spaceId: workspace.spaceId || state.ui.activeSpaceId || state.spaces[0]?.id || null,
    workspaceId: workspace.id,
    title: String(req.body?.title || '新的团队议事').slice(0, 40),
    vaultId,
    selectedAgents: Array.from(new Set([defaultAgentId, 'max'].filter(Boolean))),
    agentModelOverrides: normalizeAgentModelOverrides(req.body?.agentModelOverrides, state.agents, state.models),
    agentRunOverrides: normalizeAgentRunOverrides(req.body?.agentRunOverrides, state.agents),
    mode: 'workspace',
    primaryAgentId: defaultAgentId,
    defaultAgentId,
    agents: state.agents,
    intro: `新项目对话已创建。项目目录是 ${workspace.rootPath}，自动写入会限制在这个文件夹内。`,
  });
  state.threads.unshift(thread);
  workspace.activeThreadId = thread.id;
  workspace.updatedAt = now();
  if (thread.spaceId) state.ui.activeSpaceId = thread.spaceId;
  await writeState(state);
  captureTelemetry('conversation_created', { kind: 'workspace' });
  captureMeaningfulActivity('conversation_created');
  res.json({ thread });
});

app.get('/api/threads/:id', async (req, res) => {
  const state = await readState();
  await healStaleRunningThreads(state);
  const thread = state.threads.find((item) => item.id === req.params.id);
  if (!thread) return res.status(404).json({ error: '会话不存在。' });
  res.json({ thread });
});

app.patch('/api/threads/:id', async (req, res) => {
  const state = await readState();
  const thread = state.threads.find((item) => item.id === req.params.id);
  if (!thread) return res.status(404).json({ error: '会话不存在。' });
  if ('title' in req.body) thread.title = String(req.body.title || thread.title).slice(0, 60);
  if ('vaultId' in req.body && thread.mode !== 'workspace') thread.vaultId = req.body.vaultId || null;
  if (Array.isArray(req.body.selectedAgents)) thread.selectedAgents = req.body.selectedAgents;
  if ('agentModelOverrides' in req.body) thread.agentModelOverrides = normalizeAgentModelOverrides(req.body.agentModelOverrides, state.agents, state.models);
  if ('agentRunOverrides' in req.body) thread.agentRunOverrides = normalizeAgentRunOverrides(req.body.agentRunOverrides, state.agents);
  if ('mode' in req.body && ['workspace', 'direct'].includes(req.body.mode)) thread.mode = req.body.mode;
  if ('primaryAgentId' in req.body && state.agents.some((agent) => agent.id === req.body.primaryAgentId)) thread.primaryAgentId = req.body.primaryAgentId;
  if ('defaultAgentId' in req.body && state.agents.some((agent) => agent.id === req.body.defaultAgentId)) thread.defaultAgentId = req.body.defaultAgentId;
  if ('activeAgentId' in req.body && state.agents.some((agent) => agent.id === req.body.activeAgentId)) thread.activeAgentId = req.body.activeAgentId;
  if ('followMode' in req.body && ['default', 'conversation'].includes(req.body.followMode)) thread.followMode = req.body.followMode;
  if ('permissionMode' in req.body && ['manual', 'smart', 'off'].includes(req.body.permissionMode)) thread.permissionMode = req.body.permissionMode;
  if ('archived' in req.body) thread.archivedAt = req.body.archived ? now() : null;
  if ('pinned' in req.body) thread.pinnedAt = req.body.pinned ? now() : null;
  thread.collaboration = normalizeCollaboration({ ...(thread.collaboration || {}), activeAgentId: thread.activeAgentId }, { defaultAgentId: thread.defaultAgentId });
  thread.updatedAt = now();
  if (thread.workspaceId && 'archived' in req.body) {
    const workspace = state.workspaces.find((item) => item.id === thread.workspaceId);
    if (workspace?.activeThreadId === thread.id && thread.archivedAt) {
      const nextThread = state.threads
        .filter((item) => item.workspaceId === thread.workspaceId && item.id !== thread.id && item.mode !== 'direct' && !item.archivedAt)
        .sort(sortPinnedThenUpdated)[0] || null;
      workspace.activeThreadId = nextThread?.id || null;
      workspace.updatedAt = now();
    } else if (workspace && !thread.archivedAt && !workspace.activeThreadId) {
      workspace.activeThreadId = thread.id;
      workspace.updatedAt = now();
    }
  }
  await writeState(state);
  res.json({ thread });
});

app.delete('/api/threads/:id', async (req, res) => {
  const state = await readState();
  const thread = state.threads.find((item) => item.id === req.params.id);
  if (!thread) return res.status(404).json({ error: '会话不存在。' });
  state.threads = state.threads.filter((item) => item.id !== thread.id);
  let nextThread = null;
  if (thread.workspaceId) {
    const workspace = state.workspaces.find((item) => item.id === thread.workspaceId);
    const remaining = state.threads
      .filter((item) => item.workspaceId === thread.workspaceId && item.mode !== 'direct' && !item.archivedAt)
      .sort(sortPinnedThenUpdated);
    nextThread = remaining[0] || null;
    if (workspace) {
      workspace.activeThreadId = nextThread?.id || null;
      workspace.updatedAt = now();
    }
  } else {
    nextThread = state.threads
      .filter((item) => item.mode === 'direct' && !item.archivedAt)
      .sort(sortPinnedThenUpdated)[0] || null;
  }
  await writeState(state);
  await attachmentStore.removeForThreads([thread.id]);
  res.json({ ok: true, deletedThreadId: thread.id, nextThreadId: nextThread?.id || null, nextThread: nextThread ? summarizeThread(nextThread, state) : null });
});

app.post('/api/threads/:id/convert-to-workspace', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return res.status(404).json({ error: '会话不存在。' });
    if (thread.mode === 'workspace' && thread.workspaceId) {
      const workspace = state.workspaces.find((item) => item.id === thread.workspaceId);
      return res.json({ workspace: workspace ? publicWorkspace(workspace, state) : null, thread });
    }
    const name = String(req.body?.name || thread.title || '').trim().slice(0, 60);
    const mode = req.body?.mode === 'existing' ? 'existing' : 'create';
    const requestedSpaceId = state.spaces.some((space) => space.id === req.body?.spaceId && !space.archivedAt) ? req.body.spaceId : thread.spaceId || state.ui.activeSpaceId || state.spaces[0]?.id || null;
    if (mode === 'create' && !name) return res.status(400).json({ error: '项目名称不能为空。' });
    if (mode === 'existing' && !String(req.body?.rootPath || '').trim()) return res.status(400).json({ error: '请选择或输入已有文件夹路径。' });
    const parentPath = await ensureDirectory(req.body?.parentPath || defaultProjectsRoot);
    const requestedRoot = mode === 'existing'
      ? String(req.body?.rootPath || '').trim()
      : path.join(parentPath, slug(name) || 'new-project');
    const rootPath = await ensureDirectory(requestedRoot);
    const existingWorkspace = state.workspaces.find((workspace) => path.resolve(workspace.rootPath) === rootPath);
    if (existingWorkspace) {
      existingWorkspace.spaceId = existingWorkspace.spaceId || requestedSpaceId;
      thread.spaceId = existingWorkspace.spaceId || requestedSpaceId;
      thread.workspaceId = existingWorkspace.id;
      thread.mode = 'workspace';
      thread.vaultId = existingWorkspace.vaultId || null;
      existingWorkspace.archivedAt = null;
      existingWorkspace.activeThreadId = thread.id;
      existingWorkspace.updatedAt = now();
      thread.updatedAt = now();
      thread.messages = [...thread.messages, { id: id('msg'), agentId: 'system', agentName: 'Frakio Work', role: 'System', content: `临时对话已转为项目：${existingWorkspace.name}。项目目录是 ${existingWorkspace.rootPath}。` }];
      await writeState(state);
      return res.json({ workspace: publicWorkspace(existingWorkspace, state), thread });
    }
    const workspaceName = name || vaultNameFromPath(rootPath);
    const vault = await ensureVaultForRoot(state, rootPath, workspaceName);
    const workspace = {
      id: id('workspace'),
      spaceId: requestedSpaceId,
      name: workspaceName,
      rootPath,
      vaultId: vault.id,
      environment: 'local',
      activeThreadId: thread.id,
      archivedAt: null,
      pinnedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    thread.workspaceId = workspace.id;
    thread.spaceId = workspace.spaceId;
    thread.mode = 'workspace';
    thread.vaultId = vault.id;
    thread.updatedAt = now();
    thread.messages = [...thread.messages, { id: id('msg'), agentId: 'system', agentName: 'Frakio Work', role: 'System', content: `临时对话已转为项目：${workspace.name}。项目目录是 ${workspace.rootPath}。` }];
    state.workspaces.push(workspace);
    state.defaultVaultId = vault.id;
    if (workspace.spaceId) state.ui.activeSpaceId = workspace.spaceId;
    await writeState(state);
    res.json({ workspace: publicWorkspace(workspace, state), vault: publicVault(vault), thread });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error?.message || error) });
  }
});

function createThreadRecord({ spaceId, workspaceId, title, vaultId, selectedAgents, agentModelOverrides = {}, agentRunOverrides = {}, mode, primaryAgentId, defaultAgentId, followMode = 'default', intro, agents = [] }) {
  const threadDefaultAgentId = defaultAgentId || primaryAgentId || selectedAgents?.[0] || 'iris';
  const introAgent = agents.find((agent) => agent.id === threadDefaultAgentId) || agents.find((agent) => agent.id === 'iris') || { id: 'iris', name: 'Iris', role: '书记官 / 默认入口' };
  return {
    id: id('thread'),
    spaceId: spaceId || null,
    workspaceId,
    mode,
    primaryAgentId: primaryAgentId || threadDefaultAgentId,
    defaultAgentId: threadDefaultAgentId,
    activeAgentId: threadDefaultAgentId,
    followMode: followMode === 'conversation' ? 'conversation' : 'default',
    title,
    vaultId,
    selectedAgents,
    agentModelOverrides,
    agentRunOverrides,
    permissionMode: 'manual',
    archivedAt: null,
    pinnedAt: null,
    updatedAt: now(),
    workflow: [],
    workflowState: [],
    proposals: [],
    artifacts: [],
    contextPacket: null,
    collaboration: normalizeCollaboration({ kind: mode === 'workspace' ? 'workspace-group-chat' : 'direct-chat', activeAgentId: threadDefaultAgentId }, { defaultAgentId: threadDefaultAgentId }),
    messages: [
      { id: id('msg'), agentId: introAgent.id, agentName: introAgent.name, role: introAgent.role, content: intro },
    ],
    engine: 'simulate',
    externalSessionId: null,
    runStatus: 'idle',
  };
}

function summarizeThread(thread, state) {
  const vault = state.vaults.find((item) => item.id === thread.vaultId);
  const workspace = state.workspaces.find((item) => item.id === thread.workspaceId);
  const primaryAgent = state.agents.find((agent) => agent.id === thread.primaryAgentId);
  const validAgentIds = new Set(state.agents.map((agent) => agent.id));
  const participantAgentIds = [...new Set([
    thread.defaultAgentId,
    thread.activeAgentId,
    ...(Array.isArray(thread.selectedAgents) ? thread.selectedAgents : []),
    thread.primaryAgentId,
  ].filter((agentId) => agentId && validAgentIds.has(agentId)))];
  const last = thread.messages.at(-1);
  return {
    id: thread.id,
    title: thread.title,
    spaceId: thread.spaceId || null,
    workspaceId: thread.workspaceId || null,
    workspaceRootPath: workspace?.rootPath || '',
    mode: thread.mode || 'workspace',
    primaryAgentId: thread.primaryAgentId || null,
    defaultAgentId: thread.defaultAgentId || null,
    activeAgentId: thread.activeAgentId || null,
    participantAgentIds,
    followMode: thread.followMode || 'default',
    primaryAgentName: primaryAgent?.name || '',
    permissionMode: thread.permissionMode || 'manual',
    agentModelOverrides: thread.agentModelOverrides || {},
    agentRunOverrides: thread.agentRunOverrides || {},
    vaultId: thread.vaultId,
    vaultName: vault?.name || '未连接资料库',
    updatedAt: thread.updatedAt,
    preview: last?.content?.slice(0, 80) || '',
    engine: thread.engine || 'simulate',
    artifactCount: Array.isArray(thread.artifacts) ? thread.artifacts.length : 0,
    lastArtifactName: Array.isArray(thread.artifacts) ? thread.artifacts[0]?.name || '' : '',
    workflowState: shouldKeepWorkflowForThread(thread) ? thread.workflowState : [],
    runStatus: thread.runStatus || 'idle',
    archivedAt: thread.archivedAt || null,
    pinnedAt: thread.pinnedAt || null,
  };
}

function workflowStateFromWorkflow(workflow = workflows.council, runStatus = 'idle', activeIndex = -1) {
  const items = Array.isArray(workflow) && workflow.length ? workflow : workflows.council;
  const completedIndex = runStatus === 'idle' ? items.length - 1 : Math.max(0, activeIndex - 1);
  return items.map((title, index) => ({
    title,
    status: runStatus === 'running' && index === activeIndex ? 'running' : index <= completedIndex ? 'completed' : 'pending',
    source: 'simulation',
    updatedAt: now(),
  }));
}

function isDefaultCouncilWorkflow(workflow = []) {
  return Array.isArray(workflow) && workflow.join('\u0000') === defaultCouncilWorkflowSignature;
}

function shouldKeepWorkflowForThread(thread) {
  if (!Array.isArray(thread?.workflowState) || !thread.workflowState.length) return false;
  if (!isDefaultCouncilWorkflow(thread.workflow || [])) return true;
  return thread.workflowState.some((step) => step?.source || step?.detail || step?.agentName);
}

function taskStepsForMessage(taskType, message, status = 'completed') {
  const source = 'run';
  const taskHints = {
    council: [
      '理解用户意图',
      '选择响应 Agent',
      '生成回复',
    ],
    knowledge: [
      '检索资料库',
      '筛选相关来源',
      '生成带来源回答',
    ],
  };
  const steps = taskHints[taskType] || taskHints.council;
  const hasSubstantiveTask = taskType !== 'council' || /检查|优化|生成|执行|创建|写|整理|分析|计划|方案|项目|文件|任务|调研|搜索|读取|改|修|review|build|create|write|analy/i.test(message);
  if (!hasSubstantiveTask) return [];
  return steps.map((title, index) => ({
    title,
    status,
    source,
    detail: index === 0 ? String(message || '').slice(0, 80) : '',
    updatedAt: now(),
  }));
}

function detectTaskType(_message) {
  return 'council';
}

function isAllAgentsMentioned(message) {
  return isMentionNamePresent(message, 'all');
}

function matchMentionedAgents(message, agents, selectedAgentIds = [], fallbackAgentId = '') {
  return resolveMentionedAgents(message, agents, { selectedAgentIds, fallbackAgentId });
}

function agentEvent(agent, content, extra = {}) {
  return {
    id: id('msg'),
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    content,
    ...extra,
  };
}

function resolveThreadDefaultAgent(state, thread) {
  const fallbackId = resolveDefaultAgentId(state);
  return state.agents.find((agent) => agent.id === thread?.defaultAgentId)
    || state.agents.find((agent) => agent.id === thread?.primaryAgentId)
    || state.agents.find((agent) => agent.id === fallbackId)
    || state.agents[0]
    || null;
}

function resolveRunTargetAgent(state, thread, targetAgentId, selectedAgents = []) {
  const cleanTargetAgentId = String(targetAgentId || '').trim();
  if (cleanTargetAgentId) {
    const targetAgent = state.agents.find((agent) => agent.id === cleanTargetAgentId);
    if (!targetAgent) {
      const error = new Error('目标 Agent 不存在。');
      error.status = 400;
      throw error;
    }
    return targetAgent;
  }
  return selectedAgents[0] || resolveThreadDefaultAgent(state, thread) || state.agents[0] || null;
}

async function resolveThreadRunModelConfig(state, thread, agent, profileName) {
  const overrides = normalizeAgentModelOverrides(thread?.agentModelOverrides || {}, state.agents, state.models);
  const override = agent?.id ? overrides[agent.id] : '';
  if (override) {
    const { selectedModel, selectedName } = resolveModelSelection(override, state.models || []);
    if (selectedModel) {
      const materialized = await ensureModelProviderForProfile(profileName, selectedModel, selectedName, state.models || [], { setDefault: false });
      return { model: materialized.model, provider: materialized.provider, source: 'thread', modelProfile: selectedModel };
    }
  }
  const config = await readYamlFile(profileConfigPath(profileName));
  const provider = String(config?.model?.provider || config?.provider || '').trim();
  const model = String(config?.model?.default || (typeof config?.model === 'string' ? config.model : '') || '').trim();
  if (model) {
    const profileModels = normalizeModels(state.models || []).filter((item) => item.providerKey === provider && normalizeModelNames(item.models, item.model).includes(model));
    if (profileModels.length === 1) {
      const materialized = await ensureModelProviderForProfile(profileName, profileModels[0], model, state.models || [], { setDefault: false });
      return { model: materialized.model, provider: materialized.provider, source: 'profile', modelProfile: profileModels[0] };
    }
    if (providerPresetByKey(provider)) {
      throw configValidationError(`${providerPresetByKey(provider)?.label || providerLabel(provider)} 尚未配置 API Key。`);
    }
    return { model, provider, source: 'profile', modelProfile: null };
  }
  const fallbackValue = agent?.model || state.ui?.defaultModel || state.models?.[0]?.id || state.models?.[0]?.model || '';
  const fallback = resolveModelSelection(fallbackValue, state.models || []);
  if (fallback.selectedModel) {
    const materialized = await ensureModelProviderForProfile(profileName, fallback.selectedModel, fallback.selectedName, state.models || [], { setDefault: true });
    if (agent && !agent.model) agent.model = fallback.selectedName;
    return { model: materialized.model, provider: materialized.provider, source: 'agent', modelProfile: fallback.selectedModel };
  }
  return { model: '', provider: '', source: 'profile', modelProfile: null };
}

async function resolveHermesProfileNameForAgent(agent) {
  const profiles = await readHermesProfiles();
  if (agent?.profileName) {
    if (profiles.some((profile) => profile.name === agent.profileName)) return agent.profileName;
    const error = new Error(`Agent Profile「${agent.profileName}」配置缺失。`);
    error.status = 409;
    error.code = 'agent_profile_missing';
    throw error;
  }
  if (agent?.id && profiles.some((profile) => profile.name === agent.id)) return agent.id;
  const normalizedName = String(agent?.name || '').trim().toLowerCase();
  const byName = profiles.find((profile) => profile.name.toLowerCase() === normalizedName);
  if (byName) return byName.name;
  return profiles.some((profile) => profile.name === 'default') ? 'default' : profiles[0]?.name || 'default';
}

function resolveInitialRoomAgent(state, thread, message, collaboration, selectedAgentIds = []) {
  const defaultAgent = resolveThreadDefaultAgent(state, thread);
  const mentionedAgents = matchMentionedAgents(message, state.agents, selectedAgentIds, defaultAgent?.id || resolveDefaultAgentId(state));
  if (mentionedAgents.length) return { agent: mentionedAgents[0], mentionedAgents, reason: 'user_mention' };
  if (thread?.followMode === 'conversation' && thread?.activeAgentId) {
    const activeAgent = state.agents.find((agent) => agent.id === thread.activeAgentId);
    if (activeAgent) return { agent: activeAgent, mentionedAgents, reason: 'conversation_follow' };
  }
  if (thread?.followMode === 'conversation' && collaboration?.activeAgentId) {
    const activeAgent = state.agents.find((agent) => agent.id === collaboration.activeAgentId);
    if (activeAgent) return { agent: activeAgent, mentionedAgents, reason: 'conversation_follow' };
  }
  return { agent: defaultAgent, mentionedAgents, reason: 'default_agent' };
}

async function runCouncilSimulation(req, res, options = {}) {
  const state = await readState();
  const message = String(req.body?.message || '').trim();
  const thread = state.threads.find((item) => item.id === req.body?.threadId) || state.threads[0];
  const selected = Array.isArray(req.body?.selectedAgents) ? req.body.selectedAgents : thread.selectedAgents || ['iris', 'max'];
  const vaultId = 'vaultId' in req.body ? req.body.vaultId : thread.vaultId;
  const vault = vaultId ? state.vaults.find((item) => item.id === vaultId) : null;
  const summary = vault?.index ? summaryFromVault(vault) : null;

  const mentionedAgents = matchMentionedAgents(message, state.agents, selected, resolveDefaultAgentId(state));
  const activeAgentIds = Array.from(
    new Set([
      'iris',
      ...(thread.mode === 'direct' ? [] : ['max']),
      ...selected,
      ...mentionedAgents.map((a) => a.id),
    ]),
  );

  const taskType = detectTaskType(message);

  const activeAgents = state.agents.filter((agent) => activeAgentIds.includes(agent.id));
  const userMessage = { id: id('msg'), agentId: 'user', agentName: '你', role: 'Workspace Owner', content: message };
  const events = activeAgents.map((agent, index) => ({
    id: `${Date.now()}-${agent.id}-${index}`,
    agentId: agent.id,
    agentName: agent.name,
    role: agent.role,
    content: buildAgentReply(agent.id, message, taskType, summary),
  }));
  const internalNotice = options.notice || '';

  const proposals = [
    {
      id: id('proposal'),
      type: 'task_report',
      title: '生成运行记录',
      risk: 'low',
      target: '当前对话',
      status: 'needs_review',
    },
  ];

  const contextPacket = compressContext(message, [...thread.messages.slice(-8), userMessage, ...events], summary, selected);
  const runSteps = taskStepsForMessage(taskType, message, options.runStatus === 'running' ? 'running' : 'completed');
  Object.assign(thread, {
    vaultId: vaultId || null,
    selectedAgents: activeAgentIds,
    updatedAt: now(),
    workflow: runSteps.map((step) => step.title),
    workflowState: runSteps,
    proposals,
    artifacts: artifactsFromThreadOutputs(taskType, proposals, thread),
    contextPacket,
    messages: [...thread.messages, userMessage, ...events],
    engine: options.engine || 'simulate',
    externalSessionId: options.externalSessionId || thread.externalSessionId || null,
    runStatus: options.runStatus || 'idle',
  });

  if (thread.title === '新的团队议事' || thread.title === '新的对话' || thread.title === 'Frakio 博客优化') thread.title = message.slice(0, 24) || thread.title;
  await writeState(state);

  res.json({ taskType, thread, contextPacket, events, proposals, workflow: workflows[taskType], vaultSummary: summary, notice: internalNotice });
}

app.post('/api/council/simulate', async (req, res) => {
  await runCouncilSimulation(req, res);
});

async function runAgentRoomChat(req, res) {
  const state = await readState();
  const message = String(req.body?.message || '').trim();
  const thread = state.threads.find((item) => item.id === req.body?.threadId) || state.threads[0];
  if (!thread) return res.status(404).json({ error: '会话不存在。' });
  const selected = Array.isArray(req.body?.selectedAgents) ? req.body.selectedAgents : thread.selectedAgents || [resolveDefaultAgentId(state)];
  const vaultId = 'vaultId' in req.body ? req.body.vaultId : thread.vaultId;
  const vault = vaultId ? state.vaults.find((item) => item.id === vaultId) : null;
  const summary = vault?.index ? summaryFromVault(vault) : null;
  const taskType = detectTaskType(message);
  const collaboration = normalizeCollaboration(thread.collaboration, { defaultAgentId: thread.defaultAgentId, activeAgentId: thread.activeAgentId });
  const initialRoute = resolveInitialRoomAgent(state, thread, message, collaboration, selected);
  const activeAgentIds = Array.from(new Set([
    ...selected,
    initialRoute.agent?.id,
    ...initialRoute.mentionedAgents.map((agent) => agent.id),
  ].filter(Boolean))).filter((agentId) => state.agents.some((agent) => agent.id === agentId));
  const userMessage = { id: id('msg'), agentId: 'user', agentName: '你', role: 'Workspace Owner', content: message };
  const workflow = workflows[taskType] || workflows.council;
  const runSteps = taskStepsForMessage(taskType, message);
  const events = [];
  let engine = 'workspace-group';
  let providerNotice = '';
  const turnId = id('turn');
  const maxMentionDepth = normalizeAgentMentionMaxDepth(state.ui?.agentMentionMaxDepth, 2);
  const routedEdges = new Set();
  let totalRoutedRuns = 0;
  let routeLimitReached = false;

  async function invokeAgent(agent, prompt, routeLabel = '', mentionDepth = 0, parentMessageId = userMessage.id, routeReason = initialRoute.reason) {
    if (!agent || totalRoutedRuns >= 64) {
      routeLimitReached = true;
      return null;
    }
    totalRoutedRuns += 1;
    let event;
    try {
      const reply = await runConfiguredModelChat(state, { ...thread, messages: [...thread.messages, userMessage, ...events] }, prompt, [agent.id]);
      event = agentEvent(agent, reply.content, { role: `${agent.role}${routeLabel} / ${reply.provider} / ${reply.modelId}`, turnId, mentionDepth, parentMessageId, routeReason });
    } catch (error) {
      providerNotice ||= String(error?.message || error);
      event = agentEvent(agent, buildAgentReply(agent.id, prompt, taskType, summary), { role: `${agent.role}${routeLabel}`, turnId, mentionDepth, parentMessageId, routeReason });
      engine = 'simulate';
    }
    events.push(event);
    if (!activeAgentIds.includes(agent.id)) activeAgentIds.push(agent.id);
    return event;
  }

  const initialAgents = initialRoute.mentionedAgents.length ? initialRoute.mentionedAgents : [initialRoute.agent].filter(Boolean);
  let currentWave = (await Promise.all(initialAgents.map((agent) => invokeAgent(agent, message)))).filter(Boolean);
  let handoffDepth = 1;
  while (currentWave.length && mentionDepthAllows(handoffDepth, maxMentionDepth) && totalRoutedRuns < 64) {
    const nextByAgentId = new Map();
    for (const sourceEvent of currentWave) {
      const targets = resolveMentionedAgents(sourceEvent.content, state.agents, {
        senderAgentId: sourceEvent.agentId,
        selectedAgentIds: activeAgentIds,
        fallbackAgentId: resolveDefaultAgentId(state),
      });
      for (const target of targets) {
        if (!registerMentionEdge(routedEdges, sourceEvent.agentId, target.id)) continue;
        nextByAgentId.set(target.id, { target, sourceEvent });
      }
    }
    if (!nextByAgentId.size) break;
    currentWave = (await Promise.all([...nextByAgentId.values()].map(({ target, sourceEvent }) => {
      const routedText = stripMentionRoutingTokens(sourceEvent.content, target) || sourceEvent.content;
      const relayMessage = `群聊系统：${sourceEvent.agentName} 在对话中提及了你（${target.name}），请基于当前上下文直接回复。\n\n原始消息：${routedText}`;
      return invokeAgent(target, relayMessage, ' / agent @ routing', handoffDepth, sourceEvent.id, 'agent_mention');
    }))).filter(Boolean);
    handoffDepth += 1;
  }
  if (totalRoutedRuns >= 64) routeLimitReached = true;
  if (routeLimitReached) {
    events.push({ id: id('msg'), agentId: 'system', agentName: '系统', role: 'System', content: '本轮 Agent @ 路由已达到 64 次安全上限，后续提及已停止。', turnId, routeReason: 'mention_limit' });
  }

  const proposals = [
    {
      id: id('proposal'),
      type: 'task_report',
      title: '生成运行记录',
      risk: 'low',
      target: '当前对话',
      status: 'needs_review',
    },
  ];
  const artifacts = artifactsFromThreadOutputs(taskType, proposals, thread);
  const contextPacket = compressContext(message, [...thread.messages.slice(-8), userMessage, ...events], summary, activeAgentIds);
  const lastRespondingAgent = events.length ? state.agents.find((agent) => agent.id === events.at(-1)?.agentId) : initialRoute.agent;
  const nextActiveAgent = thread.followMode === 'conversation' ? (lastRespondingAgent || initialRoute.agent) : resolveThreadDefaultAgent(state, thread);
  const lastMentioned = initialRoute.mentionedAgents[0] || (lastRespondingAgent?.id !== initialRoute.agent?.id ? lastRespondingAgent : null);
  Object.assign(thread, {
    vaultId: vaultId || null,
    selectedAgents: activeAgentIds,
    primaryAgentId: thread.primaryAgentId || resolveThreadDefaultAgent(state, thread)?.id || null,
    defaultAgentId: thread.defaultAgentId || resolveDefaultAgentId(state),
    activeAgentId: nextActiveAgent?.id || thread.activeAgentId || thread.defaultAgentId || null,
    updatedAt: now(),
    workflow: runSteps.map((step) => step.title),
    workflowState: runSteps,
    proposals,
    artifacts,
    contextPacket,
    messages: [...thread.messages, userMessage, ...events],
    engine,
    externalSessionId: thread.externalSessionId || null,
    providerError: providerNotice || '',
    collaboration: normalizeCollaboration({
      ...collaboration,
      maxMentionDepth,
      activeAgentId: nextActiveAgent?.id || collaboration.activeAgentId,
      lastMentionedAgentId: lastMentioned?.id || collaboration.lastMentionedAgentId,
      lastMentionedAgentName: lastMentioned?.name || collaboration.lastMentionedAgentName,
      lastRoutedAt: now(),
      lastRouteReason: initialRoute.reason,
    }),
    runStatus: 'idle',
  });

  if (thread.title === '新的团队议事' || thread.title === '新的对话' || thread.title === 'Frakio 博客优化') thread.title = message.slice(0, 24) || thread.title;
  await writeState(state);
  res.json({ taskType, turnId, thread, contextPacket, events, proposals, workflow, vaultSummary: summary, notice: providerNotice ? `${providerNotice}。已回退到本地 Agent 编排。` : '' });
}

async function threadHistoryForHermes(thread, targetAgent = null) {
  const messages = (thread.messages || [])
    .filter((message) => message.agentId !== 'system' && (message.content || message.attachments?.length))
    .slice(-20);
  return Promise.all(messages.map(async (message) => {
    const attachments = await Promise.all((message.attachments || []).map(async (attachment) => {
      try {
        const { filePath } = await attachmentStore.content(attachment.id);
        return { ...attachment, path: filePath };
      } catch {
        return attachment;
      }
    }));
    const storedContent = hermesStoredMessageContent(message.content, attachments);
    if (message.agentId === targetAgent?.id) return { role: 'assistant', content: storedContent };
    if (message.agentId === 'user') return { role: 'user', content: `[用户]\n${storedContent}` };
    return { role: 'user', content: `[Agent ${message.agentName || message.agentId || '未知'}]\n${storedContent}` };
  }));
}

function agentIdentityRunInstruction(agent, agents = []) {
  const roster = agents
    .filter((item) => item?.id && item.id !== agent?.id)
    .map((item) => `${item.name}（${item.role || 'Agent'}）`)
    .join('、');
  return [
    `群聊身份规则：你是 ${agent?.name || '当前 Agent'}（${agent?.role || 'Agent'}）。`,
    '只能以你自己的身份发言。不得替其他 Agent 写台词，不得使用“某某说：”模拟其他成员已经回复，也不得声称其他 Agent 已经在线或已经说过某句话。',
    '如果需要其他 Agent 接话，只输出一条简短交接，并在正文中写出准确的 @AgentName。系统会真正唤醒对方并以对方自己的头像发送独立消息。',
    `当前可交接成员：${roster || '无'}。`,
    '当用户用“叫/让/请某位 Agent 出来、回答、打招呼”等自然语言要求你召唤明确成员时，不要代答；请直接使用 @AgentName 交接。',
  ].join('\n');
}

function hermesAgentSessionId(thread, agentId) {
  return String(thread?.agentSessionIds?.[agentId] || `workbench-${thread.id}-${agentId}`);
}

function attachmentPromptLine(attachment) {
  return `[Attached ${attachment.kind || 'file'}: ${attachment.name} (${attachment.mimeType || 'application/octet-stream'}, ${attachment.size || 0} bytes) at ${attachment.path || attachment.contentUrl || ''}]`;
}

function hermesStoredMessageContent(content, attachments = []) {
  const text = String(content || '').trim();
  const lines = (attachments || []).map(attachmentPromptLine);
  return [text, ...lines].filter(Boolean).join('\n\n') || '请查看并处理这些附件。';
}

function trimLeadingBlankLines(text) {
  return String(text || '').replace(/^\s*\n+/, '').trimStart();
}

function stepFromHermesEvent(event) {
  const eventName = String(event?.event || '');
  if (eventName === 'tool.running') {
    return { title: event.title || event.label || event.toolName || event.tool || '正在调用工具', status: 'running', source: 'tool', detail: event.detail || toolStepDetail(event), updatedAt: now(), callId: event.callId || '' };
  }
  if (eventName === 'tool.completed') {
    return { title: event.title || event.label || event.toolName || event.tool || '工具调用完成', status: event.error ? 'failed' : 'completed', source: 'tool', detail: event.detail || toolStepDetail(event), updatedAt: now(), callId: event.callId || '' };
  }
  if (eventName === 'approval.request') {
    return { title: event.title || '等待用户确认', status: 'running', source: 'approval', detail: event.tool || event.command || '', updatedAt: now() };
  }
  if (eventName === 'clarify.request') {
    return { title: '等待你的选择', status: 'running', source: 'clarify', detail: event.question || '', updatedAt: now(), callId: event.clarifyId || '' };
  }
  if (eventName === 'clarify.responded') {
    return { title: '等待你的选择', status: 'completed', source: 'clarify', detail: event.skipped ? '用户已跳过' : '用户已回答', updatedAt: now(), callId: event.clarifyId || '' };
  }
  if (eventName === 'run.failed') return { title: event.error || '运行失败', status: 'failed', source: 'run', updatedAt: now() };
  if (eventName === 'run.completed') return { title: '生成最终回复', status: 'completed', source: 'run', updatedAt: now() };
  return null;
}

function mergeWorkflowStep(steps = [], nextStep) {
  if (!nextStep) return steps;
  const key = nextStep.callId ? `${nextStep.source || ''}:${nextStep.callId}` : `${nextStep.source || ''}:${nextStep.title}`;
  const index = steps.findIndex((step) => {
    const stepKey = step.callId ? `${step.source || ''}:${step.callId}` : `${step.source || ''}:${step.title}`;
    return stepKey === key;
  });
  if (index < 0) return [...steps, nextStep];
  return steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...nextStep } : step);
}

function toolStepDetail(event) {
  const parts = [];
  if (Array.isArray(event?.paths) && event.paths.length) parts.push(event.paths.slice(0, 3).join(' · '));
  if (event?.fileCount) parts.push(`${event.fileCount} 个文件`);
  if (event?.skillName) parts.push(event.skillName);
  if (event?.duration) parts.push(`${Math.round(Number(event.duration) * 10) / 10}s`);
  if (event?.resultPreview && !parts.length) parts.push(event.resultPreview);
  if (event?.argsPreview && !parts.length) parts.push(event.argsPreview);
  return parts.filter(Boolean).join(' · ');
}

function closeOpenWorkflowSteps(steps = [], status = 'completed') {
  return steps.map((step) => step?.status === 'running' ? { ...step, status, updatedAt: now() } : step);
}

function normalizeHermesRunEvent(event) {
  const name = String(event?.event || '');
  if (name === 'tool.started' || name === 'tool.running') {
    const display = toolDisplayFromEvent(event, '正在调用工具');
    return {
      event: 'tool.running',
      runId: event.run_id || '',
      tool: display.toolName || event.tool || '',
      ...display,
      timestamp: event.timestamp || Date.now() / 1000,
    };
  }
  if (name === 'tool.completed') {
    const display = toolDisplayFromEvent(event, '工具调用完成');
    return {
      event: 'tool.completed',
      runId: event.run_id || '',
      tool: display.toolName || event.tool || '',
      ...display,
      duration: event.duration || 0,
      error: Boolean(event.error),
      timestamp: event.timestamp || Date.now() / 1000,
    };
  }
  if (name === 'message.delta' || name === 'stream.delta') {
    return { event: 'message.delta', runId: event.run_id || '', delta: event.delta || '', timestamp: event.timestamp || Date.now() / 1000 };
  }
  if (name === 'thinking.delta' || name === 'reasoning.delta' || name === 'status') {
    return { event: 'agent.event', runId: event.run_id || '', title: event.title || event.status || event.message || '', detail: event.delta || event.detail || event.message || '', raw: event, timestamp: event.timestamp || Date.now() / 1000 };
  }
  if (name === 'approval.request' || name === 'approval.requested') {
    return {
      event: 'approval.request',
      runId: event.run_id || '',
      approvalId: event.approvalId || event.approval_id || event.id || '',
      title: event.title || event.description || '需要确认',
      command: event.command || event.command_preview || event.preview || '',
      cwd: event.cwd || '',
      tool: event.tool || event.tool_name || '',
      choices: event.choices || ['once', 'session', 'always', 'deny'],
      timestamp: event.timestamp || Date.now() / 1000,
    };
  }
  if (name === 'approval.responded' || name === 'approval.resolved') return { event: 'approval.responded', runId: event.run_id || '', approvalId: event.approvalId || event.approval_id || event.id || '', choice: event.choice || '', resolved: event.resolved, error: event.error || '', timestamp: event.timestamp || Date.now() / 1000 };
  if (name === 'clarify.request' || name === 'clarify.requested') {
    return {
      event: 'clarify.request',
      runId: event.run_id || '',
      clarifyId: event.clarifyId || event.clarify_id || event.id || '',
      question: event.question || event.title || '需要你补充一个选择',
      choices: Array.isArray(event.choices) ? event.choices.map((choice) => String(choice)).filter(Boolean) : [],
      timeoutMs: Number(event.timeoutMs || event.timeout_ms || 0) || undefined,
      timestamp: event.timestamp || Date.now() / 1000,
    };
  }
  if (name === 'clarify.responded' || name === 'clarify.resolved') return { event: 'clarify.responded', runId: event.run_id || '', clarifyId: event.clarifyId || event.clarify_id || event.id || '', skipped: Boolean(event.skipped), resolved: event.resolved, error: event.error || '', timestamp: event.timestamp || Date.now() / 1000 };
  if (name === 'run.completed') return { event: 'run.completed', runId: event.run_id || '', output: trimLeadingBlankLines(event.output || ''), usage: event.usage || {}, timestamp: event.timestamp || Date.now() / 1000 };
  if (name === 'run.failed') return { event: 'run.failed', runId: event.run_id || '', error: enrichMissingExecutableError(event.error || 'Hermes run failed', event.profile || event.profileName || 'default'), timestamp: event.timestamp || Date.now() / 1000 };
  if (name === 'run.cancelled') return { event: 'run.cancelled', runId: event.run_id || '', timestamp: event.timestamp || Date.now() / 1000 };
  return { event: name || 'run.event', runId: event?.run_id || '', raw: event, timestamp: event?.timestamp || Date.now() / 1000 };
}

function normalizeHermesBridgeChunkEvent(rawEvent) {
  const direct = normalizeHermesRunEvent(rawEvent);
  if (direct.event && direct.event !== 'run.event') return direct;
  const bridged = normalizeBridgeEvent(rawEvent);
  return bridged ? normalizeHermesRunEvent(bridged) : direct;
}

async function mergeHermesWorkflowEvent(threadId, event) {
  const nextStep = stepFromHermesEvent(event);
  if (!nextStep || event.event === 'run.completed') return;
  const state = await readState();
  const thread = state.threads.find((item) => item.id === threadId);
  if (!thread) return;
  thread.workflowState = mergeWorkflowStep(thread.workflowState || [], nextStep);
  thread.workflow = thread.workflowState.map((step) => step.title);
  thread.updatedAt = now();
  await writeState(state);
}

function writeHermesRunSse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function ensureModelRunDiagnostics(state) {
  state.observability = state.observability || { modelUsage: [], modelRuns: [], systemEvents: [] };
  state.observability.modelRuns = Array.isArray(state.observability.modelRuns) ? state.observability.modelRuns : [];
  return state.observability.modelRuns;
}

function appendModelRunDiagnostic(state, record) {
  const records = ensureModelRunDiagnostics(state);
  records.push(record);
  state.observability.modelRuns = records.slice(-200);
  return record;
}

function updateModelRunDiagnostic(state, { diagnosticId = '', runId = '', threadId = '' }, update) {
  const records = ensureModelRunDiagnostics(state);
  let index = diagnosticId ? records.findIndex((record) => record.id === diagnosticId) : -1;
  if (index < 0 && runId) index = records.findIndex((record) => record.runId === runId);
  if (index < 0 && threadId) {
    for (let cursor = records.length - 1; cursor >= 0; cursor -= 1) {
      if (records[cursor].threadId === threadId && ['starting', 'sent'].includes(records[cursor].status)) {
        index = cursor;
        break;
      }
    }
  }
  if (index < 0) return null;
  records[index] = update(records[index]);
  state.observability.modelRuns = records.slice(-200);
  return records[index];
}

function finishStoredModelRun(state, { diagnosticId = '', runId = '', threadId = '', status, usage = {}, error = '' }) {
  const completedAt = now();
  return updateModelRunDiagnostic(state, { diagnosticId, runId, threadId }, (record) => finishModelRunDiagnostic(record, { status, completedAt, usage, error }));
}

function clearHermesRunState(thread) {
  thread.activeRunId = '';
  thread.activeSessionId = '';
  thread.activeRunStartedAt = '';
  thread.activeRunAgentId = '';
  thread.activeRunMentionedAgentId = '';
  thread.activeRunRouteReason = '';
  thread.activeRunMentionDepth = 0;
  thread.activeRunParentMessageId = '';
  thread.activeRunSourceAgentId = '';
  thread.activeRunTurnId = '';
}

function finishActiveRunGroupChild(thread, runId, status = 'completed') {
  if (!thread?.activeRunGroup) return;
  const activeRuns = { ...(thread.activeRunGroup.activeRuns || {}) };
  delete activeRuns[runId];
  const hasActiveRuns = Object.keys(activeRuns).length > 0;
  thread.activeRunGroup = {
    ...thread.activeRunGroup,
    activeRuns,
    status: hasActiveRuns ? 'running' : status,
    updatedAt: now(),
    ...(hasActiveRuns ? {} : { completedAt: now() }),
  };
}

function hermesChunkError(chunk) {
  const result = chunk?.result;
  if (result?.failed && result?.error) return String(result.error);
  if (chunk?.error) return String(chunk.error);
  const statusEvent = Array.isArray(chunk?.events)
    ? chunk.events.find((event) => String(event?.event || event?.type || '') === 'status' && event.text)
    : null;
  if (statusEvent?.text && /error|failed|HTTP\s+\d+|❌|失败|invalid|unauthorized|auth/i.test(String(statusEvent.text))) {
    return String(statusEvent.text);
  }
  return '';
}

async function completeHermesRunFromOutput(threadId, runId, output, usage, res) {
  const telemetryState = await readState().catch(() => null);
  const telemetryThread = telemetryState?.threads?.find((item) => item.id === threadId);
  if (!output) {
    const error = 'Hermes 已结束但没有返回最终文本。';
    const thread = await failHermesRun(threadId, runId, error, 'Hermes Agent 返回空回复');
    captureTelemetry('agent_run_failed', { stage: 'empty_output', error_code: 'empty_output' });
    writeHermesRunSse(res, { event: 'run.failed', runId, error, thread, timestamp: Date.now() / 1000 });
    return { completed: true, failed: true, thread };
  }
  const thread = await appendHermesRunResult(threadId, output, runId, usage || {});
  const completedMessage = thread?.messages?.find((message) => message.externalRunId === runId);
  captureTelemetry('agent_run_completed', runTelemetryProperties(telemetryThread));
  writeHermesRunSse(res, {
    event: 'run.completed',
    runId,
    output,
    thread,
    turnId: completedMessage?.turnId || runId,
    agentId: completedMessage?.agentId || '',
    agentName: completedMessage?.agentName || '',
    mentionDepth: Number(completedMessage?.mentionDepth || 0),
    parentMessageId: completedMessage?.parentMessageId || '',
    timestamp: Date.now() / 1000,
  });
  return { completed: true, failed: false, thread };
}

async function failHermesRunFromChunk(threadId, runId, errorMessage, res) {
  const details = hermesRuntimeErrorDetails(errorMessage || 'Hermes Bridge run failed', 'default');
  const event = { event: 'run.failed', runId, error: enrichMissingExecutableError(errorMessage || 'Hermes Bridge run failed', 'default'), details, timestamp: Date.now() / 1000 };
  const state = await readState();
  let thread = state.threads.find((item) => item.id === threadId);
  const telemetryProperties = runTelemetryProperties(thread);
  if (thread) {
    thread.runStatus = 'failed';
    finishStoredModelRun(state, { runId, threadId, status: 'failed', error: event.error });
    finishActiveRunGroupChild(thread, runId, 'failed');
    clearHermesRunState(thread);
    thread.workflowState = mergeWorkflowStep(closeOpenWorkflowSteps(thread.workflowState || [], 'failed'), stepFromHermesEvent(event));
    thread.workflow = thread.workflowState.map((step) => step.title);
    thread.updatedAt = now();
    await writeState(state);
    event.thread = thread;
  }
  captureTelemetry('agent_run_failed', { stage: 'runtime', error_code: telemetryErrorCode({ message: errorMessage }), ...telemetryProperties });
  writeHermesRunSse(res, event);
  return { completed: true, failed: true, thread };
}

async function processHermesBridgeChunk({ threadId, runId, chunk, res, outputState }) {
  let sawStreamDeltaEvent = false;
  for (const rawEvent of Array.isArray(chunk.events) ? chunk.events : []) {
    const rawName = String(rawEvent?.event || rawEvent?.type || '');
    if (rawName === 'stream.delta') {
      sawStreamDeltaEvent = true;
      const delta = String(rawEvent.delta || '');
      if (delta) {
        outputState.text += delta;
        writeHermesRunSse(res, { event: 'message.delta', runId, delta, timestamp: Date.now() / 1000 });
      }
      continue;
    }

    const event = normalizeHermesBridgeChunkEvent(rawEvent);
    if (event.event === 'message.delta') {
      const delta = String(event.delta || '');
      if (delta) {
        outputState.text += delta;
        writeHermesRunSse(res, { ...event, runId: event.runId || runId, delta });
      }
      continue;
    }

    if (event.event === 'run.completed') {
      const output = extractHermesOutput(outputState.text, event.output, chunk.output, chunk.result);
      return completeHermesRunFromOutput(threadId, runId, output, event.usage || chunk.usage || {}, res);
    }

    if (event.event === 'run.failed' || event.event === 'run.cancelled') {
      const state = await readState();
      const thread = state.threads.find((item) => item.id === threadId);
      const telemetryProperties = runTelemetryProperties(thread);
      if (thread) {
        thread.runStatus = event.event === 'run.failed' ? 'failed' : 'idle';
        finishStoredModelRun(state, {
          runId,
          threadId,
          status: event.event === 'run.failed' ? 'failed' : 'cancelled',
          error: event.error || (event.event === 'run.cancelled' ? '用户已停止运行。' : ''),
        });
        finishActiveRunGroupChild(thread, runId, event.event === 'run.failed' ? 'failed' : 'cancelled');
        clearHermesRunState(thread);
        thread.workflowState = closeOpenWorkflowSteps(thread.workflowState || [], event.event === 'run.failed' ? 'failed' : 'completed');
        thread.workflow = thread.workflowState.map((step) => step.title);
        thread.updatedAt = now();
        await writeState(state);
        event.thread = thread;
      }
      if (event.event === 'run.failed') captureTelemetry('agent_run_failed', { stage: 'runtime', error_code: 'bridge_failed', ...telemetryProperties });
      writeHermesRunSse(res, event);
      return { completed: true, failed: event.event === 'run.failed', thread };
    }

    await mergeHermesWorkflowEvent(threadId, event);
    if (event.event !== 'agent.event' || event.title || event.detail) writeHermesRunSse(res, event);
  }

  if (chunk.delta && !sawStreamDeltaEvent) {
    const delta = String(chunk.delta || '');
    outputState.text += delta;
    writeHermesRunSse(res, { event: 'message.delta', runId, delta, timestamp: Date.now() / 1000 });
  }

  if (chunk.done || ['complete', 'completed', 'interrupted', 'error', 'failed'].includes(String(chunk.status || '').toLowerCase())) {
    const status = String(chunk.status || '').toLowerCase();
    const terminalError = hermesChunkError(chunk);
    if (status === 'error' || status === 'failed' || terminalError) return failHermesRunFromChunk(threadId, runId, terminalError || 'Hermes Bridge run failed', res);
    const output = extractHermesOutput(outputState.text, chunk.output, chunk.result);
    return completeHermesRunFromOutput(threadId, runId, output, chunk.usage || {}, res);
  }

  return { completed: false };
}

async function appendHermesRunResult(threadId, output, runId, usage = {}) {
  const state = await readState();
  const thread = state.threads.find((item) => item.id === threadId);
  if (!thread) return null;
  const agent = state.agents.find((item) => item.id === thread.activeRunAgentId)
    || resolveThreadDefaultAgent(state, thread)
    || state.agents[0]
    || { id: 'iris', name: 'Iris', role: 'Hermes Agent' };
  const defaultAgent = resolveThreadDefaultAgent(state, thread) || agent;
  const explicitlyMentionedAgent = state.agents.find((item) => item.id === thread.activeRunMentionedAgentId) || null;
  const collaboration = normalizeCollaboration(thread.collaboration, { defaultAgentId: thread.defaultAgentId, activeAgentId: thread.activeAgentId });
  const nextActiveAgent = thread.followMode === 'conversation' ? agent : defaultAgent;
  const runSessionId = thread.activeSessionId || hermesAgentSessionId(thread, agent.id);
  const runTurnId = thread.activeRunTurnId || runId;
  const finalOutput = trimLeadingBlankLines(output);
  if (finalOutput && !(thread.messages || []).some((message) => message.externalRunId === runId)) {
    thread.messages = [
      ...(thread.messages || []),
      agentEvent(agent, finalOutput, {
        role: `${agent.role || 'Agent'} / Hermes Agent`,
        externalRunId: runId,
        turnId: runTurnId,
        mentionDepth: Number(thread.activeRunMentionDepth || 0),
        parentMessageId: thread.activeRunParentMessageId || '',
        routeReason: thread.activeRunRouteReason || '',
      }),
    ];
  }
  thread.updatedAt = now();
  thread.runStatus = 'idle';
  clearHermesRunState(thread);
  thread.activeAgentId = nextActiveAgent?.id || thread.defaultAgentId || agent.id;
  thread.collaboration = normalizeCollaboration({
    ...collaboration,
    activeAgentId: nextActiveAgent?.id || collaboration.activeAgentId,
    lastMentionedAgentId: explicitlyMentionedAgent?.id || collaboration.lastMentionedAgentId,
    lastMentionedAgentName: explicitlyMentionedAgent?.name || collaboration.lastMentionedAgentName,
    lastRoutedAt: now(),
    lastRouteReason: explicitlyMentionedAgent ? 'user_mention' : thread.followMode === 'conversation' ? 'conversation_follow' : 'default_agent',
  }, { defaultAgentId: thread.defaultAgentId, activeAgentId: nextActiveAgent?.id });
  thread.engine = 'hermes-agent';
  thread.agentSessionIds = { ...(thread.agentSessionIds || {}), [agent.id]: runSessionId };
  thread.externalSessionId = thread.externalSessionId || hermesAgentSessionId(thread, defaultAgent.id);
  if (thread.activeRunGroup?.turnId === runTurnId) {
    finishActiveRunGroupChild(thread, runId, 'completed');
  }
  thread.workflowState = mergeWorkflowStep(closeOpenWorkflowSteps(thread.workflowState || [], 'completed'), { title: '生成最终回复', status: 'completed', source: 'run', updatedAt: now() });
  thread.workflow = thread.workflowState.map((step) => step.title);
  finishStoredModelRun(state, { runId, threadId, status: 'completed', usage });
  if (usage?.total_tokens) {
    state.observability = state.observability || { modelUsage: [], systemEvents: [] };
    state.observability.modelUsage = Array.isArray(state.observability.modelUsage) ? state.observability.modelUsage : [];
    state.observability.modelUsage.push({
      id: id('usage'),
      createdAt: now(),
      provider: 'Hermes Agent',
      modelId: 'hermes-agent',
      modelName: 'Hermes Agent',
      threadId: thread.id,
      threadTitle: thread.title,
      workspaceId: thread.workspaceId,
      agentIds: [agent.id],
      agentNames: [agent.name],
      inputTokens: Number(usage.input_tokens || 0),
      outputTokens: Number(usage.output_tokens || 0),
      cacheReadTokens: numberFromUsage(usage.cache_read_input_tokens, usage.cached_input_tokens, usage.input_tokens_details?.cached_tokens, usage.prompt_tokens_details?.cached_tokens),
      cacheCreationTokens: numberFromUsage(usage.cache_creation_input_tokens, usage.input_tokens_details?.cache_creation_tokens),
      totalTokens: Number(usage.total_tokens || 0),
      estimated: false,
      dataSource: 'Hermes Agent',
    });
    state.observability.modelUsage = state.observability.modelUsage.slice(-800);
  }
  await writeState(state);
  return thread;
}

function extractHermesOutput(...sources) {
  const seen = new Set();
  function visit(value) {
    if (value == null) return '';
    if (typeof value === 'string') return trimLeadingBlankLines(value);
    if (typeof value !== 'object') return '';
    if (seen.has(value)) return '';
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const text = visit(value[index]);
        if (text) return text;
      }
      return '';
    }
    for (const key of ['output', 'final_output', 'finalOutput', 'final_response', 'finalResponse', 'response', 'content', 'text']) {
      const text = visit(value[key]);
      if (text) return text;
    }
    const messageText = visit(value.message?.content || value.message);
    if (messageText) return messageText;
    if (value.result) return visit(value.result);
    return '';
  }
  for (const source of sources) {
    const text = visit(source);
    if (text) return text;
  }
  return '';
}

async function failHermesRun(threadId, runId, errorMessage, title = 'Hermes Agent 运行失败') {
  const state = await readState();
  const thread = state.threads.find((item) => item.id === threadId);
  if (thread) {
    thread.runStatus = 'failed';
    finishStoredModelRun(state, { runId, threadId, status: 'failed', error: errorMessage });
    finishActiveRunGroupChild(thread, runId, 'failed');
    clearHermesRunState(thread);
    thread.workflowState = mergeWorkflowStep(closeOpenWorkflowSteps(thread.workflowState || [], 'failed'), { title, status: 'failed', source: 'run', detail: String(errorMessage || '').slice(0, 200), updatedAt: now() });
    thread.workflow = thread.workflowState.map((step) => step.title);
    thread.updatedAt = now();
    await writeState(state);
  }
  return thread || null;
}

async function healStaleRunningThreads(state) {
  let changed = false;
  const runningThreads = (state.threads || []).filter((thread) => thread.runStatus === 'running');
  for (const thread of runningThreads) {
    const activeRunId = String(thread.activeRunId || '').trim();
    const activeSessionId = String(thread.activeSessionId || thread.externalSessionId || `workbench-${thread.id}`);
    const updatedAtMs = Date.parse(thread.activeRunStartedAt || thread.updatedAt || '');
    const ageMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : 0;
    if (!activeRunId) {
      if (ageMs > 60000) {
        thread.runStatus = 'failed';
        clearHermesRunState(thread);
        thread.workflowState = mergeWorkflowStep(closeOpenWorkflowSteps(thread.workflowState || [], 'failed'), { title: 'Hermes Agent 运行状态已过期', status: 'failed', source: 'run', detail: '旧 run 没有可恢复的 runId，请重新发送消息。', updatedAt: now() });
        thread.workflow = thread.workflowState.map((step) => step.title);
        thread.updatedAt = now();
        changed = true;
      }
      continue;
    }
    try {
      const status = await requestHermesBridge({ action: 'status', session_id: activeSessionId, profile: thread.profileName || 'default' }, { timeoutMs: 2500, retryMs: 0 });
      const bridgeStatus = String(status.status || '').toLowerCase();
      if (['complete', 'completed', 'interrupted', 'cancelled', 'error', 'failed'].includes(bridgeStatus)) {
        thread.runStatus = bridgeStatus === 'error' || bridgeStatus === 'failed' ? 'failed' : 'idle';
        clearHermesRunState(thread);
        thread.workflowState = closeOpenWorkflowSteps(thread.workflowState || [], thread.runStatus === 'failed' ? 'failed' : 'completed');
        thread.workflow = thread.workflowState.map((step) => step.title);
        thread.updatedAt = now();
        changed = true;
      }
    } catch (error) {
      const text = String(error?.message || error);
      if (/No such file or directory|FileNotFoundError|unknown run|not found|unknown session/i.test(text) || ageMs > 5 * 60000) {
        thread.runStatus = 'failed';
        clearHermesRunState(thread);
        thread.workflowState = mergeWorkflowStep(closeOpenWorkflowSteps(thread.workflowState || [], 'failed'), { title: 'Hermes Agent 运行状态已失效', status: 'failed', source: 'run', detail: enrichMissingExecutableError(text, thread.profileName || 'default').slice(0, 200), updatedAt: now() });
        thread.workflow = thread.workflowState.map((step) => step.title);
        thread.updatedAt = now();
        changed = true;
      }
    }
  }
  if (changed) await writeState(state);
  return changed;
}

app.post('/api/threads/:id/runs', async (req, res) => {
  let runProfileName = 'default';
  let runDiagnosticId = '';
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return res.status(404).json({ error: '会话不存在。' });
    const message = String(req.body?.message || '').trim();
    const turnId = String(req.body?.turnId || id('turn'));
    const attachmentMetadata = await attachmentStore.resolveMany(req.body?.attachmentIds);
    if (!message && !attachmentMetadata.length) return res.status(400).json({ error: '消息和附件不能同时为空。' });
    const existingRunGroup = thread.activeRunGroup?.turnId === turnId ? thread.activeRunGroup : null;
    const configuredDepth = existingRunGroup?.maxMentionDepth ?? normalizeAgentMentionMaxDepth(state.ui?.agentMentionMaxDepth, 2);
    if (req.body?.sourceAgentId && req.body.sourceAgentId !== 'user') {
      const requestedDepth = Math.max(0, Math.floor(Number(req.body?.mentionDepth || 0)));
      if (configuredDepth !== 'unlimited' && requestedDepth > configuredDepth) {
        return res.status(409).json({ error: 'Agent 间 @ 路由已达到当前深度上限。', code: 'AGENT_MENTION_DEPTH_LIMIT' });
      }
    }
    let bridge = null;
    try {
      const started = await startHermesBridge();
      bridge = started.bridge;
    } catch (error) {
      bridge = await probeHermesBridge({ timeoutMs: 1000 }).catch(() => null);
      return res.status(503).json({ error: `本机 Hermes Bridge 未连接：${error.message || bridge?.error || '启动失败。'}`, bridge });
    }

    const selected = Array.isArray(req.body?.selectedAgents) ? req.body.selectedAgents : thread.selectedAgents || [resolveDefaultAgentId(state)];
    const selectedAgents = state.agents.filter((agent) => selected.includes(agent.id));
    const primaryAgent = resolveRunTargetAgent(state, thread, req.body?.targetAgentId, selectedAgents);
    if (!primaryAgent) return res.status(400).json({ error: '没有可用的 Agent。' });
    const routingMessage = message || '请查看并处理这些附件。';
    const mentionedAgents = matchMentionedAgents(routingMessage, state.agents, selected, resolveDefaultAgentId(state));
    const explicitlyMentionedPrimaryAgent = !isAllAgentsMentioned(message) && mentionedAgents.some((agent) => agent.id === primaryAgent.id);
    const routeReason = req.body?.sourceAgentId
      ? req.body.sourceAgentId === 'user' ? 'user_mention' : 'agent_mention'
      : explicitlyMentionedPrimaryAgent
        ? 'user_mention'
        : thread.followMode === 'conversation' ? 'conversation_follow' : 'default_agent';
    const selectedAgentIds = Array.from(new Set([...selected, primaryAgent.id].filter((agentId) => state.agents.some((agent) => agent.id === agentId))));
    const routeEdge = req.body?.sourceAgentId ? `${String(req.body.sourceAgentId)}->${primaryAgent.id}` : '';
    const routedEdges = new Set(existingRunGroup?.routedEdges || []);
    if (routeEdge && routedEdges.has(routeEdge)) return res.status(409).json({ error: '本轮已经执行过相同的 Agent @ 路由。', code: 'AGENT_MENTION_DUPLICATE_EDGE' });
    if (Number(existingRunGroup?.totalRoutedRuns || 0) >= 64) return res.status(409).json({ error: '本轮 Agent @ 路由已达到 64 次安全上限。', code: 'AGENT_MENTION_RUN_LIMIT' });
    if (routeEdge) routedEdges.add(routeEdge);
    const profileName = await resolveHermesProfileNameForAgent(primaryAgent);
    runProfileName = profileName;
    const runModel = await resolveThreadRunModelConfig(state, thread, primaryAgent, profileName);
    const requestedRunSettings = normalizeAgentRunOverrides(thread.agentRunOverrides, state.agents)[primaryAgent.id] || {};
    const runCapability = runModel.modelProfile ? resolveModelCapability(runModel.modelProfile, runModel.model, { providerCatalog: flattenProviderCatalog(modelCatalogCache) }) : null;
    const runMapping = runModel.modelProfile && runCapability
      ? mapRunSettings(runModel.modelProfile, runCapability, requestedRunSettings)
      : { requestedReasoning: 'default', effectiveReasoning: 'default', requestedServiceTier: 'standard', effectiveServiceTier: 'standard', runtimeOverrides: {} };
    const sanitizedRunSettings = {
      ...(requestedRunSettings.reasoningEffort && typeof runCapability?.reasoningMap?.[requestedRunSettings.reasoningEffort] === 'string' ? { reasoningEffort: requestedRunSettings.reasoningEffort } : {}),
      ...(requestedRunSettings.speedMode === 'standard' || runCapability?.serviceTiers?.some((tier) => tier.id === requestedRunSettings.speedMode || requestedRunSettings.speedMode === 'fast') ? { speedMode: requestedRunSettings.speedMode } : {}),
    };
    thread.agentRunOverrides = { ...(thread.agentRunOverrides || {}) };
    if (sanitizedRunSettings.reasoningEffort || sanitizedRunSettings.speedMode) thread.agentRunOverrides[primaryAgent.id] = sanitizedRunSettings;
    else delete thread.agentRunOverrides[primaryAgent.id];
    await ensureWorkbenchMcpServers(profileName);
    const missingMcpCommands = await findMissingMcpCommands(profileName);
    if (missingMcpCommands.length) {
      const error = new Error(missingMcpCommands[0].message);
      error.status = 503;
      error.code = 'MCP_COMMAND_MISSING';
      error.details = missingMcpCommands[0];
      throw error;
    }
    const sessionId = hermesAgentSessionId(thread, primaryAgent.id);
    const userMessage = { id: id('msg'), agentId: 'user', agentName: '你', role: 'Workspace Owner', content: message, attachments: attachmentMetadata.map(attachmentStore.publicAttachment) };
    const relayMessage = req.body?.sourceAgentId ? {
      id: id('msg'),
      agentId: String(req.body.sourceAgentId),
      agentName: String(req.body.sourceAgentName || 'Agent'),
      role: 'Agent mention relay',
      content: message,
      mentionDepth: Number(req.body.mentionDepth || 1),
      parentMessageId: String(req.body.parentMessageId || ''),
    } : null;
    if (!relayMessage) {
      await attachmentStore.claim(attachmentMetadata, thread.id, userMessage.id);
      if (!(thread.messages || []).some((item) => item.content === message && item.agentId === 'user' && String(item.id).startsWith('local-'))) {
        thread.messages = [...(thread.messages || []), userMessage];
      }
    }
    runDiagnosticId = id('model_run');
    thread.runStatus = 'running';
    thread.workflowState = [{ title: 'Hermes Agent 开始执行', status: 'running', source: 'run', detail: (message || attachmentMetadata.map((item) => item.name).join('、')).slice(0, 80), updatedAt: now() }];
    thread.workflow = thread.workflowState.map((step) => step.title);
    thread.selectedAgents = selectedAgentIds;
    thread.agentSessionIds = { ...(thread.agentSessionIds || {}), [primaryAgent.id]: sessionId };
    thread.externalSessionId = thread.externalSessionId || hermesAgentSessionId(thread, resolveThreadDefaultAgent(state, thread)?.id || primaryAgent.id);
    thread.activeRunId = '';
    thread.activeSessionId = sessionId;
    thread.activeRunStartedAt = now();
    thread.activeRunAgentId = primaryAgent.id;
    thread.activeRunMentionedAgentId = explicitlyMentionedPrimaryAgent || req.body?.sourceAgentId ? primaryAgent.id : '';
    thread.activeRunRouteReason = routeReason;
    thread.activeRunMentionDepth = Number(req.body?.mentionDepth || 0);
    thread.activeRunParentMessageId = String(req.body?.parentMessageId || '');
    thread.activeRunSourceAgentId = String(req.body?.sourceAgentId || '');
    thread.activeRunTurnId = turnId;
    thread.activeRunGroup = {
      turnId,
      maxMentionDepth: configuredDepth,
      depth: Math.max(Number(existingRunGroup?.depth || 0), Number(req.body?.mentionDepth || 0)),
      routedEdges: [...routedEdges],
      activeRuns: { ...(existingRunGroup?.activeRuns || {}), [runDiagnosticId]: { runId: '', sessionId, agentId: primaryAgent.id, agentName: primaryAgent.name, mentionDepth: Number(req.body?.mentionDepth || 0), parentMessageId: String(req.body?.parentMessageId || ''), status: 'starting' } },
      totalRoutedRuns: Number(existingRunGroup?.totalRoutedRuns || 0) + 1,
      status: 'running',
      startedAt: existingRunGroup?.startedAt || now(),
      updatedAt: now(),
    };
    thread.runtime = 'hermes-bridge';
    thread.profileName = profileName;
    thread.bridgeEndpoint = bridge.endpoint;
    thread.updatedAt = now();
    appendModelRunDiagnostic(state, createModelRunDiagnostic({
      id: runDiagnosticId,
      createdAt: thread.activeRunStartedAt,
      thread,
      agent: primaryAgent,
      profileName,
      runModel,
      runCapability,
      runMapping,
    }));
    await writeState(state);

    const bridgeAttachments = await Promise.all(attachmentMetadata.map(async (metadata) => {
      const { filePath } = await attachmentStore.content(metadata.id);
      return { id: metadata.id, name: metadata.name, mime_type: metadata.mimeType, size: metadata.size, kind: metadata.kind, path: filePath };
    }));
    const runtimeMessage = `${agentIdentityRunInstruction(primaryAgent, state.agents)}\n\n用户或群聊消息：\n${routingMessage}`;
    const started = await requestHermesBridge({
      action: 'chat',
      session_id: sessionId,
      message: runtimeMessage,
      storage_message: hermesStoredMessageContent(message, bridgeAttachments),
      attachments: bridgeAttachments,
      conversation_history: await threadHistoryForHermes({ ...thread, messages: relayMessage ? thread.messages : (thread.messages || []).slice(0, -1) }, primaryAgent),
      profile: profileName,
      model: runModel.model || undefined,
      provider: runModel.provider || undefined,
      runtime_overrides: runMapping.runtimeOverrides,
      source: 'frakio-workbench',
    }, {
      // Cold-starting the bundled Python/Hermes worker can exceed 30s on Windows,
      // especially on ARM machines running the x64 runtime under emulation.
      timeoutMs: 120000,
      retryMs: 5000,
    });
    const stateAfterStart = await readState();
    const threadAfterStart = stateAfterStart.threads.find((item) => item.id === req.params.id);
    const sentAt = now();
    updateModelRunDiagnostic(stateAfterStart, { diagnosticId: runDiagnosticId }, (record) => markModelRunSent(record, started.run_id, sentAt));
    if (threadAfterStart) {
      threadAfterStart.activeRunId = started.run_id;
      threadAfterStart.activeSessionId = started.session_id || sessionId;
      threadAfterStart.activeRunAgentId = primaryAgent.id;
      threadAfterStart.activeRunMentionedAgentId = explicitlyMentionedPrimaryAgent || req.body?.sourceAgentId ? primaryAgent.id : '';
      threadAfterStart.activeRunRouteReason = routeReason;
      threadAfterStart.activeRunMentionDepth = Number(req.body?.mentionDepth || 0);
      threadAfterStart.activeRunParentMessageId = String(req.body?.parentMessageId || '');
      threadAfterStart.activeRunTurnId = turnId;
      threadAfterStart.agentSessionIds = { ...(threadAfterStart.agentSessionIds || {}), [primaryAgent.id]: started.session_id || sessionId };
      if (threadAfterStart.activeRunGroup?.turnId === turnId) {
        const activeRuns = { ...(threadAfterStart.activeRunGroup.activeRuns || {}) };
        delete activeRuns[runDiagnosticId];
        activeRuns[started.run_id] = { runId: started.run_id, sessionId: started.session_id || sessionId, agentId: primaryAgent.id, agentName: primaryAgent.name, mentionDepth: Number(req.body?.mentionDepth || 0), parentMessageId: String(req.body?.parentMessageId || ''), status: 'running' };
        threadAfterStart.activeRunGroup = { ...threadAfterStart.activeRunGroup, activeRuns, status: 'running', updatedAt: sentAt };
      }
      threadAfterStart.updatedAt = sentAt;
    }
    await writeState(stateAfterStart);
    captureTelemetry('agent_run_started', {
      agent_count: selectedAgentIds.length,
      attachment_count: attachmentMetadata.length,
      permission_mode: thread.permissionMode || req.body?.permissionMode || 'manual',
      route_reason: routeReason,
    });
    captureMeaningfulActivity('agent_run_started');
    res.status(202).json({
      runId: started.run_id,
      sessionId: started.session_id || sessionId,
      status: started.status || 'started',
      runtime: 'hermes-bridge',
      profileName,
      model: runModel.model,
      provider: runModel.provider,
      modelSource: runModel.source,
      requestedReasoning: runMapping.requestedReasoning,
      effectiveReasoning: runMapping.effectiveReasoning,
      requestedServiceTier: runMapping.requestedServiceTier,
      effectiveServiceTier: runMapping.effectiveServiceTier,
      reasoningEffort: runMapping.effectiveReasoning,
      speedMode: runMapping.effectiveServiceTier,
      capabilitySource: runCapability?.source || 'profile',
      bridge,
      turnId,
      agentId: primaryAgent.id,
      agentName: primaryAgent.name,
      mentionDepth: Number(req.body?.mentionDepth || 0),
      parentMessageId: String(req.body?.parentMessageId || ''),
    });
  } catch (error) {
    const details = { ...hermesRuntimeErrorDetails(error, error.details?.profileName || runProfileName), ...(error.details || {}) };
    const enriched = enrichMissingExecutableError(error.message || 'Hermes Bridge run 创建失败。', details.profileName || runProfileName);
    try {
      const state = await readState();
      const thread = state.threads.find((item) => item.id === req.params.id);
      finishStoredModelRun(state, { diagnosticId: runDiagnosticId, threadId: req.params.id, status: 'failed', error: enriched });
      if (thread?.runStatus === 'running') {
        thread.runStatus = 'failed';
        finishActiveRunGroupChild(thread, runDiagnosticId, 'failed');
        clearHermesRunState(thread);
        thread.workflowState = mergeWorkflowStep(closeOpenWorkflowSteps(thread.workflowState || [], 'failed'), { title: 'Hermes Agent 启动失败', status: 'failed', source: 'run', detail: enriched.slice(0, 200), updatedAt: now() });
        thread.workflow = thread.workflowState.map((step) => step.title);
        thread.updatedAt = now();
      }
      await writeState(state);
    } catch {}
    captureTelemetry('agent_run_failed', { stage: 'startup', error_code: telemetryErrorCode(error) });
    res.status(error.status || 500).json({ error: enriched, code: error.code || details.errorType || '', details });
  }
});

app.get('/api/threads/:id/runs/:runId/events', async (req, res) => {
  const sessionId = String(req.query.sessionId || `workbench-${req.params.id}`);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  let cursor = 0;
  let eventCursor = 0;
  let closed = false;
  const outputState = { text: '' };
  req.on('close', () => { closed = true; });
  try {
    while (!closed) {
      const chunk = await requestHermesBridge({
        action: 'get_output',
        run_id: req.params.runId,
        cursor,
        event_cursor: eventCursor,
      }, { timeoutMs: 10000, retryMs: 1000 });
      cursor = Number(chunk.cursor ?? cursor);
      eventCursor = Number(chunk.event_cursor ?? eventCursor);
      const result = await processHermesBridgeChunk({
        threadId: req.params.id,
        runId: req.params.runId,
        chunk,
        res,
        outputState,
      });
      if (result.completed) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  } catch (error) {
    const formattedError = enrichMissingExecutableError(String(error?.message || error), 'default');
    try {
      const state = await readState();
      const thread = state.threads.find((item) => item.id === req.params.id);
      if (thread) {
        thread.runStatus = 'failed';
        finishStoredModelRun(state, { runId: req.params.runId, threadId: req.params.id, status: 'failed', error: formattedError });
        finishActiveRunGroupChild(thread, req.params.runId, 'failed');
        clearHermesRunState(thread);
        thread.workflowState = mergeWorkflowStep(closeOpenWorkflowSteps(thread.workflowState || [], 'failed'), { title: 'Hermes Agent 运行失败', status: 'failed', source: 'run', detail: formattedError.slice(0, 200), updatedAt: now() });
        thread.workflow = thread.workflowState.map((step) => step.title);
        thread.updatedAt = now();
        await writeState(state);
      }
    } catch {}
    captureTelemetry('agent_run_failed', { stage: 'runtime', error_code: telemetryErrorCode(error) });
    res.write(`data: ${JSON.stringify({ event: 'run.failed', runId: req.params.runId, error: formattedError, details: hermesRuntimeErrorDetails(error, 'default') })}\n\n`);
  } finally {
    res.end();
  }
});

app.post('/api/threads/:id/runs/:runId/approval', async (req, res) => {
  try {
    const approvalId = String(req.body?.approvalId || req.body?.id || req.params.runId);
    if (!approvalId || approvalId === req.params.runId) return res.status(400).json({ error: '这次审批缺少 approval_id，请重新发起任务。' });
    const result = await requestHermesBridge({
      action: 'approval_respond',
      approval_id: approvalId,
      choice: req.body?.choice || 'deny',
      session_id: req.body?.sessionId || req.query.sessionId || '',
      run_id: req.params.runId,
    }, { timeoutMs: 10000, retryMs: 1000 });
    if (result?.resolved === false) return res.status(409).json({ error: '这次审批已失效，请重新发起任务。', ...result });
    res.json({ ok: true, approvalId, choice: req.body?.choice || 'deny', ...result });
  } catch (error) {
    res.status(502).json({ error: formatApprovalError(error.message || '审批响应失败。') });
  }
});

function formatApprovalError(message) {
  const text = String(message || '').trim();
  if (/approval_id is required|missing approval/i.test(text)) return '这次审批缺少 approval_id，请重新发起任务。';
  if (/unknown approval|not found|expired|timeout/i.test(text)) return '这次审批已失效，请重新发起任务。';
  if (/unknown action/i.test(text)) return '本机 Hermes Bridge 不支持当前审批协议，请重启 Bridge 后重试。';
  return text || '审批响应失败。';
}

const clarifySkipResponse = '[user skipped this clarification; do not assume an answer and do not ask the same question again in this run. Continue only with a safe reversible default. If the missing answer is required, leave that operation unperformed and explain what remains undecided in the final response.]';

app.post('/api/threads/:id/runs/:runId/clarify', async (req, res) => {
  try {
    const clarifyId = String(req.body?.clarifyId || req.body?.clarify_id || '').trim();
    const action = String(req.body?.action || 'answer').trim().toLowerCase();
    const answer = String(req.body?.response || '').trim();
    if (!clarifyId) return res.status(400).json({ error: '这次提问缺少 clarify_id，请重新发起任务。' });
    if (!['answer', 'skip'].includes(action)) return res.status(400).json({ error: '不支持的提问响应。' });
    if (action === 'answer' && !answer) return res.status(400).json({ error: '请输入回答。' });
    const result = await requestHermesBridge({
      action: 'clarify_respond',
      clarify_id: clarifyId,
      response: action === 'skip' ? clarifySkipResponse : answer,
      session_id: req.body?.sessionId || req.query.sessionId || '',
      run_id: req.params.runId,
    }, { timeoutMs: 10000, retryMs: 1000 });
    if (result?.resolved === false) return res.status(409).json({ error: '这次提问已失效，请重新发起任务。', ...result });
    await mergeHermesWorkflowEvent(req.params.id, { event: 'clarify.responded', clarifyId, skipped: action === 'skip' });
    res.json({ ok: true, clarifyId, action, resolved: true });
  } catch (error) {
    res.status(502).json({ error: formatClarifyError(error.message || '提问响应失败。') });
  }
});

function formatClarifyError(message) {
  const text = String(message || '').trim();
  if (/clarify_id is required|missing clarify/i.test(text)) return '这次提问缺少 clarify_id，请重新发起任务。';
  if (/unknown clarify|not found|expired|timeout/i.test(text)) return '这次提问已失效，请重新发起任务。';
  if (/unknown action/i.test(text)) return '本机 Hermes Bridge 不支持当前提问协议，请重启 Bridge 后重试。';
  return text || '提问响应失败。';
}

app.post('/api/threads/:id/runs/:runId/stop', async (req, res) => {
  try {
    const state = await readState();
    const thread = state.threads.find((item) => item.id === req.params.id);
    if (!thread) return res.status(404).json({ error: '对话不存在。', resolved: false });
    const groupRuns = Object.values(thread.activeRunGroup?.activeRuns || {});
    const requestedRun = groupRuns.find((run) => String(run.runId) === String(req.params.runId));
    if ((!thread.activeRunId || String(thread.activeRunId) !== String(req.params.runId)) && !requestedRun) {
      return res.status(409).json({ error: '这次运行已经结束或无法停止', resolved: false });
    }
    const runsToStop = req.body?.childOnly
      ? [requestedRun || { runId: req.params.runId, sessionId: req.body?.sessionId || req.query.sessionId || thread.activeSessionId }]
      : (groupRuns.length ? groupRuns : [{ runId: req.params.runId, sessionId: req.body?.sessionId || req.query.sessionId || thread.activeSessionId }]);
    const results = await Promise.allSettled(runsToStop.map((run) => requestHermesBridge({ action: 'interrupt', session_id: String(run.sessionId || ''), run_id: run.runId || undefined, message: '用户请求停止。' }, { timeoutMs: 10000, retryMs: 1000 })));
    const stopped = results.filter((result) => result.status === 'fulfilled' && result.value?.resolved !== false).length;
    if (!stopped) return res.status(409).json({ error: '这次运行已经结束或无法停止', resolved: false });
    captureTelemetry('agent_run_stopped', { duration_bucket: telemetryDurationBucket(thread.activeRunStartedAt) });
    res.json({ ok: true, resolved: true, stoppedRuns: stopped, turnId: thread.activeRunGroup?.turnId || '' });
  } catch (error) {
    const message = String(error?.message || '').trim();
    const expired = /unknown run|not found|expired|already (?:ended|finished)|not running|no active/i.test(message);
    res.status(expired ? 409 : 502).json({ error: expired ? '这次运行已经结束或无法停止' : message || '停止运行失败，请重试。', resolved: false });
  }
});

app.post('/api/council/send', async (req, res) => {
  const state = await readState();
  const thread = state.threads.find((item) => item.id === req.body?.threadId) || state.threads[0];
  if (thread) {
    const message = String(req.body?.message || '').trim();
    const taskType = detectTaskType(message);
    const runSteps = taskStepsForMessage(taskType, message, 'running');
    thread.runStatus = 'running';
    thread.workflow = runSteps.map((step) => step.title);
    thread.workflowState = runSteps;
    await writeState(state);
  }

  return runAgentRoomChat(req, res);
});

function artifactsFromThreadOutputs(taskType, proposals, thread) {
  const base = [
    {
      id: id('artifact'),
      name: thread?.mode === 'direct' ? '临时对话记录' : '任务报告',
      kind: thread?.mode === 'direct' ? 'conversation' : 'report',
      target: thread?.mode === 'direct' ? '未绑定 Workspace Root' : thread?.title || '当前对话',
      updatedAt: now(),
    },
  ];
  for (const proposal of proposals || []) {
    base.push({
      id: proposal.id || id('artifact'),
      name: proposal.title,
      kind: proposal.type || taskType,
      target: proposal.target || '当前 Workspace',
      updatedAt: now(),
    });
  }
  return base;
}

function buildAgentReply(agentId, message, taskType, summary) {
  const productHint = summary?.products?.find((product) => message.includes(product.slice(0, 3))) || summary?.products?.[0];
  const vaultLine = summary ? `当前资料库已学习 ${summary.documentCount} 个 Markdown、${summary.products.length} 个产品文档。` : '当前未连接资料库，我只基于会话上下文工作。';
  if (agentId === 'iris') return `已把需求整理成 ${taskTypeName(taskType)}。${vaultLine}`;
  if (agentId === 'max') return `本轮继续遵守低实体原则。${productHint ? `建议从 ${productHint} 开始跑一条可审核链路。` : '先把目标拆成可确认的下一步。'}`;
  if (agentId === 'nora') return summary ? `我会先看产品事实和用户场景。当前产品文档数量：${summary.products.length}。` : '我可以先做普通商业判断；连接资料库后再引用产品事实。';
  if (agentId === 'kai') return '我负责把商业判断转成 SEO、内容角度、标题结构和 CTA。';
  if (agentId === 'leo') return '我只在看到产品原素材和文章 brief 后进入配图。第一版先产出图片/视频 brief。';
  if (agentId === 'victor') return '我负责技术闸门。涉及 Obsidian 写入或 Shopify 发布都必须进入确认队列。';
  return '收到，我会按当前 Workspace 上下文参与。';
}

function taskTypeName(_taskType) {
  return '综合运营任务';
}

function compressContext(message, messages, summary, selectedAgents) {
  return {
    title: '交给新加入 Agent 的上下文包',
    conversation: {
      userIntent: message.slice(0, 220),
      activeAgents: selectedAgents,
      currentConclusion: messages.map((event) => `${event.agentName}: ${event.content}`).join('\n').slice(-1000),
    },
    vault: summary
      ? {
          connected: true,
          documentCount: summary.documentCount,
          products: summary.products.slice(0, 8),
          activeRules: summary.highSignal.slice(0, 5).map((doc) => doc.relativePath),
        }
      : { connected: false, activeRules: [] },
    policy: '新 Agent 加入时默认收到压缩会话上下文和仓库上下文，不回放完整聊天。',
  };
}

if (isDesktopMode && existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
}

let appInitialized = false;
let httpServer = null;

export async function createApp() {
  if (appInitialized) return app;
  await runModelScopeMigration().catch((error) => {
    console.warn('Model scope migration skipped:', error?.message || error);
  });
  await runPresetProviderCredentialMigration().catch((error) => {
    console.warn('Preset Provider credential migration skipped:', error?.message || error);
  });
  await readState();
  await runLegacyDemoDataCleanupMigration().catch((error) => {
    console.warn('Legacy demo data cleanup skipped:', error?.message || error);
  });
  const initialTelemetryState = await readState();
  await telemetry.initialize();
  await telemetry.setEnabled(initialTelemetryState.ui?.telemetryEnabled === true && Boolean(initialTelemetryState.ui?.telemetryNoticeSeenAt));
  appInitialized = true;
  return app;
}

export async function startServer() {
  if (httpServer) return httpServer;
  const readyApp = await createApp();
  httpServer = readyApp.listen(port, '127.0.0.1', () => {
    console.log(`Frakio Work API listening on http://127.0.0.1:${port}`);
    const launchId = String(process.env.FRAKIO_WORK_LAUNCH_ID || '').trim();
    if (launchId) {
      captureTelemetry('app_opened', { startup_ms: Math.max(0, Date.now() - Number(process.env.FRAKIO_WORK_LAUNCH_STARTED_AT || Date.now())) }, { dedupeKey: `launch_${launchId}` });
    }
    if (process.env.FRAKIO_WORK_DISABLE_AUTOSTART !== '1') setTimeout(() => {
      ensureHermesRuntimeReady().catch((error) => {
        hermesAutoStartState.status = 'failed';
        hermesAutoStartState.error = String(error?.message || error);
        hermesAutoStartState.finishedAt = now();
        console.warn('Hermes runtime auto-start failed:', error?.message || error);
      });
    }, 100);
    setTimeout(() => void refreshStaleProviderCatalogs().catch(() => {}), 400);
  });
  return httpServer;
}

let telemetryShutdownStarted = false;
async function stopOwnedChild(child, label) {
  if (!child || child.exitCode !== null) return;
  console.log(`Stopping ${label} pid=${child.pid || 'unknown'}`);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 1400)),
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 600))]);
  }
}

async function stopOwnedRuntimeProcesses() {
  const bridge = await probeHermesBridge({ timeoutMs: 500 }).catch(() => null);
  const ownedBridgePids = bridge?.ownedByThisApi ? collectBridgePids(bridge.ping || {}) : [];
  await Promise.all([
    stopOwnedChild(hermesApiProcess, 'Runtime API'),
    stopOwnedChild(hermesBridgeProcess, 'Hermes Bridge'),
    ...[...profileGatewayProcesses].map((child) => stopOwnedChild(child, 'Profile Gateway')),
  ]);
  if (ownedBridgePids.length) await terminatePids(ownedBridgePids, [], 'owned Hermes Bridge');
  hermesApiProcess = null;
  hermesBridgeProcess = null;
  profileGatewayProcesses.clear();
}

async function shutdownApi() {
  if (telemetryShutdownStarted) return;
  telemetryShutdownStarted = true;
  await stopOwnedRuntimeProcesses().catch((error) => console.warn('Runtime shutdown warning:', error?.message || error));
  await Promise.race([telemetry.shutdown(), new Promise((resolve) => setTimeout(resolve, 900))]);
  if (httpServer) httpServer.close(() => process.exit(0));
  else process.exit(0);
  setTimeout(() => process.exit(0), 3000).unref();
}

const isMainModule = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
if (isMainModule) {
  await startServer();
  process.once('SIGTERM', () => void shutdownApi());
  process.once('SIGINT', () => void shutdownApi());
}
