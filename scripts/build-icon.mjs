import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'apps/web/src/assets/frakio-brand-logo.png');
const iconset = path.join(root, 'build/icon.iconset');
const output = path.join(root, 'build/icon.icns');
const sizes = [16, 32, 128, 256, 512];

if (process.platform !== 'darwin') {
  console.log('Skipping macOS icon generation on a non-macOS platform.');
  process.exit(0);
}
await rm(iconset, { recursive: true, force: true });
await mkdir(iconset, { recursive: true });
for (const size of sizes) {
  await execFileAsync('sips', ['-z', String(size), String(size), source, '--out', path.join(iconset, `icon_${size}x${size}.png`)]);
  await execFileAsync('sips', ['-z', String(size * 2), String(size * 2), source, '--out', path.join(iconset, `icon_${size}x${size}@2x.png`)]);
}
await execFileAsync('iconutil', ['-c', 'icns', iconset, '-o', output]);
await rm(iconset, { recursive: true, force: true });
console.log(`Generated ${output}`);
