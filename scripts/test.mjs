import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['tests/reader.test.ts'], bundle: true, platform: 'node',
  format: 'cjs', packages: 'external', outfile: '.test-build/reader.test.cjs' });
const result = spawnSync(process.execPath, ['--test', '.test-build/reader.test.cjs'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
