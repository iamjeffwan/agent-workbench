#!/usr/bin/env node
/**
 * Run a shell command string with process-origin id + program-tracer preload.
 *
 * Usage:
 *   node run-with-trace.mjs --origin <id> --manifest <path> --out <path> --command-b64 <base64>
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
// pathToFileURL used for workbench-home dynamic imports

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const workbenchHome = process.env.AGENT_WORKBENCH_HOME
  ? path.resolve(process.env.AGENT_WORKBENCH_HOME)
  : path.resolve(repoRoot, '../agent-workbench');

let redactCredentialText = () => '[REDACTED]';
let mirrorChildExit = fallbackMirrorChildExit;
let spawnShellCommand = fallbackSpawnShellCommand;
let sharedModulesReady = false;
try {
  ({ redactCredentialText } = await import(
    pathToFileURL(
      path.join(workbenchHome, 'packages/agent-workbench-security/index.mjs'),
    ).href,
  ));
  ({ mirrorChildExit, spawnShellCommand } = await import(
    pathToFileURL(
      path.join(
        workbenchHome,
        'packages/program-tracer/scripts/process-launch.mjs',
      ),
    ).href,
  ));
  sharedModulesReady = true;
} catch {
  // The original command still runs below, without tracing or raw import errors.
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let origin;
  let manifest;
  let outPath;
  let commandB64;
  let payloadB64;
  let cwd;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--origin') {
      origin = args[++i];
      continue;
    }
    if (arg === '--manifest') {
      manifest = args[++i];
      continue;
    }
    if (arg === '--out') {
      outPath = args[++i];
      continue;
    }
    if (arg === '--command-b64') {
      commandB64 = args[++i];
      continue;
    }
    if (arg === '--payload-b64') {
      payloadB64 = args[++i];
      continue;
    }
    if (arg === '--cwd') {
      cwd = args[++i];
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (payloadB64) {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    } catch {
      throw new Error('Invalid --payload-b64');
    }
    origin = stringField(payload, 'origin');
    manifest = stringField(payload, 'manifest', false);
    outPath = stringField(payload, 'outPath', false);
    cwd = stringField(payload, 'cwd', false);
    const command = stringField(payload, 'command');
    return resolveLaunchOptions({ origin, manifest, outPath, cwd, command });
  }

  if (!origin) throw new Error('Missing --origin');
  if (!commandB64) throw new Error('Missing --command-b64');
  const command = Buffer.from(commandB64, 'base64').toString('utf8');
  return resolveLaunchOptions({ origin, manifest, outPath, cwd, command });
}

function main() {
  const { origin, manifest, outPath, command, cwd } = parseArgs(process.argv);
  const preload = path.join(
    workbenchHome,
    'packages/program-tracer/dist/guest/preload.js',
  );

  if (!sharedModulesReady) {
    console.error('[run-with-trace] tracing unavailable; running original command');
  }

  if (!fs.existsSync(preload)) {
    console.error(
      redactCredentialText(`[run-with-trace] preload missing: ${preload}`),
    );
    console.error('[run-with-trace] run: pnpm --filter @agent-workbench/program-tracer build');
  }

  const env = { ...process.env };
  env.AGENT_WORKBENCH_PROCESS_ORIGIN_ID = origin;
  if (manifest) {
    env.AGENT_WORKBENCH_TRACE_MANIFEST = manifest;
  }
  if (outPath) {
    env.AGENT_WORKBENCH_TRACE_OUT = outPath;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
  }

  if (fs.existsSync(preload)) {
    const preloadImport = pathToFileURL(preload).href;
    const flag = `--import=${preloadImport}`;
    const current = env.NODE_OPTIONS ?? '';
    if (!current.includes(preloadImport) && !current.includes(preload)) {
      env.NODE_OPTIONS = current.trim() ? `${current.trim()} ${flag}` : flag;
    }
  }

  console.error(redactCredentialText(`[run-with-trace] origin=${origin}`));
  console.error(redactCredentialText(`[run-with-trace] cwd=${cwd}`));
  console.error(`[run-with-trace] cmd=${redactCredentialText(command)}`);

  const child = spawnShellCommand(command, {
    env,
    cwd,
    stdio: 'inherit',
  });
  mirrorChildExit(child, 'run-with-trace');
}

function resolveLaunchOptions({ origin, manifest, outPath, cwd, command }) {
  return {
    origin,
    manifest: manifest ? path.resolve(manifest) : null,
    outPath: outPath ? path.resolve(outPath) : null,
    command,
    cwd: cwd ? path.resolve(cwd) : process.cwd(),
  };
}

function stringField(value, key, required = true) {
  const field = value && typeof value[key] === 'string' ? value[key] : '';
  if (required && !field) {
    throw new Error(`Missing payload field: ${key}`);
  }
  return field || null;
}

function fallbackSpawnShellCommand(command, options) {
  if (process.platform === 'win32') {
    const shell = options.env?.ComSpec || process.env.ComSpec || 'cmd.exe';
    return spawn(shell, ['/d', '/s', '/c', `"${command}"`], {
      ...options,
      shell: false,
      windowsVerbatimArguments: true,
    });
  }
  return spawn('/bin/sh', ['-c', command], { ...options, shell: false });
}

function fallbackMirrorChildExit(child, label) {
  let failedToStart = false;
  child.once('error', () => {
    failedToStart = true;
    console.error(`[${label}] failed to start`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (failedToStart) return;
    if (signal) {
      try {
        process.kill(process.pid, signal);
      } catch {
        process.exitCode = 1;
      }
      return;
    }
    process.exitCode = code ?? 1;
  });
}

try {
  main();
} catch (error) {
  console.error(
    redactCredentialText(error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
}
