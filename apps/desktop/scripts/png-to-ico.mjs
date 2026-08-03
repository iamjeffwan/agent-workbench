#!/usr/bin/env node
/**
 * Wrap a PNG as a Windows .ico (PNG-compressed ICO, Vista+).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pngPath =
  process.argv[2] || path.join(__dirname, '../assets/icon.png');
const icoPath =
  process.argv[3] || path.join(__dirname, '../assets/icon.ico');

const png = fs.readFileSync(pngPath);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // icon type
header.writeUInt16LE(1, 4); // image count

const entry = Buffer.alloc(16);
entry[0] = 0; // width 0 => 256
entry[1] = 0; // height 0 => 256
entry[2] = 0; // colors
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bit count
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(6 + 16, 12); // offset to image data

fs.writeFileSync(icoPath, Buffer.concat([header, entry, png]));
console.log(`Wrote ${icoPath}`);
