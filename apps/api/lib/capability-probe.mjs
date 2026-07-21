import { normalizeCapabilityRecord, REASONING_LEVELS } from './provider-adapters.mjs';

const clean = (value) => String(value || '').trim();

function responseError(result) {
  return clean(result?.body?.error?.message || result?.error || (result?.status ? `HTTP ${result.status}` : '网络请求失败')).slice(0, 500);
}

export function classifyProbeResult(result) {
  if (result?.ok) return { status: 'accepted', error: '' };
  if (result?.status === 401 || result?.status === 403) return { status: 'auth_failed', error: responseError(result) };
  if (result?.status === 400 || result?.status === 422) return { status: 'unsupported', error: responseError(result) };
  return { status: 'unknown', error: responseError(result) };
}

function probeResult(kind, option, mappedValue, result) {
  const classified = classifyProbeResult(result);
  return { kind, option, mappedValue, ...classified };
}

function createRequestBody(modelId, patch = {}) {
  return { model: modelId, input: 'Reply OK.', max_output_tokens: 8, ...patch };
}

export async function probeResponsesCapabilities({ modelId, request, deadlineMs = 90000 }) {
  const startedAt = Date.now();
  const send = async (patch = {}) => {
    if (Date.now() - startedAt >= deadlineMs) return { ok: false, status: 0, error: '能力探测超过整体时间限制。' };
    try {
      return await request(createRequestBody(modelId, patch));
    } catch (error) {
      return { ok: false, status: 0, error: clean(error?.message || error) };
    }
  };

  const baseline = await send();
  const baselineStatus = classifyProbeResult(baseline);
  if (!baseline.ok) {
    const error = new Error(`配置验证失败：${baselineStatus.error}`);
    error.status = baseline.status || 502;
    throw error;
  }

  const results = [{ kind: 'connection', option: 'standard', mappedValue: 'standard', status: 'accepted', error: '' }];
  const reasoningMap = {};
  for (const level of REASONING_LEVELS) {
    const mappedValue = level === 'off' ? 'none' : level;
    const result = probeResult('reasoning', level, mappedValue, await send({ reasoning: { effort: mappedValue } }));
    if (result.status === 'auth_failed') {
      const error = new Error(`配置验证失败：${result.error}`);
      error.status = 401;
      throw error;
    }
    results.push(result);
    if (result.status === 'accepted') reasoningMap[level] = mappedValue;
    else if (result.status === 'unsupported') reasoningMap[level] = null;
  }

  const priorityResult = probeResult('service_tier', 'priority', 'priority', await send({ service_tier: 'priority' }));
  if (priorityResult.status === 'auth_failed') {
    const error = new Error(`配置验证失败：${priorityResult.error}`);
    error.status = 401;
    throw error;
  }
  results.push(priorityResult);

  const reasoningResults = results.filter((item) => item.kind === 'reasoning');
  const acceptedReasoning = reasoningResults.filter((item) => item.status === 'accepted');
  const reasoningStatus = acceptedReasoning.length
    ? 'confirmed'
    : reasoningResults.every((item) => item.status === 'unsupported') ? 'unsupported' : 'unknown';
  const serviceTierStatus = priorityResult.status === 'accepted' ? 'confirmed' : priorityResult.status === 'unsupported' ? 'unsupported' : 'unknown';
  const serviceTiers = priorityResult.status === 'accepted'
    ? [{ id: 'priority', name: '快速', description: '中转线路接受 Priority 服务层', requestValue: 'priority', billingNotice: '厂商可能额外计费' }]
    : [];
  const status = acceptedReasoning.length || serviceTiers.length
    ? 'confirmed'
    : reasoningStatus === 'unsupported' && serviceTierStatus === 'unsupported' ? 'unsupported' : 'unknown';
  const verifiedAt = new Date().toISOString();
  const capability = normalizeCapabilityRecord({
    modelId,
    defaultReasoning: acceptedReasoning[0]?.option || '',
    reasoningMap,
    serviceTiers,
    source: 'active_probe',
    confidence: 'inferred',
    status,
    reasoningStatus,
    serviceTierStatus,
    updatedAt: verifiedAt,
  }, modelId);

  return { capability, probeResults: results, verifiedAt };
}
