import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyProbeResult, probeResponsesCapabilities } from './capability-probe.mjs';

test('probe classifier separates unsupported, authentication and transient failures', () => {
  assert.equal(classifyProbeResult({ ok: false, status: 400, body: { error: { message: 'bad effort' } } }).status, 'unsupported');
  assert.equal(classifyProbeResult({ ok: false, status: 401 }).status, 'auth_failed');
  assert.equal(classifyProbeResult({ ok: false, status: 429 }).status, 'unknown');
  assert.equal(classifyProbeResult({ ok: false, status: 500 }).status, 'unknown');
  assert.equal(classifyProbeResult({ ok: false, status: 0, error: 'timeout' }).status, 'unknown');
});

test('Responses discovery probes every reasoning level and Priority independently', async () => {
  const bodies = [];
  const accepted = new Set(['low', 'high', 'xhigh']);
  const result = await probeResponsesCapabilities({
    modelId: 'gpt-test',
    request: async (body) => {
      bodies.push(body);
      if (body.service_tier === 'priority') return { ok: true, status: 200, body: {} };
      if (!body.reasoning) return { ok: true, status: 200, body: {} };
      if (body.reasoning.effort === 'medium') return { ok: false, status: 429, body: { error: { message: 'rate limited' } } };
      return accepted.has(body.reasoning.effort)
        ? { ok: true, status: 200, body: {} }
        : { ok: false, status: 400, body: { error: { message: 'unsupported effort' } } };
    },
  });

  assert.equal(bodies.length, 10);
  assert.deepEqual(bodies[1].reasoning, { effort: 'none' });
  assert.deepEqual(result.capability.reasoningEfforts, ['low', 'high', 'xhigh']);
  assert.equal(result.capability.reasoningMap.off, null);
  assert.equal('medium' in result.capability.reasoningMap, false);
  assert.equal(result.capability.serviceTiers[0].id, 'priority');
  assert.equal(result.capability.source, 'active_probe');
  assert.equal(result.capability.confidence, 'inferred');
  assert.equal(result.probeResults.find((item) => item.option === 'medium').status, 'unknown');
});

test('Responses discovery stops when the baseline request fails', async () => {
  let requests = 0;
  await assert.rejects(() => probeResponsesCapabilities({
    modelId: 'gpt-test',
    request: async () => {
      requests += 1;
      return { ok: false, status: 401, body: { error: { message: 'invalid key' } } };
    },
  }), /invalid key/);
  assert.equal(requests, 1);
});
