import { packager } from '@electron/packager';
import path from 'node:path';

const outputs = await packager({
  dir: '.', name: 'ZRead', platform: 'win32', arch: 'x64', out: 'release', overwrite: true,
  download: { cacheRoot: path.resolve('.electron-cache') },
  // Only ship compiled application files; development caches and old prototypes stay out.
  ignore: (file) => file !== '' && !/^\/(?:dist(?:\/|$)|dist-electron(?:\/|$)|package\.json$|README\.md$)/.test(file),
});
for (const output of outputs) console.log(`应用已生成：${path.resolve(output, 'ZRead.exe')}`);
