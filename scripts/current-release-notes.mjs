import { readFile } from 'node:fs/promises';

const version = String(process.argv[2] || '').replace(/^v/i, '').trim();
if (!version) throw new Error('Usage: node scripts/current-release-notes.mjs <version-or-tag>');
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const heading = `## ${version} `;
const start = changelog.indexOf(heading);
if (start < 0) throw new Error(`CHANGELOG has no ${version} section.`);
const next = changelog.indexOf('\n## ', start + heading.length);
process.stdout.write(`${changelog.slice(start, next < 0 ? undefined : next).trim()}\n`);
