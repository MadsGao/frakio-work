import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRunDiagnostic, finishModelRunDiagnostic, markModelRunSent, safeMappedParameters, sanitizeRunError } from './model-run-diagnostics.mjs';

test('diagnostic keeps only safe mapped run parameters', () => {
  assert.deepEqual(safeMappedParameters({
    reasoning_config: { effort: 'medium' },
    service_tier: 'priority',
    request_overrides: { Authorization: 'secret', api_key: 'secret', temperature: 0.2 },
  }), { reasoning: { effort: 'medium' }, service_tier: 'priority' });
});

test('DeepSeek diagnostic exposes SDK-safe thinking semantics without credentials', () => {
  const record = createModelRunDiagnostic({
    id: 'run_diag_1', createdAt: '2026-07-22T00:00:00.000Z', thread: { id: 'thread_1', title: '测试' }, agent: { name: 'Iris' }, profileName: 'iris',
    runModel: { model: 'deepseek-v4-pro', provider: 'deepseek', modelProfile: { name: 'DeepSeek', providerKey: 'deepseek', apiMode: 'chat_completions' } },
    runCapability: { apiMode: 'chat_completions' },
    runMapping: { requestedReasoning: 'max', effectiveReasoning: 'max', requestedServiceTier: 'standard', effectiveServiceTier: 'standard', runtimeOverrides: { request_overrides: { reasoning_effort: 'max', extra_body: { thinking: { type: 'enabled' } }, Authorization: 'secret' } } },
  });
  assert.deepEqual(record.mappedParameters, { reasoning_effort: 'max', thinking: { type: 'enabled' } });
  assert.equal(JSON.stringify(record).includes('secret'), false);
});

test('completed run stays unconfirmed without provider evidence', () => {
  const record = markModelRunSent({ id: 'run_diag_1', createdAt: '2026-07-22T00:00:00.000Z' }, 'run_1', '2026-07-22T00:00:01.000Z');
  const completed = finishModelRunDiagnostic(record, { status: 'completed', completedAt: '2026-07-22T00:00:04.000Z', usage: { total_tokens: 20 } });
  assert.equal(completed.evidenceStatus, 'unconfirmed');
  assert.equal(completed.durationMs, 4000);
});

test('reasoning tokens or service tier count as provider evidence', () => {
  const base = { id: 'run_diag_1', createdAt: '2026-07-22T00:00:00.000Z' };
  assert.equal(finishModelRunDiagnostic(base, { status: 'completed', completedAt: '2026-07-22T00:00:01.000Z', usage: { output_tokens_details: { reasoning_tokens: 12 } } }).evidenceStatus, 'confirmed');
  assert.equal(finishModelRunDiagnostic(base, { status: 'completed', completedAt: '2026-07-22T00:00:01.000Z', usage: { service_tier: 'priority' } }).confirmedServiceTier, 'priority');
});

test('errors are redacted before persistence', () => {
  assert.equal(sanitizeRunError('Bearer abc.def.ghi failed for sk-secret123456'), 'Bearer [已隐藏] failed for sk-[已隐藏]');
});
