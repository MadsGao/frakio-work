const clean = (value) => String(value || '').trim();

function numberFrom(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return 0;
}

export function sanitizeRunError(value) {
  return clean(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[已隐藏]')
    .slice(0, 240);
}

export function safeMappedParameters(runtimeOverrides = {}) {
  const request = runtimeOverrides?.request_overrides || {};
  const result = {};
  if (runtimeOverrides?.reasoning_config?.effort) result.reasoning = { effort: clean(runtimeOverrides.reasoning_config.effort) };
  if (request?.reasoning_effort) result.reasoning_effort = clean(request.reasoning_effort);
  if (request?.reasoning?.effort) result.reasoning = { effort: clean(request.reasoning.effort) };
  if (request?.extra_body?.thinking?.type) result.thinking = { type: clean(request.extra_body.thinking.type) };
  if (runtimeOverrides?.service_tier) result.service_tier = clean(runtimeOverrides.service_tier);
  if (request?.speed) result.speed = clean(request.speed);
  return result;
}

export function createModelRunDiagnostic({ id, createdAt, thread, agent, profileName, runModel, runCapability, runMapping }) {
  return {
    id,
    runId: '',
    createdAt,
    updatedAt: createdAt,
    completedAt: '',
    threadId: clean(thread?.id),
    agentName: clean(agent?.name),
    profileName: clean(profileName),
    provider: clean(runModel?.modelProfile?.name || runModel?.modelProfile?.provider || runModel?.provider),
    providerKey: clean(runModel?.modelProfile?.providerKey || runModel?.provider),
    model: clean(runModel?.model),
    transport: clean(runCapability?.apiMode || runModel?.modelProfile?.apiMode || 'hermes_profile'),
    requestedReasoning: clean(runMapping?.requestedReasoning || 'default'),
    effectiveReasoning: clean(runMapping?.effectiveReasoning || 'default'),
    requestedServiceTier: clean(runMapping?.requestedServiceTier || 'standard'),
    effectiveServiceTier: clean(runMapping?.effectiveServiceTier || 'standard'),
    mappedParameters: safeMappedParameters(runMapping?.runtimeOverrides),
    status: 'starting',
    evidenceStatus: 'pending',
    reasoningTokens: 0,
    confirmedServiceTier: '',
    durationMs: 0,
    error: '',
  };
}

export function markModelRunSent(record, runId, updatedAt) {
  if (!record) return record;
  return { ...record, runId: clean(runId), updatedAt, status: 'sent', evidenceStatus: 'unconfirmed' };
}

export function finishModelRunDiagnostic(record, { status, completedAt, usage = {}, error = '' }) {
  if (!record) return record;
  const reasoningTokens = numberFrom(
    usage?.reasoning_tokens,
    usage?.output_tokens_details?.reasoning_tokens,
    usage?.completion_tokens_details?.reasoning_tokens,
  );
  const confirmedServiceTier = clean(usage?.service_tier || usage?.serviceTier || usage?.response?.service_tier);
  const confirmed = reasoningTokens > 0 || Boolean(confirmedServiceTier);
  const started = Date.parse(record.createdAt || '');
  const ended = Date.parse(completedAt || '');
  return {
    ...record,
    updatedAt: completedAt,
    completedAt,
    status,
    evidenceStatus: status === 'completed' ? (confirmed ? 'confirmed' : 'unconfirmed') : 'not_applicable',
    reasoningTokens,
    confirmedServiceTier,
    durationMs: Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0,
    error: sanitizeRunError(error),
  };
}
