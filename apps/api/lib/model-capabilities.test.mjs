import assert from 'node:assert/strict';
import test from 'node:test';
import { mapRunSettings, normalizeCapabilityOverrides, resolveModelCapability } from './model-capabilities.mjs';
import { directHttpRequestOverrides } from './provider-adapters.mjs';
import { BUILTIN_CATALOG_META, candidateModelUrls, catalogKey } from './provider-adapters.mjs';

function model(overrides = {}) {
  return { providerKey: '', apiMode: 'chat_completions', baseUrl: '', model: '', capabilityMode: 'auto', ...overrides };
}

test('IkunCode gpt-5.6-sol uses its exact Responses catalog record', () => {
  const provider = model({ providerKey: 'ikuncode', baseUrl: 'https://api.ikuncode.cc/v1', apiMode: 'codex_responses' });
  const capability = resolveModelCapability(provider, 'gpt-5.6-sol');
  assert.equal(capability.defaultReasoning, 'low');
  assert.deepEqual(capability.reasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.equal(capability.serviceTiers[0].id, 'priority');
  const mapped = mapRunSettings(provider, capability, { reasoningEffort: 'ultra', speedMode: 'priority' });
  assert.deepEqual(mapped.runtimeOverrides.reasoning_config, { effort: 'ultra' });
  assert.equal(mapped.runtimeOverrides.service_tier, 'priority');
});

test('same model id on an unknown relay stays unknown', () => {
  const relay = model({ providerKey: 'custom:relay', baseUrl: 'https://relay.example/v1', apiMode: 'codex_responses' });
  const capability = resolveModelCapability(relay, 'gpt-5.6-sol');
  assert.equal(capability.status, 'unknown');
  assert.equal(capability.reasoning, false);
  assert.deepEqual(capability.serviceTiers, []);
});

test('official Codex rich catalog keeps declared fields and fills only missing built-in dimensions', () => {
  const provider = model({ providerKey: 'openai-codex', baseUrl: 'https://chatgpt.com/backend-api/codex', apiMode: 'codex_responses' });
  const key = catalogKey(provider, 'gpt-5.6-sol');
  const capability = resolveModelCapability(provider, 'gpt-5.6-sol', { providerCatalog: {
    [key]: {
      modelId: 'gpt-5.6-sol', source: 'provider_catalog', status: 'confirmed',
      reasoningMap: {}, reasoningStatus: 'unknown',
      serviceTiers: [{ id: 'account-fast', name: 'Account Fast', requestValue: 'priority' }], serviceTierStatus: 'confirmed',
    },
  } });
  assert.deepEqual(capability.reasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.equal(capability.serviceTiers[0].id, 'account-fast');
  assert.equal(capability.source, 'provider_catalog');
});

test('official Codex explicit empty reasoning support is not replaced by built-in data', () => {
  const provider = model({ providerKey: 'openai-codex', baseUrl: 'https://chatgpt.com/backend-api/codex', apiMode: 'codex_responses' });
  const key = catalogKey(provider, 'gpt-5.6-sol');
  const capability = resolveModelCapability(provider, 'gpt-5.6-sol', { providerCatalog: {
    [key]: {
      modelId: 'gpt-5.6-sol', source: 'provider_catalog', status: 'confirmed',
      reasoningMap: {}, reasoningStatus: 'unsupported', serviceTiers: [], serviceTierStatus: 'unsupported',
    },
  } });
  assert.deepEqual(capability.reasoningEfforts, []);
  assert.equal(capability.reasoningStatus, 'unsupported');
  assert.deepEqual(capability.serviceTiers, []);
});

test('active probe capabilities do not survive a Base URL change', () => {
  const relay = model({ providerKey: 'custom:relay', baseUrl: 'https://new.example/v1', apiMode: 'codex_responses' });
  const key = catalogKey(relay, 'gpt-5.6-sol');
  const capability = resolveModelCapability(relay, 'gpt-5.6-sol', { providerCatalog: {
    [key]: { modelId: 'gpt-5.6-sol', source: 'active_probe', routeBaseUrl: 'https://old.example/v1', reasoningMap: { high: 'high' }, status: 'confirmed' },
  } });
  assert.equal(capability.status, 'unknown');
});

test('Pi-style reasoning map preserves supported, unsupported and missing levels', () => {
  const provider = model({
    providerKey: 'custom:relay', baseUrl: 'https://relay.example/v1', capabilityMode: 'manual',
    capabilityOverrides: normalizeCapabilityOverrides({ vendor: { reasoning: true, reasoningMap: { low: 'small', high: null }, thinkingFormat: 'openrouter' } }),
    compat: { thinkingFormat: 'openrouter' },
  });
  const capability = resolveModelCapability(provider, 'vendor');
  assert.deepEqual(capability.reasoningMap, { low: 'small', high: null });
  assert.deepEqual(capability.reasoningEfforts, ['low']);
  assert.equal(capability.reasoningMap.medium, undefined);
  assert.deepEqual(mapRunSettings(provider, capability, { reasoningEffort: 'low' }).runtimeOverrides.request_overrides, { reasoning: { effort: 'small' } });
});

test('chat adapters map DeepSeek, Z.AI and Qwen explicitly', () => {
  const capability = { reasoningMap: { high: 'high' }, serviceTiers: [], modelId: 'vendor' };
  const mapped = (thinkingFormat) => mapRunSettings(model({ compat: { thinkingFormat }, apiMode: 'chat_completions' }), capability, { reasoningEffort: 'high' }).runtimeOverrides.request_overrides;
  assert.deepEqual(mapped('deepseek'), { extra_body: { thinking: { type: 'enabled' } }, reasoning_effort: 'high' });
  assert.deepEqual(mapped('zai'), { thinking: { type: 'enabled' } });
  assert.deepEqual(mapped('qwen'), { enable_thinking: true });
});

test('official DeepSeek auto mode disables thinking without an invalid none effort', () => {
  const provider = model({
    providerKey: 'deepseek', baseUrl: 'https://api.deepseek.com', apiMode: 'chat_completions',
    capabilityMode: 'auto', compat: { thinkingFormat: 'openai' },
  });
  const capability = resolveModelCapability(provider, 'deepseek-v4-flash');
  const disabled = mapRunSettings(provider, capability, { reasoningEffort: 'off' }).runtimeOverrides.request_overrides;
  const high = mapRunSettings(provider, capability, { reasoningEffort: 'high' }).runtimeOverrides.request_overrides;
  const max = mapRunSettings(provider, capability, { reasoningEffort: 'max' }).runtimeOverrides.request_overrides;
  assert.deepEqual(disabled, { extra_body: { thinking: { type: 'disabled' } } });
  assert.equal('reasoning_effort' in disabled, false);
  assert.deepEqual(high, { extra_body: { thinking: { type: 'enabled' } }, reasoning_effort: 'high' });
  assert.deepEqual(max, { extra_body: { thinking: { type: 'enabled' } }, reasoning_effort: 'max' });
  assert.deepEqual(directHttpRequestOverrides(max), { thinking: { type: 'enabled' }, reasoning_effort: 'max' });
});

test('custom relays and manual mode do not inherit the official DeepSeek adapter', () => {
  const capability = { reasoningMap: { off: 'none' }, serviceTiers: [], modelId: 'deepseek-v4-flash' };
  const relay = model({ providerKey: 'custom:relay', baseUrl: 'https://relay.example/v1', compat: { thinkingFormat: 'openai' } });
  const manual = model({ providerKey: 'deepseek', baseUrl: 'https://api.deepseek.com', capabilityMode: 'manual', compat: { thinkingFormat: 'openai' } });
  assert.deepEqual(mapRunSettings(relay, capability, { reasoningEffort: 'off' }).runtimeOverrides.request_overrides, { reasoning_effort: 'none' });
  assert.deepEqual(mapRunSettings(manual, capability, { reasoningEffort: 'off' }).runtimeOverrides.request_overrides, { reasoning_effort: 'none' });
});

test('protected request fields are discarded', () => {
  const capability = { reasoningMap: {}, serviceTiers: [], modelId: 'vendor' };
  const mapped = mapRunSettings(model({ compat: { thinkingFormat: 'openai', requestOverrides: { stream: false, Authorization: 'secret', temperature: 0.2 } } }), capability, {});
  assert.deepEqual(mapped.runtimeOverrides.request_overrides, { temperature: 0.2 });
});

test('catalog metadata is versioned and candidate model URLs are de-duplicated', () => {
  assert.match(BUILTIN_CATALOG_META.hash, /^[a-f0-9]{64}$/);
  assert.equal(catalogKey({ providerKey: 'x', apiMode: 'chat_completions', baseUrl: 'https://one.example/v1' }, 'same').includes('relay:one.example'), true);
  assert.deepEqual(candidateModelUrls({ providerKey: 'custom:x', apiMode: 'chat_completions', baseUrl: 'https://one.example/v1' }), ['https://one.example/v1/models']);
});
