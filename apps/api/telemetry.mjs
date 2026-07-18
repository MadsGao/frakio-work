import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

export const TELEMETRY_EVENTS = new Set([
  'app_opened',
  'onboarding_completed',
  'project_created',
  'conversation_created',
  'agent_run_started',
  'agent_run_completed',
  'agent_run_failed',
  'agent_run_stopped',
  'feature_used',
  'meaningful_activity',
]);

export const TELEMETRY_FEATURES = new Set([
  'vault_indexed',
  'model_connected',
  'channel_connected',
  'skill_synced',
  'plugin_synced',
  'update_completed',
  'backup_created',
  'rollback_completed',
]);

const EVENT_PROPERTIES = {
  app_opened: new Set(['startup_ms']),
  onboarding_completed: new Set(['hermes_source', 'import_result']),
  project_created: new Set(['mode']),
  conversation_created: new Set(['kind']),
  agent_run_started: new Set(['agent_count', 'permission_mode', 'route_reason']),
  agent_run_completed: new Set(['duration_bucket', 'tool_count', 'approval_count']),
  agent_run_failed: new Set(['stage', 'error_code']),
  agent_run_stopped: new Set(['duration_bucket']),
  feature_used: new Set(['feature', 'outcome']),
  meaningful_activity: new Set(['action']),
};

const ENUMS = {
  mode: new Set(['create', 'existing']),
  kind: new Set(['direct', 'workspace']),
  permission_mode: new Set(['manual', 'smart', 'off']),
  route_reason: new Set(['user_mention', 'conversation_follow', 'default_agent', 'unknown']),
  stage: new Set(['startup', 'runtime', 'empty_output']),
  outcome: new Set(['completed']),
  import_result: new Set(['completed']),
  hermes_source: new Set(['bundled', 'managed', 'external', 'unknown']),
  action: new Set(['project_created', 'conversation_created', 'agent_run_started', 'vault_indexed', 'feature_used']),
};

const MAX_QUEUE_SIZE = 200;
const MAX_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 3_000;

function cleanString(value, maxLength = 64) {
  const text = String(value ?? '').trim().slice(0, maxLength);
  return /^[a-zA-Z0-9_.:-]+$/.test(text) ? text : '';
}

function cleanCount(value, max = 10_000) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : 0;
}

function durationBucket(value) {
  if (typeof value === 'string' && /^(under_10s|10s_1m|1m_5m|5m_30m|over_30m)$/.test(value)) return value;
  const ms = Math.max(0, Number(value) || 0);
  if (ms < 10_000) return 'under_10s';
  if (ms < 60_000) return '10s_1m';
  if (ms < 300_000) return '1m_5m';
  if (ms < 1_800_000) return '5m_30m';
  return 'over_30m';
}

export function sanitizeTelemetryProperties(eventName, input = {}) {
  if (!TELEMETRY_EVENTS.has(eventName) || !input || typeof input !== 'object' || Array.isArray(input)) return {};
  const allowed = EVENT_PROPERTIES[eventName] || new Set();
  const output = {};
  for (const key of allowed) {
    if (!(key in input)) continue;
    if (['agent_count', 'tool_count', 'approval_count', 'startup_ms'].includes(key)) {
      output[key] = cleanCount(input[key], key === 'startup_ms' ? 120_000 : 100);
      continue;
    }
    if (key === 'duration_bucket') {
      output[key] = durationBucket(input[key]);
      continue;
    }
    const value = cleanString(input[key]);
    if (!value) continue;
    if (key === 'feature' && !TELEMETRY_FEATURES.has(value)) continue;
    if (ENUMS[key] && !ENUMS[key].has(value)) continue;
    output[key] = value;
  }
  return output;
}

function defaultState() {
  return {
    schemaVersion: 1,
    installationId: randomUUID(),
    pendingEvents: [],
    sentLaunchIds: [],
    meaningfulDates: [],
    lastSentAt: null,
  };
}

function normalizeState(value) {
  const fallback = defaultState();
  const installationId = /^[0-9a-f-]{36}$/i.test(String(value?.installationId || '')) ? value.installationId : fallback.installationId;
  return {
    schemaVersion: 1,
    installationId,
    pendingEvents: Array.isArray(value?.pendingEvents) ? value.pendingEvents.slice(-MAX_QUEUE_SIZE) : [],
    sentLaunchIds: Array.isArray(value?.sentLaunchIds) ? value.sentLaunchIds.map(String).slice(-20) : [],
    meaningfulDates: Array.isArray(value?.meaningfulDates) ? value.meaningfulDates.map(String).slice(-40) : [],
    lastSentAt: value?.lastSentAt ? String(value.lastSentAt) : null,
  };
}

export class TelemetryClient {
  constructor(options = {}) {
    this.filePath = options.filePath;
    this.host = String(options.host || '').replace(/\/$/, '');
    this.websiteId = String(options.websiteId || '').trim();
    this.hostname = String(options.hostname || 'com.frakio.work').trim();
    this.runtimeEnabled = Boolean(options.runtimeEnabled);
    this.userEnabled = options.userEnabled !== false;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.flushIntervalMs = Number(options.flushIntervalMs || DEFAULT_FLUSH_INTERVAL_MS);
    this.timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    this.now = options.now || (() => new Date());
    this.state = null;
    this.writeChain = Promise.resolve();
    this.flushPromise = null;
    this.timer = null;
    this.consecutiveFailures = 0;
    this.nextAttemptAt = 0;
  }

  get configured() {
    return Boolean(this.host && /^[0-9a-f-]{36}$/i.test(this.websiteId));
  }

  get active() {
    return this.runtimeEnabled && this.userEnabled && this.configured;
  }

  async initialize() {
    if (this.state) return this.state;
    try {
      this.state = normalizeState(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch {
      this.state = defaultState();
      await this.persist();
    }
    if (this.runtimeEnabled && !this.timer) {
      this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
      this.timer.unref?.();
    }
    return this.state;
  }

  commonProperties() {
    const release = String(os.release() || '').split('.')[0];
    return {
      app_version: cleanString(process.env.FRAKIO_WORK_APP_VERSION || '0.0.0'),
      platform: cleanString(process.env.FRAKIO_WORK_PLATFORM || process.platform),
      os_major: cleanString(release),
      arch: cleanString(process.env.FRAKIO_WORK_ARCH || process.arch),
      build_channel: cleanString(process.env.FRAKIO_WORK_BUILD_CHANNEL || 'production'),
      runtime_mode: 'desktop',
      hermes_runtime_source: cleanString(process.env.FRAKIO_WORK_HERMES_SOURCE || 'unknown'),
      ...(cleanString(process.env.FRAKIO_WORK_HERMES_VERSION || '') ? { hermes_version: cleanString(process.env.FRAKIO_WORK_HERMES_VERSION) } : {}),
    };
  }

  async persist() {
    if (!this.state || !this.filePath) return;
    const snapshot = `${JSON.stringify(this.state, null, 2)}\n`;
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, snapshot, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    }).catch(() => {});
    await this.writeChain;
  }

  async setEnabled(enabled) {
    await this.initialize();
    this.userEnabled = Boolean(enabled);
    if (!this.userEnabled && this.state.pendingEvents.length) {
      this.state.pendingEvents = [];
      await this.persist();
    }
    return this.status();
  }

  async capture(eventName, properties = {}, options = {}) {
    await this.initialize();
    if (!this.active || !TELEMETRY_EVENTS.has(eventName)) return false;
    const dedupeKey = cleanString(options.dedupeKey || '', 120);
    if (dedupeKey && this.state.pendingEvents.some((event) => event.dedupeKey === dedupeKey)) return false;
    if (eventName === 'app_opened' && dedupeKey && this.state.sentLaunchIds.includes(dedupeKey)) return false;
    this.state.pendingEvents.push({
      id: randomUUID(),
      eventName,
      properties: { ...this.commonProperties(), ...sanitizeTelemetryProperties(eventName, properties) },
      timestamp: Math.floor(this.now().getTime() / 1000),
      dedupeKey,
    });
    this.state.pendingEvents = this.state.pendingEvents.slice(-MAX_QUEUE_SIZE);
    await this.persist();
    return true;
  }

  async captureMeaningfulActivity(action) {
    await this.initialize();
    if (!this.active) return false;
    const date = this.now().toLocaleDateString('en-CA');
    if (this.state.meaningfulDates.includes(date)) return false;
    const captured = await this.capture('meaningful_activity', { action }, { dedupeKey: `meaningful_${date}` });
    if (captured) {
      this.state.meaningfulDates = [...this.state.meaningfulDates, date].slice(-40);
      await this.persist();
    }
    return captured;
  }

  payloadFor(event) {
    return {
      type: 'event',
      payload: {
        website: this.websiteId,
        hostname: this.hostname,
        language: 'zh-CN',
        url: `/desktop/${event.eventName}`,
        name: event.eventName,
        data: event.properties,
        id: this.state.installationId,
        timestamp: event.timestamp,
      },
    };
  }

  payloadsFor(event) {
    const customEvent = this.payloadFor(event);
    if (event.eventName !== 'app_opened') return [customEvent];
    return [{
      type: 'event',
      payload: {
        website: this.websiteId,
        hostname: this.hostname,
        language: 'zh-CN',
        url: '/desktop',
        id: this.state.installationId,
        timestamp: event.timestamp,
      },
    }, customEvent];
  }

  userAgent() {
    const version = process.env.FRAKIO_WORK_APP_VERSION || '0.0.0';
    const platform = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
    return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) FrakioWork/${version} Safari/537.36`;
  }

  async flush() {
    await this.initialize();
    if (!this.active || !this.state.pendingEvents.length || this.flushPromise || Date.now() < this.nextAttemptAt) return this.flushPromise || false;
    this.flushPromise = (async () => {
      const batch = this.state.pendingEvents.slice(0, MAX_BATCH_SIZE);
      const outgoingPayloads = batch.flatMap((event) => this.payloadsFor(event));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.host}/api/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': this.userAgent() },
          body: JSON.stringify(outgoingPayloads),
          signal: controller.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || Number(result.processed) !== outgoingPayloads.length || Number(result.errors) > 0) {
          this.registerFailure();
          return false;
        }
        const sentIds = new Set(batch.map((event) => event.id));
        this.state.pendingEvents = this.state.pendingEvents.filter((event) => !sentIds.has(event.id));
        const launchKeys = batch.filter((event) => event.eventName === 'app_opened' && event.dedupeKey).map((event) => event.dedupeKey);
        this.state.sentLaunchIds = [...this.state.sentLaunchIds, ...launchKeys].slice(-20);
        this.state.lastSentAt = this.now().toISOString();
        this.consecutiveFailures = 0;
        this.nextAttemptAt = 0;
        await this.persist();
        return true;
      } catch {
        this.registerFailure();
        return false;
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => { this.flushPromise = null; });
    return this.flushPromise;
  }

  registerFailure() {
    this.consecutiveFailures = Math.min(6, this.consecutiveFailures + 1);
    this.nextAttemptAt = Date.now() + Math.min(15 * 60_000, 30_000 * (2 ** (this.consecutiveFailures - 1)));
  }

  status() {
    return {
      enabled: Boolean(this.userEnabled),
      configured: this.configured,
      queueSize: this.state?.pendingEvents?.length || 0,
      lastSentAt: this.state?.lastSentAt || null,
    };
  }

  async shutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
    await this.writeChain;
  }
}

export function createTelemetryClient(options) {
  return new TelemetryClient(options);
}
