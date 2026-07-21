import { mkdir, rename, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CATALOG_VERSION, catalogKey, normalizeCapabilityRecord } from './provider-adapters.mjs';

export const CATALOG_REFRESH_MS = 4 * 60 * 60 * 1000;

function clean(value) { return String(value || '').trim(); }

function providerCacheKey(model = {}) {
  return [clean(model.providerKey) || 'custom', clean(model.apiMode) || 'unknown', clean(model.baseUrl).replace(/\/+$/, '').toLowerCase()].join('::');
}

export function readCatalogCache(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid cache');
    const cache = { version: 1, providers: {}, ...parsed, catalogVersion: CATALOG_VERSION };
    if (parsed.catalogVersion !== CATALOG_VERSION) {
      cache.verifications = {};
      for (const entry of Object.values(cache.providers)) {
        entry.records = Object.fromEntries(Object.entries(entry.records || {}).filter(([, record]) => record?.source !== 'active_probe'));
      }
    }
    return cache;
  } catch {
    return { version: 1, catalogVersion: CATALOG_VERSION, providers: {} };
  }
}

export async function writeCatalogCache(filePath, cache) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(cache, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, filePath);
}

export function flattenProviderCatalog(cache) {
  const result = {};
  for (const entry of Object.values(cache?.providers || {})) {
    for (const [key, record] of Object.entries(entry?.records || {})) result[key] = record;
  }
  return result;
}

export function catalogStatus(cache, model) {
  const entry = cache?.providers?.[providerCacheKey(model)];
  return {
    source: entry?.source || 'none',
    modelIds: Array.isArray(entry?.modelIds) ? [...entry.modelIds] : [],
    rich: entry?.source === 'provider_catalog',
    lastRefreshAt: entry?.lastRefreshAt || null,
    lastSuccessAt: entry?.lastSuccessAt || null,
    refreshError: entry?.refreshError || '',
    stale: !entry?.lastSuccessAt || Date.now() - Date.parse(entry.lastSuccessAt) >= CATALOG_REFRESH_MS,
  };
}

export function parseModelIds(body) {
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  return Array.from(new Set(rows
    .map((item) => clean(item?.id || item?.slug || item?.name || item))
    .filter(Boolean)))
    .sort();
}

export function parseCatalogResponse(body, model) {
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  const ids = parseModelIds(body);
  const records = {};
  let rich = false;
  for (const raw of rows) {
    const modelId = clean(raw?.id || raw?.slug || raw?.name || raw);
    if (!modelId) continue;
    if (!raw || typeof raw !== 'object') continue;
    const hasRichFields = raw.reasoningMap || raw.reasoning_map || raw.supported_reasoning_levels || raw.reasoning_levels || raw.service_tiers || raw.serviceTiers || raw.context_length || raw.context_window || raw.input;
    if (!hasRichFields) continue;
    rich = true;
    const reasoningMap = raw.reasoningMap || raw.reasoning_map || Object.fromEntries((raw.supported_reasoning_levels || raw.reasoning_levels || []).map((level) => [level, level]));
    records[catalogKey(model, modelId)] = normalizeCapabilityRecord({
      modelId,
      name: raw.display_name || raw.name || modelId,
      input: raw.input_modalities || raw.input || ['text'],
      contextLength: raw.context_length || raw.context_window,
      defaultReasoning: raw.default_reasoning_level || raw.default_reasoning,
      reasoningMap,
      serviceTiers: raw.service_tiers || raw.serviceTiers || [],
      source: 'provider_catalog',
      confidence: 'confirmed',
      status: 'confirmed',
      updatedAt: new Date().toISOString(),
    }, modelId);
  }
  return { ids, records, rich };
}

export async function updateProviderCatalog(filePath, cache, model, result) {
  const now = new Date().toISOString();
  const key = providerCacheKey(model);
  const previous = cache.providers[key] || {};
  cache.providers[key] = {
    ...previous,
    providerKey: clean(model.providerKey), apiMode: clean(model.apiMode), baseUrl: clean(model.baseUrl),
    source: result.rich ? 'provider_catalog' : 'model_ids',
    modelIds: result.ids,
    records: result.rich ? result.records : previous.records || {},
    lastRefreshAt: now, lastSuccessAt: now, refreshError: '', catalogVersion: CATALOG_VERSION,
  };
  await writeCatalogCache(filePath, cache);
  return cache.providers[key];
}

export async function recordCatalogError(filePath, cache, model, error) {
  const key = providerCacheKey(model);
  const previous = cache.providers[key] || {};
  cache.providers[key] = {
    ...previous,
    providerKey: clean(model.providerKey), apiMode: clean(model.apiMode), baseUrl: clean(model.baseUrl),
    lastRefreshAt: new Date().toISOString(), refreshError: clean(error?.message || error).slice(0, 500), catalogVersion: CATALOG_VERSION,
  };
  await writeCatalogCache(filePath, cache);
}

export async function recordActiveProbeCapability(filePath, cache, model, capability) {
  const key = providerCacheKey(model);
  const previous = cache.providers[key] || {};
  const scopedCapability = { ...capability, routeBaseUrl: clean(model.baseUrl).replace(/\/+$/, '').toLowerCase() };
  cache.providers[key] = {
    ...previous,
    providerKey: clean(model.providerKey), apiMode: clean(model.apiMode), baseUrl: clean(model.baseUrl),
    records: { ...(previous.records || {}), [catalogKey(model, capability.modelId)]: scopedCapability },
    catalogVersion: CATALOG_VERSION,
  };
  await writeCatalogCache(filePath, cache);
  return cache.providers[key];
}

export function invalidateVerification(cache, model) {
  const entry = cache.providers[providerCacheKey(model)];
  if (entry) entry.verifications = {};
}

export function verificationKey(model, modelId) {
  return [providerCacheKey(model), clean(modelId), CATALOG_VERSION].join('::');
}
