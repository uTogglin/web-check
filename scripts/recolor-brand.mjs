// Recolor the brand raster images (banner + logo) from the original GREEN accent
// to the purple theme — WITHOUT touching the dark navy globe/background.
//
// The first recolor used a global hue rotation, which turned the navy sphere and
// banner background a muddy olive. This does a hue-SELECTIVE remap: only pixels in
// the green hue band are mapped to the brand purple (hue 262°, matching #7c3aed),
// preserving each pixel's saturation and lightness so highlights and gridlines keep
// their shading. Everything outside the green band (the navy) is left untouched.
//
// Inputs are the pre-recolor originals (navy + green), read straight from git
// history (the commit before the first, broken recolor); outputs overwrite public/.
// Run with: node scripts/recolor-brand.mjs
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const TARGET_HUE = 262; // #7c3aed
const GREEN_LO = 55;    // inclusive hue band treated as "brand green"
const GREEN_HI = 175;
const MIN_SAT = 0.16;   // leave near-gray pixels alone

// Commit 39b85ec was the first (global hue-rotate) recolor that muddied the navy;
// its parent holds the pristine green-on-navy originals.
const ORIG_REV = '39b85ec^';
const jobs = [
  ['public/web-check.png', 'public/web-check.png'],
  ['public/banner.png', 'public/banner.png'],
];

const readOriginal = (path) =>
  execFileSync('git', ['show', `${ORIG_REV}:${path}`], { cwd: root, maxBuffer: 1 << 28 });

const rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
};

const hue2rgb = (p, q, t) => {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
};

const hslToRgb = (h, s, l) => {
  h /= 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
};

for (const [inRel, outRel] of jobs) {
  const { data, info } = await sharp(readOriginal(inRel)).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let remapped = 0;
  for (let i = 0; i < data.length; i += ch) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (s >= MIN_SAT && h >= GREEN_LO && h < GREEN_HI) {
      const [r, g, b] = hslToRgb(TARGET_HUE, s, l);
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
      remapped++;
    }
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: ch } })
    .png().toFile(join(root, outRel));
  console.log(`${outRel}: remapped ${remapped} green px -> purple`);
}
