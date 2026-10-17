#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const iconsDir = path.resolve(__dirname, '..', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crc32Table[i] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crc32Table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type);
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crcValue = Buffer.alloc(4);
  crcValue.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuffer, data, crcValue]);
}

function createGradientIcon(size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(6, 9);
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);

  const color1 = [99, 102, 241];
  const color2 = [139, 92, 246];

  const rawData = [];
  const cornerRadius = Math.floor(size * 0.1875);

  for (let y = 0; y < size; y++) {
    rawData.push(0);
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      const r = Math.round(color1[0] + (color2[0] - color1[0]) * t);
      const g = Math.round(color1[1] + (color2[1] - color1[1]) * t);
      const b = Math.round(color1[2] + (color2[2] - color1[2]) * t);

      let alpha = 255;

      const corners = [
        { cx: cornerRadius, cy: cornerRadius },
        { cx: size - cornerRadius - 1, cy: cornerRadius },
        { cx: cornerRadius, cy: size - cornerRadius - 1 },
        { cx: size - cornerRadius - 1, cy: size - cornerRadius - 1 },
      ];

      for (const corner of corners) {
        const inCornerRegion =
          (x < cornerRadius && y < cornerRadius && corner.cx === cornerRadius && corner.cy === cornerRadius) ||
          (x >= size - cornerRadius && y < cornerRadius && corner.cx === size - cornerRadius - 1 && corner.cy === cornerRadius) ||
          (x < cornerRadius && y >= size - cornerRadius && corner.cx === cornerRadius && corner.cy === size - cornerRadius - 1) ||
          (x >= size - cornerRadius && y >= size - cornerRadius && corner.cx === size - cornerRadius - 1 && corner.cy === size - cornerRadius - 1);

        if (inCornerRegion) {
          const dx = x - corner.cx;
          const dy = y - corner.cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > cornerRadius) {
            alpha = 0;
          }
        }
      }

      rawData.push(r, g, b, alpha);
    }
  }

  const rawBuffer = Buffer.from(rawData);
  const compressedData = zlib.deflateSync(rawBuffer);

  const ihdrChunk = createChunk('IHDR', ihdrData);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const sizes = [16, 32, 48, 128];
for (const size of sizes) {
  const png = createGradientIcon(size);
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Created ${filePath}`);
}

console.log('Done creating icons');
