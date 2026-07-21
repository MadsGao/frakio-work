import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeStep, summarizeRuntimeAutoStart } from './runtime-autostart.mjs';

test('optional Runtime API warning keeps the workbench ready', () => {
  const result = summarizeRuntimeAutoStart([
    runtimeStep('bridge', '启动聊天桥接', 'ready', '', 'core'),
    runtimeStep('api', '启动外部兼容 API', 'warning', 'HTTP 500', 'optional'),
  ]);
  assert.equal(result.status, 'ready');
  assert.equal(result.error, '');
  assert.deepEqual(result.warnings, ['启动外部兼容 API: HTTP 500']);
});

test('gateway failure is partial while Bridge failure is fatal', () => {
  const gateway = summarizeRuntimeAutoStart([
    runtimeStep('bridge', '启动聊天桥接', 'ready', '', 'core'),
    runtimeStep('gateways', '启动 Profile Gateway', 'failed', 'max 未运行', 'standard'),
  ]);
  assert.equal(gateway.status, 'partial');
  assert.equal(gateway.error, '');
  assert.deepEqual(gateway.warnings, ['启动 Profile Gateway: max 未运行']);

  const bridge = summarizeRuntimeAutoStart([
    runtimeStep('bridge', '启动聊天桥接', 'failed', 'socket unavailable', 'core'),
  ]);
  assert.equal(bridge.status, 'failed');
  assert.equal(bridge.error, '启动聊天桥接: socket unavailable');
});
