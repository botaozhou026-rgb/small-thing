import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const cache = path.resolve('.electron-cache');
const result = spawnSync(process.execPath, [require.resolve('electron/install.js')], {
  stdio: 'inherit', env: { ...process.env, electron_config_cache: cache, ELECTRON_CACHE: cache },
});
process.exit(result.status ?? 1);
