#!/usr/bin/env node
/**
 * Launch a command with process-origin id + program-tracer preload.
 *
 * Usage:
 *   node scripts/observe-run.mjs --origin call_xxx --manifest <manifest.json> -- <command> [args...]
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { redactCredentialText } from '../../agent-workbench-security/index.mjs';
import { mirrorChildExit, spawnDirect } from './process-launch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '../..');

function printHelp() {
  console.error(`Usage:
  node scripts/observe-run.mjs --origin <id> [--manifest path] [--out path] -- <command> [args...]
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let origin;
  let manifest = path.join(
    packageRoot,
    'fixtures/sample-app/trace-manifest.json',
  );
  let outPath = path.join(
    repoRoot,
    '.agent-workbench/trace-records.jsonl',
  );
  let command = [];
  let sawSeparator = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (sawSeparator) {
      command.push(arg);
      continue;
    }
    if (arg === '--') {
      sawSeparator = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--origin') {
      origin = args[++i];
      continue;
    }
    if (arg === '--manifest' || arg === '-m') {
      manifest = args[++i];
      continue;
    }
    if (arg === '--out') {
      outPath = args[++i];
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!origin) {
    throw new Error('Missing --origin <processOriginId>');
  }
  if (!command.length) {
    throw new Error('Missing command after --');
  }

  return {
    origin,
    manifest: path.resolve(manifest),
    outPath: path.resolve(outPath),
    command,
  };
}

function main() {
  const { origin, manifest, outPath, command } = parseArgs(process.argv);
  const preload = path.join(packageRoot, 'dist/guest/preload.js');
  const preloadImport = pathToFileURL(preload).href;
  const env = { ...process.env };
  env.AGENT_WORKBENCH_PROCESS_ORIGIN_ID = origin;
  env.AGENT_WORKBENCH_TRACE_MANIFEST = manifest;
  env.AGENT_WORKBENCH_TRACE_OUT = outPath;

  const flag = `--import=${preloadImport}`;
  const current = env.NODE_OPTIONS ?? '';
  if (!current.includes(preloadImport) && !current.includes(preload)) {
    env.NODE_OPTIONS = current.trim() ? `${current.trim()} ${flag}` : flag;
  }

  console.error(redactCredentialText(`[observe-run] origin=${origin}`));
  console.error(redactCredentialText(`[observe-run] manifest=${manifest}`));
  console.error(redactCredentialText(`[observe-run] out=${outPath}`));
  console.error(`[observe-run] cmd=${redactCredentialText(command.join(' '))}`);

  const child = spawnDirect(command[0], command.slice(1), {
    env,
    stdio: 'inherit',
  });
  mirrorChildExit(child, 'observe-run');
}

try {
  main();
} catch (error) {
  console.error(
    redactCredentialText(error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
}
