import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { catalogStatus, flattenProviderCatalog, parseCatalogResponse, parseModelIds, readCatalogCache, recordActiveProbeCapability, recordCatalogError, updateProviderCatalog } from './model-catalog-store.mjs';

const provider = { providerKey: 'custom:test', apiMode: 'chat_completions', baseUrl: 'https://relay.example/v1' };

test('provider catalog keeps last-known-good records after a refresh error', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-catalog-'));
  const filePath = path.join(root, 'catalog.json');
  try {
    const cache = readCatalogCache(filePath);
    const rich = parseCatalogResponse({ data: [{ id: 'reasoner', reasoning_levels: ['low', 'high'], context_length: 128000 }] }, provider);
    await updateProviderCatalog(filePath, cache, provider, rich);
    const before = flattenProviderCatalog(cache);
    assert.equal(Object.values(before)[0].contextLength, 128000);
    await recordCatalogError(filePath, cache, provider, new Error('temporary outage'));
    assert.deepEqual(flattenProviderCatalog(cache), before);
    assert.equal(catalogStatus(cache, provider).refreshError, 'temporary outage');
    assert.match(await readFile(filePath, 'utf8'), /reasoner/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plain model lists add IDs without fabricating capabilities', () => {
  const parsed = parseCatalogResponse({ data: [{ id: 'same-model', owned_by: 'relay' }] }, provider);
  assert.deepEqual(parsed.ids, ['same-model']);
  assert.equal(parsed.rich, false);
  assert.deepEqual(parsed.records, {});
});

test('Codex rich catalog parses object reasoning levels in Provider order', () => {
  const codex = { providerKey: 'openai-codex', apiMode: 'codex_responses', baseUrl: 'https://chatgpt.com/backend-api/codex' };
  const parsed = parseCatalogResponse({ models: [{
    slug: 'gpt-5.6-sol',
    default_reasoning_level: 'low',
    supported_reasoning_levels: [
      { effort: 'low', description: 'Quick responses' },
      { effort: 'medium', description: 'Balanced' },
      { effort: 'high', description: 'Deeper reasoning' },
      { effort: 'xhigh', description: 'Extra high' },
      { effort: 'max', description: 'Maximum' },
      { effort: 'ultra', description: 'Ultra' },
      { effort: 'high', description: 'Duplicate' },
      { description: 'Invalid' },
    ],
    service_tiers: [{ id: 'priority', name: 'Fast', request_value: 'priority' }],
  }] }, codex);
  const capability = Object.values(parsed.records)[0];
  assert.equal(parsed.rich, true);
  assert.equal(capability.defaultReasoning, 'low');
  assert.deepEqual(capability.reasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.equal(capability.reasoningStatus, 'confirmed');
  assert.equal(capability.serviceTiers[0].requestValue, 'priority');
});

test('rich catalog still supports string reasoning levels', () => {
  const parsed = parseCatalogResponse({ data: [{ id: 'reasoner', supported_reasoning_levels: ['off', 'low', 'high'] }] }, provider);
  const capability = Object.values(parsed.records)[0];
  assert.deepEqual(capability.reasoningMap, { off: 'none', low: 'low', high: 'high' });
});

test('model ids parse OpenAI, Hermes and direct string list responses', () => {
  assert.deepEqual(parseModelIds({ data: [{ id: 'gpt-b' }, { id: 'gpt-a' }] }), ['gpt-a', 'gpt-b']);
  assert.deepEqual(parseModelIds({ models: [{ name: 'hermes-b' }, 'hermes-a'] }), ['hermes-a', 'hermes-b']);
  assert.deepEqual(parseModelIds(['z-model', 'a-model', 'z-model']), ['a-model', 'z-model']);
});

test('active probe records stay scoped to the exact Provider route', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-probe-catalog-'));
  const filePath = path.join(root, 'catalog.json');
  try {
    const cache = readCatalogCache(filePath);
    await recordActiveProbeCapability(filePath, cache, provider, {
      modelId: 'same-model', source: 'active_probe', confidence: 'inferred', status: 'confirmed',
      reasoningMap: { high: 'high' }, serviceTiers: [],
    });
    const records = flattenProviderCatalog(cache);
    assert.equal(Object.keys(records).length, 1);
    assert.equal(Object.values(records)[0].source, 'active_probe');
    assert.equal(Object.values(records)[0].routeBaseUrl, 'https://relay.example/v1');
    assert.equal(records['custom:test::chat_completions::relay:relay.example::same-model'].reasoningMap.high, 'high');
    assert.equal(records['custom:other::chat_completions::relay:relay.example::same-model'], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('catalog version changes invalidate stale parsed capability records', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-old-catalog-'));
  const filePath = path.join(root, 'catalog.json');
  try {
    await writeFile(filePath, JSON.stringify({
      catalogVersion: 'old-version',
      providers: {
        old: {
          source: 'provider_catalog', modelIds: ['gpt-5.6-sol'], lastSuccessAt: new Date().toISOString(),
          records: { old: { modelId: 'gpt-5.6-sol', source: 'provider_catalog', reasoningMap: {} } },
        },
      },
    }));
    const cache = readCatalogCache(filePath);
    assert.deepEqual(cache.providers.old.records, {});
    assert.equal(cache.providers.old.source, 'model_ids');
    assert.equal(cache.providers.old.lastSuccessAt, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
