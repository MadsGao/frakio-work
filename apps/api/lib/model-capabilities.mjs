import { CHAT_THINKING_FORMATS, REASONING_LEVELS, mapRunSettings, normalizeCapabilityRecord, normalizeServiceTiers, resolveCapability } from './provider-adapters.mjs';

const clean = (value) => String(value || '').trim();

export function resolveModelCapability(model, modelName, sources = {}) {
  return resolveCapability(model, modelName, sources);
}

export function capabilitiesForModels(models = [], sources = {}) {
  const capabilities = {};
  for (const model of models) {
    const names = Array.from(new Set([...(model.models || []), model.model].map(clean).filter(Boolean)));
    for (const modelName of names) capabilities[`${model.id}::${modelName}`] = resolveCapability(model, modelName, sources);
  }
  return capabilities;
}

export function normalizeCapabilityOverrides(value) {
  const result = {};
  for (const [modelName, raw] of Object.entries(value && typeof value === 'object' ? value : {})) {
    const key = clean(modelName).slice(0, 100);
    if (!key || !raw || typeof raw !== 'object') continue;
    const legacyLevels = Array.isArray(raw.reasoningEfforts) ? raw.reasoningEfforts : [];
    const reasoningMap = raw.reasoningMap && typeof raw.reasoningMap === 'object' && Object.keys(raw.reasoningMap).length
      ? raw.reasoningMap
      : Object.fromEntries(legacyLevels.map((level) => [clean(level), clean(level) === 'off' || clean(level) === 'none' ? 'none' : clean(level)]));
    const normalized = normalizeCapabilityRecord({
      ...raw,
      modelId: key,
      reasoningMap: raw.reasoning === false ? {} : reasoningMap,
      serviceTiers: normalizeServiceTiers(raw.serviceTiers),
      source: 'manual',
      confidence: 'confirmed',
      status: raw.reasoning !== false && (Object.keys(reasoningMap).length || (raw.serviceTiers || []).length || raw.fastMode !== 'none') ? 'confirmed' : raw.status,
    }, key);
    result[key] = {
      status: normalized.status,
      defaultReasoning: normalized.defaultReasoning,
      reasoning: normalized.reasoning,
      reasoningEfforts: normalized.reasoningEfforts,
      reasoningMap: normalized.reasoningMap,
      serviceTiers: normalized.serviceTiers,
      apiMode: clean(raw.apiMode),
      thinkingFormat: CHAT_THINKING_FORMATS.includes(raw.thinkingFormat) ? raw.thinkingFormat : 'openai',
      requestOverrides: raw.requestOverrides && typeof raw.requestOverrides === 'object' ? raw.requestOverrides : {},
      fastMode: raw.fastMode || 'none',
    };
  }
  return result;
}

export { mapRunSettings };
export const reasoningEffortValues = [...REASONING_LEVELS];
