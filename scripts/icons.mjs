import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';

const svg = fs.readFileSync(new URL('../assets/zread.svg', import.meta.url));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((value) => new Resvg(svg, { fitTo: { mode: 'width', value } }).render().asPng());
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  header[entry] = size === 256 ? 0 : size;
  header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
});
fs.writeFileSync(new URL('../assets/zread.ico', import.meta.url), Buffer.concat([header, ...images]));
fs.writeFileSync(new URL('../assets/zread.png', import.meta.url), images.at(-1));
console.log('Generated ZRead PNG and multi-resolution Windows icon.');
