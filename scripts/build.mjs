import { build as bundle } from 'esbuild';
import { build } from 'vite';

await bundle({
  entryPoints: ['src/main.ts', 'src/preload.ts'],
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  external: ['electron'], outdir: 'dist-electron', outExtension: { '.js': '.cjs' },
});
await build({ base: './' });
