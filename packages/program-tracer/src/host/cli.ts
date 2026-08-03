#!/usr/bin/env node
import path from 'node:path';

import { redactCredentialText } from '../../../agent-workbench-security/index.mjs';
import { analyzeBoundaries } from './analyze-boundaries.js';
import { writeTraceManifest } from './manifest-io.js';

function printUsage(): void {
  console.error(`Usage:
  node dist/host/cli.js <projectRoot> [--out <manifest.json>]

Scans head.ts / body.ts pairs and writes a trace manifest.
`);
}

function main(argv: string[]): void {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  let projectRoot: string | undefined;
  let outPath: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--out' || arg === '-o') {
      outPath = args[i + 1];
      i += 1;
      continue;
    }
    if (!projectRoot) {
      projectRoot = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!projectRoot) {
    printUsage();
    process.exit(1);
  }

  const manifest = analyzeBoundaries({ projectRoot });
  const resolvedOut =
    outPath ??
    path.join(path.resolve(projectRoot), '.agent-workbench', 'trace-manifest.json');

  writeTraceManifest(resolvedOut, manifest);

  console.log(
    JSON.stringify(
      {
        out: path.resolve(resolvedOut),
        methodCount: manifest.methods.length,
        methods: manifest.methods,
      },
      null,
      2,
    ),
  );
}

try {
  main(process.argv);
} catch (error) {
  console.error(
    redactCredentialText(error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
}
