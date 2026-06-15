import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const extensionRoot = resolve('extension/familysearch-collector');
const manifestPath = resolve(extensionRoot, 'manifest.json');
const indexPath = resolve(extensionRoot, 'index.html');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const scripts = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? [])
].filter(Boolean);

for (const script of scripts) {
  await execFileAsync(process.execPath, ['--check', resolve(extensionRoot, script)]);
}

await access(indexPath);
const indexHtml = await readFile(indexPath, 'utf8');
if (/<script(?![^>]+src=)/i.test(indexHtml)) throw new Error('Extension index contains an inline script.');
if (/<style[\s>]/i.test(indexHtml)) throw new Error('Extension index contains an inline style.');

console.log(`Extension manifest, Angular app, and ${scripts.length} script(s) passed checks.`);
