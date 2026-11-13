import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { createServer } from 'vite';
import electron from 'electron';

await build({ entryPoints: ['src/main.ts', 'src/preload.ts'], bundle: true,
  platform: 'node', format: 'cjs', external: ['electron'], outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' } });
const server = await createServer({ server: { host: 'localhost', port: 5173, strictPort: true } });
await server.listen();
const env = { ...process.env, ZREAD_DEV_URL: 'http://localhost:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
child.on('exit', async (code) => { await server.close(); process.exit(code ?? 0); });
process.on('SIGINT', () => child.kill());
