import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const rootPackage = JSON.parse(await readFile('package.json', 'utf8'));
const names = Object.keys({ ...rootPackage.dependencies, ...rootPackage.devDependencies }).sort();
const rows = [];
for (const name of names) {
  try {
    const manifest = JSON.parse(await readFile(path.join('node_modules', name, 'package.json'), 'utf8'));
    rows.push(`${name} ${manifest.version || ''} — ${manifest.license || 'SEE PACKAGE'}`);
  } catch {}
}
const content = `Third-Party Notices\n===================\n\nFrakio Work includes Hermes Agent under the MIT License. Bundled Python and Node packages retain their license files inside the release.\n\nNode dependencies\n-----------------\n\n${rows.join('\n')}\n`;
await writeFile('THIRD_PARTY_NOTICES.txt', content, 'utf8');
console.log('Generated THIRD_PARTY_NOTICES.txt');
