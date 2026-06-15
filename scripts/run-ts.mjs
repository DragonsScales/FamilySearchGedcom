import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, stop } from 'esbuild';

const [entry, ...scriptArgs] = process.argv.slice(2);
if (!entry) {
  console.error('Usage: node scripts/run-ts.mjs <entry.ts> [...args]');
  process.exitCode = 1;
} else {
  const outputDir = resolve('.local/compiled-scripts');
  const outputFile = resolve(outputDir, `${entry.replaceAll(/[^\w.-]/g, '_')}.mjs`);

  await mkdir(outputDir, { recursive: true });
  await build({
    entryPoints: [resolve(entry)],
    outfile: outputFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    sourcemap: false,
    logLevel: 'silent'
  });

  process.argv = [process.argv[0], outputFile, ...scriptArgs];
  await import(pathToFileURL(outputFile).href);
  stop();
}
