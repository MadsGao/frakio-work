import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['dist', 'release', 'dist-electron', '.runtime-build', 'runtime/hermes', 'output', 'build/icon.icns', 'build/icon.iconset'];

for (const target of targets) {
  await rm(path.join(projectRoot, target), { recursive: true, force: true });
}

console.log('Removed generated build, runtime, release, and test artifacts.');
