// Generates extension/icons/icon{16,32,48,128}.png — an indigo rounded tile with a white folder
// holding two "chat lines". No dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from '../extension/lib/zip.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');

const TILE = [79, 70, 229];
const WHITE = [255, 255, 255];
const INK = [79, 70, 229];

/** Inside a rounded rectangle? */
function rr(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Shape test in unit coordinates (0..1). Returns RGB or null (transparent). */
function shade(x, y) {
  if (!rr(x, y, 0, 0, 1, 1, 0.22)) return null;
  // folder: tab + body
  const tab = rr(x, y, 0.17, 0.22, 0.47, 0.36, 0.05);
  const body = rr(x, y, 0.17, 0.3, 0.83, 0.78, 0.07);
  if (!tab && !body) return TILE;
  // two "chat lines" inside the folder
  if (rr(x, y, 0.29, 0.45, 0.71, 0.53, 0.04)) return INK;
  if (rr(x, y, 0.29, 0.6, 0.57, 0.68, 0.04)) return INK;
  return WHITE;
}

function png(size) {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          if (c) {
            r += c[0]; g += c[1]; b += c[2]; a++;
          }
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(join(OUT, `icon${s}.png`), png(s));
console.log('icons written to', OUT);
