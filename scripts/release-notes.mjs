/**
 * Prints the changelog entry of one version, for the release notes.
 *
 *   node scripts/release-notes.mjs v0.1.0
 */
import { readFile } from 'node:fs/promises';

const version = (process.argv[2] ?? '').replace(/^v/, '');
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version>');
  process.exit(1);
}

const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const lines = changelog.split('\n');

const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`CHANGELOG.md has no entry for ${version}`);
  process.exit(1);
}

const rest = lines.slice(start + 1);
const end = rest.findIndex((line) => line.startsWith('## '));
const entry = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();

console.log(entry || `Release ${version}.`);
