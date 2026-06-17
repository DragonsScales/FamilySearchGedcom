import { build, stop } from 'esbuild';

const entryPoints = [
  'src/gedcom/convert.ts',
  'src/extension/background.ts',
  'src/extension/content-script.ts',
  'scripts/build-extension-scripts.ts',
  'scripts/check-explicit-types.ts',
  'scripts/check-extension.ts'
];

for (const entryPoint of entryPoints) {
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: entryPoint.startsWith('scripts/') || entryPoint.startsWith('src/gedcom/') ? 'node' : 'browser',
    format: 'esm',
    packages: 'external',
    write: false,
    logLevel: 'silent'
  });
}

stop();
console.log(`TypeScript entrypoint build checks passed for ${entryPoints.length} script(s).`);
