import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const platform = String(process.argv[2] || '').trim();
const arch = String(process.argv[3] || '').trim();
if (!['mac', 'win'].includes(platform) || !['arm64', 'x64'].includes(arch)) {
  throw new Error('Usage: node scripts/generate-release-metadata.mjs <mac|win> <arm64|x64>');
}

const releaseDir = path.resolve('release');
const extensions = platform === 'mac' ? ['.dmg', '.zip'] : ['.exe'];
const packageVersion = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')).version;
const artifactPrefix = `Frakio.Work-${packageVersion}-${arch}`.toLowerCase();
const files = (await readdir(releaseDir))
  .filter((name) => name.toLowerCase().startsWith(artifactPrefix)
    && extensions.some((extension) => name.toLowerCase().endsWith(extension)))
  .sort();
if (!files.length) throw new Error(`No ${platform}-${arch} release packages found.`);

const checksumLines = [];
for (const name of files) {
  const digest = createHash('sha256').update(await readFile(path.join(releaseDir, name))).digest('hex');
  checksumLines.push(`${digest}  ${name}`);
}
const prefix = `Frakio-Work-${platform}-${arch}`;
await writeFile(path.join(releaseDir, `${prefix}-SHA256SUMS.txt`), `${checksumLines.join('\n')}\n`, 'utf8');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const { stdout: sbom } = await execFileAsync(npm, ['sbom', '--sbom-format', 'cyclonedx'], {
  cwd: path.resolve('.'),
  maxBuffer: 50 * 1024 * 1024,
});
await writeFile(path.join(releaseDir, `${prefix}-sbom.json`), sbom, 'utf8');
console.log(`Generated checksums and SBOM for ${platform}-${arch}.`);
