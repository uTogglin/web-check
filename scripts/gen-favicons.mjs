// One-off: regenerate the favicon raster set + favicon.ico from public/favicon.svg
// after recoloring the SVG to the purple theme. Run with: node scripts/gen-favicons.mjs
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const svg = readFileSync(join(pub, 'favicon.svg'));

// Render the SVG at a high density so downscaling stays crisp, into a square,
// transparent canvas (the source viewBox is ~38.8x37.9, nearly square).
const render = (size) =>
  sharp(svg, { density: 2000 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png();

const pngTargets = [
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['apple-touch-icon.png', 180],
  ['android-chrome-192x192.png', 192],
  ['android-chrome-512x512.png', 512],
];

for (const [name, size] of pngTargets) {
  await render(size).toFile(join(pub, name));
  console.log(`wrote ${name} (${size}px)`);
}

// Build a PNG-payload .ico containing 16 + 32 + 48 sizes (valid for all modern
// browsers). ICONDIR header + one ICONDIRENTRY per image + concatenated PNGs.
const icoSizes = [16, 32, 48];
const pngs = await Promise.all(icoSizes.map((s) => render(s).toBuffer()));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(icoSizes.length, 4); // image count

const entries = [];
let offset = 6 + icoSizes.length * 16;
icoSizes.forEach((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s === 256 ? 0 : s, 0); // width (0 = 256)
  e.writeUInt8(s === 256 ? 0 : s, 1); // height
  e.writeUInt8(0, 2); // palette
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // color planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(pngs[i].length, 8); // image data size
  e.writeUInt32LE(offset, 12); // image data offset
  offset += pngs[i].length;
  entries.push(e);
});

writeFileSync(join(pub, 'favicon.ico'), Buffer.concat([header, ...entries, ...pngs]));
console.log(`wrote favicon.ico (${icoSizes.join('+')}px)`);
