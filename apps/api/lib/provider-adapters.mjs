import { createHash } from 'node:crypto';

export const CATALOG_VERSION = '2026-07-21.1';
export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export const CHAT_THINKING_FORMATS = ['openai', 'openrouter', 'deepseek', 'together', 'zai', 'qwen', 'chat_template', 'string_thinking'];
export const PROTECTED_OVERRIDE_KEYS = new Set([
  'authorization', 'api_key', 'api-key', 'x-api-key', 'host', 'content-length',
  'stream', 'stream_options', 'transfer-encoding', 'connection', 'proxy-authorization',
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
]);

const clean = (value) => String(value || '').trim();
const lower = (value) => clean(value).toLowerCase();

export function normalizeApiMode(value) {
  const mode = lower(value);
  return ['chat_completions', 'openai_responses', 'codex_responses', 'anthropic_messages', 'bedrock_converse', 'codex_app_server'].includes(mode)
    ? mode
    : '';
}

export function baseUrlClass(value) {
  try {
    const parsed = new URL(clean(value));
    const host = parsed.hostname.toLowerCase();
    if (host === 'api.openai.com') return 'openai-official';
    if (host === 'api.anthropic.com') return 'anthropic-official';
    if (host === 'api.deepseek.com') return 'deepseek-official';
    if (host === 'openrouter.ai') return 'openrouter-official';
    if (host === 'generativelanguage.googleapis.com') return 'gemini-official';
    if (host === 'api.ikuncode.cc') return 'ikuncode-relay';
    if (host === '127.0.0.1' || host === 'localhost') return 'local';
    return `relay:${host}`;
  } catch {
    return 'unknown';
  }
}

export function catalogKey({ providerKey, apiMode, baseUrl }, modelId) {
  return [lower(providerKey) || 'custom', normalizeApiMode(apiMode) || 'unknown', baseUrlClass(baseUrl), clean(modelId)].join('::');
}

function serviceTier(id, name, description, requestValue, billingNotice = '') {
  return { id, name, description, requestValue, billingNotice };
}

function record(providerKey, apiMode, baseClass, modelId, data) {
  const key = [providerKey, apiMode, baseClass, modelId].join('::');
  return [key, {
    modelId,
    name: data.name || modelId,
    input: data.input || ['text'],
    contextLength: data.contextLength ?? null,
    defaultReasoning: data.defaultReasoning || '',
    reasoningMap: data.reasoningMap || {},
    serviceTiers: data.serviceTiers || [],
    source: 'frakio_builtin',
    confidence: 'confirmed',
    status: 'confirmed',
    updatedAt: '2026-07-21T00:00:00.000Z',
  }];
}

const codex56Reasoning = Object.fromEntries(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map((level) => [level, level]));
const openAiReasoning = Object.fromEntries(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((level) => [level, level === 'off' ? 'none' : level]));
const deepSeekReasoning = { off: 'none', high: 'high', max: 'max' };
const anthropicReasoning = { off: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' };

const builtinEntries = [
  record('ikuncode', 'codex_responses', 'ikuncode-relay', 'gpt-5.6-sol', { defaultReasoning: 'low', reasoningMap: codex56Reasoning, serviceTiers: [serviceTier('priority', '快速', '1.5x speed', 'priority', '厂商可能额外计费')] }),
  record('openai-codex', 'codex_responses', 'relay:chatgpt.com', 'gpt-5.6-sol', { defaultReasoning: 'low', reasoningMap: codex56Reasoning, serviceTiers: [serviceTier('priority', '快速', '1.5x speed', 'priority', '可能增加额度消耗')] }),
  record('openai-api', 'codex_responses', 'openai-official', 'gpt-5.6-sol', { defaultReasoning: 'low', reasoningMap: codex56Reasoning, serviceTiers: [serviceTier('priority', '快速', 'Priority Processing', 'priority', 'OpenAI 会额外计费')] }),
  ...['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.3-codex'].map((id) => record('openai-api', 'codex_responses', 'openai-official', id, { defaultReasoning: 'medium', reasoningMap: openAiReasoning, serviceTiers: id.includes('codex') ? [] : [serviceTier('priority', '快速', 'Priority Processing', 'priority', 'OpenAI 会额外计费')] })),
  ...['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'].map((id) => record('deepseek', 'chat_completions', 'deepseek-official', id, { defaultReasoning: id.includes('reasoner') ? 'high' : '', reasoningMap: deepSeekReasoning })),
  ...['claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-4-6'].map((id) => record('anthropic', 'anthropic_messages', 'anthropic-official', id, { defaultReasoning: 'medium', reasoningMap: anthropicReasoning, serviceTiers: id === 'claude-opus-4-6' ? [serviceTier('fast', '快速', 'Anthropic Fast Mode', 'fast', 'Anthropic 可能额外计费')] : [] })),
  ...['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview'].map((id) => record('gemini', 'chat_completions', 'gemini-official', id, { defaultReasoning: 'medium', reasoningMap: { off: 'none', low: 'low', medium: 'medium', high: 'high' } })),
];

export const BUILTIN_CATALOG = Object.freeze(Object.fromEntries(builtinEntries));
export const BUILTIN_CATALOG_META = Object.freeze({
  version: CATALOG_VERSION,
  generatedAt: '2026-07-21T00:00:00.000Z',
  hash: createHash('sha256').update(JSON.stringify(builtinEntries)).digest('hex'),
});

export function emptyCapability(modelId = '') {
  return {
    modelId: clean(modelId), name: clean(modelId), input: ['text'], contextLength: null,
    defaultReasoning: '', reasoningMap: {}, reasoningEfforts: [], serviceTiers: [], speedModes: ['standard'],
    reasoning: false, reasoningType: 'none', fastMode: 'none', source: 'unknown', confidence: 'unknown', status: 'unknown', reasoningStatus: 'unknown', serviceTierStatus: 'unknown', updatedAt: null,
  };
}

function normalizeReasoningMap(value) {
  const result = {};
  if (Array.isArray(value)) {
    for (const level of value) if (clean(level)) result[clean(level)] = clean(level) === 'off' ? 'none' : clean(level);
    return result;
  }
  for (const [level, mapped] of Object.entries(value && typeof value === 'object' ? value : {})) {
    const key = clean(level).slice(0, 40);
    if (!key) continue;
    if (mapped === null) result[key] = null;
    else if (typeof mapped === 'string' && clean(mapped)) result[key] = clean(mapped).slice(0, 80);
  }
  return result;
}

export function normalizeServiceTiers(value) {
  return (Array.isArray(value) ? value : []).map((raw) => ({
    id: clean(raw?.id).slice(0, 60), name: clean(raw?.name || raw?.id).slice(0, 60),
    description: clean(raw?.description).slice(0, 180), requestValue: clean(raw?.requestValue || raw?.request_value || raw?.id).slice(0, 80),
    billingNotice: clean(raw?.billingNotice || raw?.billing_notice).slice(0, 180),
  })).filter((item) => item.id && item.requestValue);
}

export function normalizeCapabilityRecord(raw, fallbackModelId = '', defaults = {}) {
  const modelId = clean(raw?.modelId || raw?.id || fallbackModelId);
  const reasoningMap = normalizeReasoningMap(raw?.reasoningMap || raw?.reasoning_map || raw?.reasoningEfforts);
  const reasoningEfforts = Object.entries(reasoningMap).filter(([, mapped]) => typeof mapped === 'string').map(([level]) => level);
  const serviceTiers = normalizeServiceTiers(raw?.serviceTiers || raw?.service_tiers);
  const status = ['confirmed', 'unsupported', 'unknown', 'verification_failed'].includes(raw?.status) ? raw.status : reasoningEfforts.length || serviceTiers.length ? 'confirmed' : 'unknown';
  const builtin = raw?.source === 'frakio_builtin' || defaults.source === 'frakio_builtin';
  const reasoningStatus = ['confirmed', 'unsupported', 'unknown', 'verification_failed'].includes(raw?.reasoningStatus) ? raw.reasoningStatus : reasoningEfforts.length ? 'confirmed' : (status === 'unsupported' || builtin) ? 'unsupported' : 'unknown';
  const serviceTierStatus = ['confirmed', 'unsupported', 'unknown', 'verification_failed'].includes(raw?.serviceTierStatus) ? raw.serviceTierStatus : serviceTiers.length ? 'confirmed' : (status === 'unsupported' || builtin) ? 'unsupported' : 'unknown';
  return {
    ...emptyCapability(modelId),
    modelId,
    name: clean(raw?.name || modelId),
    input: Array.isArray(raw?.input) ? raw.input.map(clean).filter(Boolean) : ['text'],
    contextLength: Number.isFinite(Number(raw?.contextLength ?? raw?.context_length)) ? Number(raw.contextLength ?? raw.context_length) : null,
    defaultReasoning: clean(raw?.defaultReasoning || raw?.default_reasoning),
    reasoningMap,
    reasoningEfforts,
    serviceTiers,
    speedModes: serviceTiers.length ? ['standard', ...serviceTiers.map((tier) => tier.id)] : ['standard'],
    reasoning: reasoningEfforts.length > 0,
    reasoningType: reasoningEfforts.length > 1 ? 'levels' : reasoningEfforts.length ? 'binary' : 'none',
    fastMode: serviceTiers.some((tier) => tier.requestValue === 'priority') ? 'openai_priority' : serviceTiers.some((tier) => tier.requestValue === 'fast') ? 'anthropic_fast' : 'none',
    source: clean(raw?.source || defaults.source || 'unknown'),
    confidence: ['confirmed', 'inferred', 'unknown'].includes(raw?.confidence) ? raw.confidence : defaults.confidence || (status === 'confirmed' ? 'confirmed' : 'unknown'),
    status,
    reasoningStatus,
    serviceTierStatus,
    updatedAt: raw?.updatedAt || raw?.updated_at || defaults.updatedAt || null,
    apiMode: normalizeApiMode(raw?.apiMode),
    thinkingFormat: CHAT_THINKING_FORMATS.includes(raw?.thinkingFormat) ? raw.thinkingFormat : '',
    requestOverrides: safeOverrides(raw?.requestOverrides),
    ...(raw?.verificationError ? { verificationError: clean(raw.verificationError).slice(0, 500) } : {}),
  };
}

function exactBuiltin(model, modelId) {
  return BUILTIN_CATALOG[catalogKey(model, modelId)] || null;
}

function manualRecord(model, modelId) {
  if (model?.capabilityMode !== 'manual') return null;
  const raw = model?.capabilityOverrides?.[modelId] || model?.capabilityOverrides?.['*'];
  if (!raw || typeof raw !== 'object') return null;
  const legacyMap = raw.reasoning === false ? {} : (raw.reasoningMap && Object.keys(raw.reasoningMap).length ? raw.reasoningMap : Object.fromEntries((raw.reasoningEfforts || []).map((level) => [level, level === 'off' ? 'none' : level])));
  const legacyTiers = Array.isArray(raw.serviceTiers) && raw.serviceTiers.length ? raw.serviceTiers : (raw.fastMode === 'openai_priority' ? [serviceTier('priority', '快速', 'OpenAI Priority Processing', 'priority', '厂商可能额外计费')] : raw.fastMode === 'anthropic_fast' ? [serviceTier('fast', '快速', 'Anthropic Fast Mode', 'fast', '厂商可能额外计费')] : []);
  return normalizeCapabilityRecord({ ...raw, modelId, reasoningMap: legacyMap, serviceTiers: legacyTiers, source: 'manual', confidence: 'confirmed', status: raw.status || ((Object.keys(legacyMap).length || legacyTiers.length) ? 'confirmed' : 'unsupported') });
}

export function resolveCapability(model, modelId, sources = {}) {
  const id = clean(modelId || model?.model);
  const manual = manualRecord(model, id);
  if (manual) return manual;
  const key = catalogKey(model, id);
  const rich = sources.providerCatalog?.[key];
  const routeBaseUrl = clean(model?.baseUrl).replace(/\/+$/, '').toLowerCase();
  const routeMatches = rich?.source !== 'active_probe' || clean(rich?.routeBaseUrl).replace(/\/+$/, '').toLowerCase() === routeBaseUrl;
  if (rich && routeMatches) return normalizeCapabilityRecord(rich, id, { source: 'provider_catalog' });
  const runtime = sources.runtimeCatalog?.[key];
  if (runtime) return normalizeCapabilityRecord(runtime, id, { source: 'hermes_runtime' });
  const builtin = exactBuiltin(model, id);
  if (builtin) return normalizeCapabilityRecord(builtin, id);
  return emptyCapability(id);
}

function safeOverrides(value) {
  const result = {};
  for (const [key, val] of Object.entries(value && typeof value === 'object' ? value : {})) {
    if (!key || PROTECTED_OVERRIDE_KEYS.has(lower(key))) continue;
    if (val === null || ['string', 'number', 'boolean'].includes(typeof val) || Array.isArray(val) || (val && typeof val === 'object')) result[key] = val;
  }
  return result;
}

function chatReasoningOverrides(format, mapped) {
  if (!mapped) return {};
  if (format === 'openrouter') return { reasoning: { effort: mapped } };
  if (format === 'deepseek') return mapped === 'none'
    ? { thinking: { type: 'disabled' } }
    : { thinking: { type: 'enabled' }, reasoning_effort: mapped };
  if (format === 'together') return { reasoning_effort: mapped };
  if (format === 'zai') return { thinking: { type: mapped === 'none' ? 'disabled' : 'enabled' } };
  if (format === 'qwen') return { enable_thinking: mapped !== 'none' };
  if (format === 'chat_template') return { chat_template_kwargs: { enable_thinking: mapped !== 'none' } };
  if (format === 'string_thinking') return { thinking: mapped };
  return { reasoning_effort: mapped };
}

export function adapterFor(model = {}) {
  const mode = normalizeApiMode(model.apiMode);
  const providerKey = lower(model.providerKey);
  if (mode === 'anthropic_messages') return { id: 'anthropic_messages', apiMode: mode, catalogKind: 'anthropic', modelsPaths: ['/v1/models', '/models'] };
  if (mode === 'codex_responses' || mode === 'openai_responses') return { id: providerKey === 'openai-codex' ? 'openai_codex_responses' : 'openai_responses', apiMode: mode, catalogKind: 'openai', modelsPaths: ['/v1/models', '/models'] };
  if (providerKey === 'openrouter') return { id: 'openrouter', apiMode: 'chat_completions', catalogKind: 'openrouter', modelsPaths: ['/api/v1/models', '/v1/models', '/models'] };
  if (providerKey === 'deepseek') return { id: 'deepseek', apiMode: 'chat_completions', catalogKind: 'openai', modelsPaths: ['/models', '/v1/models'] };
  if (providerKey === 'gemini' || providerKey === 'google-gemini-cli') return { id: 'gemini', apiMode: 'chat_completions', catalogKind: 'gemini', modelsPaths: ['/models', '/v1/models'] };
  if (providerKey === 'lmstudio') return { id: 'lmstudio', apiMode: 'chat_completions', catalogKind: 'openai', modelsPaths: ['/v1/models', '/models'] };
  return { id: 'openai_chat', apiMode: mode || 'chat_completions', catalogKind: 'openai', modelsPaths: ['/v1/models', '/models'] };
}

export function candidateModelUrls(model = {}) {
  const raw = clean(model.modelsUrl || model.models_url);
  if (raw) return [raw];
  let parsed;
  try { parsed = new URL(clean(model.baseUrl)); } catch { return []; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return [];
  parsed.pathname = parsed.pathname.replace(/\/(chat\/completions|responses|messages|models)\/?$/i, '').replace(/\/$/, '');
  const root = `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '');
  const origin = parsed.origin;
  return Array.from(new Set(adapterFor(model).modelsPaths.map((suffix) => {
    if (/\/v\d+$/.test(parsed.pathname) && suffix.startsWith('/v1/')) return `${root}${suffix.slice(3)}`;
    if (suffix.startsWith('/api/') && parsed.pathname.startsWith('/api/')) return `${origin}${suffix}`;
    return `${root}${suffix}`;
  })));
}

export function mapRunSettings(model, capability, requested = {}) {
  const reasoningLevel = clean(requested.reasoningEffort);
  const serviceTierId = clean(requested.serviceTier || requested.speedMode);
  const mappedReasoning = reasoningLevel && typeof capability?.reasoningMap?.[reasoningLevel] === 'string' ? capability.reasoningMap[reasoningLevel] : '';
  const tier = (capability?.serviceTiers || []).find((item) => item.id === serviceTierId || (serviceTierId === 'fast' && ['priority', 'fast'].includes(item.id)));
  const mode = normalizeApiMode(capability?.apiMode || model?.modelApiModes?.[capability?.modelId] || model?.apiMode);
  const compat = { ...(model?.compat || {}), ...(model?.modelCompat?.[capability?.modelId] || {}), ...(capability?.thinkingFormat ? { thinkingFormat: capability.thinkingFormat } : {}), ...(capability?.requestOverrides ? { requestOverrides: capability.requestOverrides } : {}) };
  const automaticDeepSeekOfficial = model?.capabilityMode !== 'manual'
    && lower(model?.providerKey) === 'deepseek'
    && baseUrlClass(model?.baseUrl) === 'deepseek-official';
  const thinkingFormat = automaticDeepSeekOfficial ? 'deepseek' : compat.thinkingFormat || 'openai';
  const runtimeOverrides = { request_overrides: safeOverrides(compat.requestOverrides) };
  if (mappedReasoning) {
    if (mode === 'codex_responses' || mode === 'openai_responses') runtimeOverrides.reasoning_config = { effort: mappedReasoning };
    else if (mode === 'anthropic_messages') runtimeOverrides.reasoning_config = { effort: mappedReasoning };
    else runtimeOverrides.request_overrides = { ...runtimeOverrides.request_overrides, ...chatReasoningOverrides(thinkingFormat, mappedReasoning) };
  }
  if (tier?.requestValue === 'priority') runtimeOverrides.service_tier = 'priority';
  else if (tier?.requestValue === 'fast') runtimeOverrides.request_overrides.speed = 'fast';
  return {
    requestedReasoning: reasoningLevel || 'default', effectiveReasoning: mappedReasoning || 'default',
    requestedServiceTier: serviceTierId || 'standard', effectiveServiceTier: tier?.id || 'standard', runtimeOverrides,
  };
}
