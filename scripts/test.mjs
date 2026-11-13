import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['tests/reader.test.ts', 'tests/desktop.test.ts'], bundle: true, platform: 'node',
  format: 'cjs', packages: 'external', outdir: '.test-build', outExtension: { '.js': '.cjs' } });
const result = spawnSync(process.execPath, ['--test', '.test-build/reader.test.cjs', '.test-build/desktop.test.cjs'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
