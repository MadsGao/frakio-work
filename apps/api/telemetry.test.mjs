import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TelemetryClient, sanitizeTelemetryProperties } from './telemetry.mjs';

async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'frakio-telemetry-'));
  const filePath = path.join(directory, 'telemetry.json');
  const requests = [];
  const fetchImpl = options.fetchImpl || (async (url, request) => {
    requests.push({ url, request, body: JSON.parse(request.body) });
    return { ok: true, json: async () => ({ processed: requests.at(-1).body.length, errors: 0 }) };
  });
  const client = new TelemetryClient({
    filePath,
    host: 'https://data.example.test',
    websiteId: '3fbceeb0-dffe-459c-9e5f-c6dff0c71708',
    runtimeEnabled: true,
    fetchImpl,
    flushIntervalMs: 60_000,
    timeoutMs: 100,
    now: options.now,
  });
  await client.initialize();
  return { client, directory, filePath, requests };
}

test('installation id is random and stable across restarts', async () => {
  const first = await fixture();
  const firstId = first.client.state.installationId;
  assert.match(firstId, /^[0-9a-f-]{36}$/i);
  await first.client.shutdown();
  const second = new TelemetryClient({
    filePath: first.filePath,
    host: 'https://data.example.test',
    websiteId: '3fbceeb0-dffe-459c-9e5f-c6dff0c71708',
    runtimeEnabled: true,
    fetchImpl: async () => ({ ok: true, json: async () => ({ processed: 0, errors: 0 }) }),
    flushIntervalMs: 60_000,
  });
  await second.initialize();
  assert.equal(second.state.installationId, firstId);
  await second.shutdown();
  await rm(first.directory, { recursive: true, force: true });
});

test('event sanitizer only keeps allowlisted non-sensitive values', () => {
  assert.deepEqual(sanitizeTelemetryProperties('project_created', {
    mode: 'existing',
    projectName: 'Secret launch',
    path: '/Users/example/private',
    email: 'person@example.com',
    prompt: 'private prompt',
  }), { mode: 'existing' });
  assert.deepEqual(sanitizeTelemetryProperties('feature_used', { feature: 'unknown_private_feature', outcome: 'completed' }), { outcome: 'completed' });
});

test('disabled telemetry does not capture and clears queued events', async () => {
  const ctx = await fixture();
  assert.equal(await ctx.client.capture('project_created', { mode: 'create' }), true);
  assert.equal(ctx.client.status().queueSize, 1);
  await ctx.client.setEnabled(false);
  assert.equal(ctx.client.status().queueSize, 0);
  assert.equal(await ctx.client.capture('project_created', { mode: 'create' }), false);
  const disk = JSON.parse(await readFile(ctx.filePath, 'utf8'));
  assert.equal(disk.pendingEvents.length, 0);
  await ctx.client.shutdown();
  await rm(ctx.directory, { recursive: true, force: true });
});

test('batch payload has stable distinct id and never includes an ip field', async () => {
  const ctx = await fixture();
  await ctx.client.capture('agent_run_started', { agent_count: 2, permission_mode: 'manual', route_reason: 'default_agent', message: 'secret' });
  assert.equal(await ctx.client.flush(), true);
  assert.equal(ctx.requests.length, 1);
  const item = ctx.requests[0].body[0];
  assert.equal(item.type, 'event');
  assert.equal(item.payload.website, '3fbceeb0-dffe-459c-9e5f-c6dff0c71708');
  assert.equal(item.payload.hostname, 'com.frakio.work');
  assert.equal(item.payload.id, ctx.client.state.installationId);
  assert.equal('ip' in item.payload, false);
  assert.equal('message' in item.payload.data, false);
  assert.match(ctx.requests[0].request.headers['User-Agent'], /^Mozilla\/5\.0/);
  await ctx.client.shutdown();
  await rm(ctx.directory, { recursive: true, force: true });
});

test('meaningful activity is limited to one event per local day', async () => {
  const fixed = new Date('2026-07-18T08:00:00.000Z');
  const ctx = await fixture({ now: () => fixed });
  assert.equal(await ctx.client.captureMeaningfulActivity('project_created'), true);
  assert.equal(await ctx.client.captureMeaningfulActivity('agent_run_started'), false);
  assert.equal(ctx.client.status().queueSize, 1);
  await ctx.client.shutdown();
  await rm(ctx.directory, { recursive: true, force: true });
});

test('launch id is not queued twice and remains deduplicated after send', async () => {
  const ctx = await fixture();
  assert.equal(await ctx.client.capture('app_opened', { startup_ms: 1200 }, { dedupeKey: 'launch_123' }), true);
  assert.equal(await ctx.client.capture('app_opened', { startup_ms: 1200 }, { dedupeKey: 'launch_123' }), false);
  await ctx.client.flush();
  assert.equal(ctx.requests[0].body.length, 2);
  assert.equal(ctx.requests[0].body[0].payload.url, '/desktop');
  assert.equal('name' in ctx.requests[0].body[0].payload, false);
  assert.equal(ctx.requests[0].body[1].payload.name, 'app_opened');
  assert.equal(await ctx.client.capture('app_opened', { startup_ms: 1200 }, { dedupeKey: 'launch_123' }), false);
  await ctx.client.shutdown();
  await rm(ctx.directory, { recursive: true, force: true });
});
