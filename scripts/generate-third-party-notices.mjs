import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const manifests = await Promise.all([
  'package.json',
  'apps/web/package.json',
  'apps/api/package.json',
  'apps/desktop/package.json',
  'packages/contracts/package.json',
].map(async (filePath) => JSON.parse(await readFile(filePath, 'utf8'))));
const names = [...new Set(manifests.flatMap((manifest) => Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })).filter((name) => !name.startsWith('@frakio/')))].sort();
const rows = [];
for (const name of names) {
  try {
    const manifest = JSON.parse(await readFile(path.join('node_modules', name, 'package.json'), 'utf8'));
    rows.push(`${name} ${manifest.version || ''} — ${manifest.license || 'SEE PACKAGE'}`);
  } catch {}
}
const content = `Third-Party Notices\n===================\n\nFrakio Work includes Hermes Agent under the MIT License. Bundled Python and Node packages retain their license files inside the release. Bundled Doto, Space Grotesk, and Space Mono font files are distributed through Fontsource under the SIL Open Font License 1.1.\n\nNode dependencies\n-----------------\n\n${rows.join('\n')}\n`;
await writeFile('THIRD_PARTY_NOTICES.txt', content, 'utf8');
console.log('Generated THIRD_PARTY_NOTICES.txt');
