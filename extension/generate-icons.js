/**
 * 生成简单的纯色 PNG 图标
 * 运行: node generate-icons.js
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function createPNG(size, color) {
  // color: { r, g, b } 0-255
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);  // width
  ihdrData.writeUInt32BE(size, 4);  // height
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 2;   // color type (RGB)
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT: raw pixel data + zlib compress
  const rawData = Buffer.alloc(size * (1 + 3 * size)); // filter byte + RGB per row
  for (let y = 0; y < size; y++) {
    const rowOffset = y * (1 + 3 * size);
    rawData[rowOffset] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const pxOffset = rowOffset + 1 + x * 3;
      // 圆角效果：边缘像素稍微透明（通过混色模拟）
      const cx = x - size / 2 + 0.5;
      const cy = y - size / 2 + 0.5;
      const dist = Math.sqrt(cx * cx + cy * cy) / (size / 2);
      const alpha = dist > 1 ? 0 : (dist > 0.85 ? (1 - dist) / 0.15 : 1);

      rawData[pxOffset] = Math.round(color.r * alpha + 255 * (1 - alpha));
      rawData[pxOffset + 1] = Math.round(color.g * alpha + 255 * (1 - alpha));
      rawData[pxOffset + 2] = Math.round(color.b * alpha + 255 * (1 - alpha));
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);

  // IEND
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  // CRC32
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 查表法
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

// 生成图标
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

const accentColor = { r: 67, g: 97, b: 238 }; // #4361ee

const sizes = [
  { size: 16, name: 'icon-16.png' },
  { size: 48, name: 'icon-48.png' },
  { size: 128, name: 'icon-128.png' },
];

sizes.forEach(({ size, name }) => {
  const png = createPNG(size, accentColor);
  fs.writeFileSync(path.join(iconsDir, name), png);
  console.log(`Created ${name} (${size}x${size})`);
});

console.log('Icons generated!');
