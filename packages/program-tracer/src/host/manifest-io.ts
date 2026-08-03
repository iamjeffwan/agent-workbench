import fs from 'node:fs';
import path from 'node:path';

import { isTraceManifest, type TraceManifest } from '../manifest.js';

export function writeTraceManifest(
  filePath: string,
  manifest: TraceManifest,
): void {
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function readTraceManifest(filePath: string): TraceManifest {
  const abs = path.resolve(filePath);
  const raw: unknown = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!isTraceManifest(raw)) {
    throw new Error(`Invalid trace manifest: ${abs}`);
  }
  return raw;
}
