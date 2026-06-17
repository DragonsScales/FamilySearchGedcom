import { build, stop } from 'esbuild';

const runtimeScripts = [
  {
    entry: 'src/extension/background.ts',
    outfile: 'public/background.js'
  },
  {
    entry: 'src/extension/content-script.ts',
    outfile: 'public/content-script.js'
  }
];

for (const script of runtimeScripts) {
  await build({
    entryPoints: [script.entry],
    outfile: script.outfile,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent'
  });
}

stop();
console.log(`Built ${runtimeScripts.length} extension runtime script(s).`);
