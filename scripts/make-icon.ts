// Draws the Rea mark (a soft dark blob with two eyes) and writes
// assets/icon-256.png, assets/rea.ico and assets/rea.icns.
// Run once after changing the drawing: node scripts/make-icon.ts
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const size = 256;
const samples = 4; // 4x4 supersampling gives smooth edges at icon sizes

// Signed-distance-like coverage tests in a unit square (0..1).
function inBlob(x: number, y: number): boolean {
  // Superellipse body, slightly wider at the bottom, gently wobbling outline.
  const cx = 0.5, cy = 0.53;
  const dx = (x - cx) / 0.42;
  const dy = (y - cy) / (y > cy ? 0.40 : 0.43);
  const angle = Math.atan2(dy, dx);
  const wobble = 1 + 0.035 * Math.sin(angle * 3 + 0.6);
  return Math.pow(Math.abs(dx), 2.6) + Math.pow(Math.abs(dy), 2.6) <= wobble;
}
function inEye(x: number, y: number): boolean {
  const ey = 0.5, rx = 0.045, ry = 0.075;
  for (const ex of [0.39, 0.61]) {
    if (((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2 <= 1) return true;
  }
  return false;
}

const body = [17, 17, 17];
const eye = [255, 255, 255];
const rgba = Buffer.alloc(size * size * 4);
for (let py = 0; py < size; py++) {
  for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < samples; sy++) {
      for (let sx = 0; sx < samples; sx++) {
        const x = (px + (sx + 0.5) / samples) / size;
        const y = (py + (sy + 0.5) / samples) / size;
        if (!inBlob(x, y)) continue;
        const c = inEye(x, y) ? eye : body;
        r += c[0]; g += c[1]; b += c[2]; a += 255;
      }
    }
    const n = samples * samples;
    const covered = a / 255;
    const i = (py * size + px) * 4;
    rgba[i] = covered ? Math.round(r / covered) : 0;
    rgba[i + 1] = covered ? Math.round(g / covered) : 0;
    rgba[i + 2] = covered ? Math.round(b / covered) : 0;
    rgba[i + 3] = Math.round(a / n);
  }
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);

// ICO with one embedded 256px PNG (supported since Windows Vista).
const icoHeader = Buffer.from([0, 0, 1, 0, 1, 0]);
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0; entry[4] = 1; entry[6] = 32; // 0 means 256; 1 plane; 32 bpp
entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12);
const ico = Buffer.concat([icoHeader, entry, png]);

// ICNS with one 256px PNG element ('ic08').
const element = Buffer.alloc(8); element.write('ic08', 0, 'ascii'); element.writeUInt32BE(png.length + 8, 4);
const icnsHeader = Buffer.alloc(8); icnsHeader.write('icns', 0, 'ascii'); icnsHeader.writeUInt32BE(16 + png.length, 4);
const icns = Buffer.concat([icnsHeader, element, png]);

mkdirSync(join(root, 'assets'), { recursive: true });
writeFileSync(join(root, 'assets', 'icon-256.png'), png);
writeFileSync(join(root, 'assets', 'rea.ico'), ico);
writeFileSync(join(root, 'assets', 'rea.icns'), icns);
console.log('Wrote assets/icon-256.png, assets/rea.ico, assets/rea.icns');
