import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const extensionRoot = resolve('extension/familysearch-collector');
const manifestPath = resolve(extensionRoot, 'manifest.json');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const scripts = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? [])
].filter(Boolean);

for (const script of scripts) {
  await execFileAsync(process.execPath, ['--check', resolve(extensionRoot, script)]);
}

await access(resolve(extensionRoot, 'app/index.html'));

console.log(`Extension manifest, Angular app, and ${scripts.length} script(s) passed checks.`);
