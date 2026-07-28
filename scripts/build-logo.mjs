/*
 * Turns the logo artwork into the two assets the app ships.
 *
 *   node scripts/build-logo.mjs assets/logo-source.png web/public
 *
 * The source is a 1254px square on a near-black background with the wordmark
 * underneath. Neither suits a 28px slot in a sidebar that also has a light
 * theme, so this crops to the emblem and derives alpha from luminance — the
 * artwork glows against an almost black ground, which makes that a clean cut.
 *
 * Plain Node on purpose: no image library has to be installed to rebuild it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function decodePNG(file) {
  const d = readFileSync(file);
  let pos = 8,
    ihdr = null;
  const idat = [];
  while (pos < d.length) {
    const len = d.readUInt32BE(pos);
    const type = d.toString('ascii', pos + 4, pos + 8);
    const body = d.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR')
      ihdr = {
        w: body.readUInt32BE(0),
        h: body.readUInt32BE(4),
        depth: body[8],
        color: body[9],
        interlace: body[12],
      };
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (ihdr.depth !== 8 || ihdr.interlace !== 0) throw new Error('nur 8bit, nicht interlaced');
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.color];
  if (!ch) throw new Error('Farbtyp ' + ihdr.color + ' nicht unterstützt');

  const raw = inflateSync(Buffer.concat(idat));
  const { w, h } = ihdr;
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);

  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const s = x * ch,
        o = (y * w + x) * 4;
      if (ch >= 3) {
        out[o] = line[s];
        out[o + 1] = line[s + 1];
        out[o + 2] = line[s + 2];
        out[o + 3] = ch === 4 ? line[s + 3] : 255;
      } else {
        out[o] = out[o + 1] = out[o + 2] = line[s];
        out[o + 3] = ch === 2 ? line[s + 1] : 255;
      }
    }
    line.copy(prev);
  }
  return { w, h, px: out };
}

function encodePNG(w, h, px) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, body) => {
    const b = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    b.copy(out, 4);
    out.writeUInt32BE(CRC(b), body.length + 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Zuschneiden + Alpha aus Helligkeit: das Motiv leuchtet, der Grund ist fast schwarz. */
function cutout(src, sx, sy, sw, sh, size) {
  const dst = Buffer.alloc(size * size * 4);
  const scale = sw / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Box-Downsampling über den Quellbereich, sonst franst es bei 28px aus.
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      const x0 = Math.floor(sx + x * scale),
        x1 = Math.max(x0 + 1, Math.floor(sx + (x + 1) * scale));
      const y0 = Math.floor(sy + y * (sh / size)),
        y1 = Math.max(y0 + 1, Math.floor(sy + (y + 1) * (sh / size)));
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * src.w + xx) * 4;
          r += src.px[o];
          g += src.px[o + 1];
          b += src.px[o + 2];
          n++;
        }
      r /= n;
      g /= n;
      b /= n;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // Weicher Übergang knapp über dem Hintergrundwert, damit Kanten sauber bleiben.
      const a = Math.max(0, Math.min(255, ((luma - 6) / 26) * 255));
      const o = (y * size + x) * 4;
      dst[o] = Math.round(r);
      dst[o + 1] = Math.round(g);
      dst[o + 2] = Math.round(b);
      dst[o + 3] = Math.round(a);
    }
  }
  return dst;
}

const [, , input, outDir] = process.argv;
const img = decodePNG(input);
console.log(`Quelle: ${img.w}x${img.h}`);

// Emblem: der Kreis mit dem Kopf, ohne den Schriftzug darunter.
const E = { x: 318, y: 202, w: 610, h: 610 };
for (const size of [256, 64]) {
  const px = cutout(img, E.x, E.y, E.w, E.h, size);
  const buf = encodePNG(size, size, px);
  const name = size === 256 ? 'logo.png' : 'favicon.png';
  writeFileSync(`${outDir}/${name}`, buf);
  console.log(`${name}: ${size}x${size}, ${(buf.length / 1024).toFixed(1)} KB`);
}
