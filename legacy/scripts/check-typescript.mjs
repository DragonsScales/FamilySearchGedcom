import { build, stop } from 'esbuild';

const entryPoints = [
  'src/gedcom/convert.ts'
];

for (const entryPoint of entryPoints) {
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    write: false,
    logLevel: 'silent'
  });
}

stop();
console.log(`TypeScript entrypoint build checks passed for ${entryPoints.length} script(s).`);
