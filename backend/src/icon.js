// Draws the app icon (a drop on a coloured rounded background) as a PNG, so every business
// gets a phone-app icon in its own brand colour. No image libraries needed.
const zlib = require('zlib');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = ~0;
  for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return ~c >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, sum]);
};

const cache = new Map();

function icon(size, hex) {
  const key = size + hex;
  if (cache.has(key)) return cache.get(key);
  const dark = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const light = dark.map((v) => Math.round(v + (255 - v) * 0.32));
  const inDrop = (u, v) => {
    const round = u * u + (v - 0.07) * (v - 0.07) <= 0.2 * 0.2;
    const tip = v >= -0.28 && v <= 0.02 && Math.abs(u) <= ((v + 0.28) / 0.3) * 0.19;
    return round || tip;
  };
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) cover += inDrop((x + (sx + 0.5) / 2) / size - 0.5, (y + (sy + 0.5) / 2) / size - 0.5) ? 1 : 0;
      }
      cover /= 4;
      const g = (x + y) / (2 * size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round((light[i] + (dark[i] - light[i]) * g) * (1 - cover) + 253 * cover);
      raw[o + 3] = 255;
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8;
  head[9] = 6;
  const out = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}

module.exports = { icon };
