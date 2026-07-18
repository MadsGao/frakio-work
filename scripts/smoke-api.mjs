import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const home = await mkdtemp(path.join(os.tmpdir(), 'frakio-smoke-'));
const port = 18987;
const child = spawn(process.execPath, ['apps/api/server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), FRAKIO_WORK_HOME: home, FRAKIO_WORK_DISABLE_AUTOSTART: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });

try {
  let response = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    response = await fetch(`http://127.0.0.1:${port}/api/health`).catch(() => null);
    if (response?.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!response?.ok) throw new Error(`API health check failed.\n${output}`);
  const payload = await response.json();
  if (!payload.ok) throw new Error(`Unexpected health response: ${JSON.stringify(payload)}`);
  console.log(`API smoke check passed on ${process.platform}-${process.arch}.`);
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 200));
  await rm(home, { recursive: true, force: true });
}
