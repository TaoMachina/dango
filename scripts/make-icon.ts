// Draws the Dango mark (three soft dumplings with faces on one stick, like the 🍡 emoji:
// several agents, one place) and writes assets/icon-256.png, assets/dango.ico and assets/dango.icns.
// web/public/favicon.svg draws the same shapes. Run once after changing the drawing: node scripts/make-icon.ts
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const size = 256;
const samples = 4; // 4x4 supersampling gives smooth edges at icon sizes

type RGB = [number, number, number];
// Geometry in a 100x100 box, the same numbers as favicon.svg. Listed front to back.
const R = 17;
const EDGE = 1.6; // a darker rim keeps the light dumpling visible on white backgrounds
const balls: { x: number; y: number; fill: RGB; rim: RGB }[] = [
  { x: 66, y: 32, fill: [244, 154, 184], rim: [222, 120, 156] }, // pink
  { x: 50, y: 50, fill: [246, 236, 214], rim: [214, 196, 160] }, // cream
  { x: 34, y: 68, fill: [140, 196, 120], rim: [104, 164, 86] }, // matcha
];
const eyeColor: RGB = [34, 30, 28];
const stickColor: RGB = [196, 158, 108];

function inEye(x: number, y: number, bx: number, by: number) {
  for (const ex of [bx - 5, bx + 5]) if (((x - ex) / 1.9) ** 2 + ((y - by) / 2.9) ** 2 <= 1) return true;
  return false;
}
// The stick runs from (20, 84) to (80, 20) with round ends, 4.4 wide.
function inStick(x: number, y: number) {
  const ax = 20, ay = 84, bx = 80, by = 20;
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) <= 2.2;
}
function colorAt(x: number, y: number): RGB | null {
  for (const b of balls) {
    const d = Math.hypot(x - b.x, y - b.y);
    if (d > R) continue;
    if (inEye(x, y, b.x, b.y)) return eyeColor;
    return d > R - EDGE ? b.rim : b.fill;
  }
  return inStick(x, y) ? stickColor : null;
}

const rgba = Buffer.alloc(size * size * 4);
for (let py = 0; py < size; py++) {
  for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < samples; sy++) {
      for (let sx = 0; sx < samples; sx++) {
        const c = colorAt(((px + (sx + 0.5) / samples) / size) * 100, ((py + (sy + 0.5) / samples) / size) * 100);
        if (!c) continue;
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
writeFileSync(join(root, 'assets', 'dango.ico'), ico);
writeFileSync(join(root, 'assets', 'dango.icns'), icns);
console.log('Wrote assets/icon-256.png, assets/dango.ico, assets/dango.icns');
