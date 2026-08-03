#!/usr/bin/env node
/**
 * Cursor preToolUse hook (matcher: Shell).
 * Rewrites Node-launching shell commands so they run through run-with-trace.mjs
 * with process origin id = tool_use_id.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const workbenchHome = process.env.AGENT_WORKBENCH_HOME
  ? path.resolve(process.env.AGENT_WORKBENCH_HOME)
  : repoRoot;

let redactCredentialText = () => '[REDACTED]';
let sharedModuleReady = false;
try {
  ({ redactCredentialText } = await import(
    pathToFileURL(
      path.join(workbenchHome, 'packages/agent-workbench-security/index.mjs'),
    ).href,
  ));
  sharedModuleReady = true;
} catch {
  // Fail open below without printing the potentially sensitive module path.
}

const NODEISH =
  /(^|[\s&|;])(node|nodejs|npm|npx|pnpm|yarn|bun)([\s.]|$)/i;

function main() {
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw) {
    writeJson({});
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    writeJson({});
    return;
  }

  try {
    const result = maybeWrap(payload);
    writeJson(result);
  } catch (error) {
    logError(payload, error);
    writeJson({});
  }
}

function maybeWrap(payload) {
  const toolName = payload.tool_name || payload.toolName || '';
  if (toolName && toolName !== 'Shell') {
    return {};
  }

  const input =
    payload.tool_input && typeof payload.tool_input === 'object'
      ? { ...payload.tool_input }
      : {};
  const command = typeof input.command === 'string' ? input.command : '';
  if (!command.trim()) {
    return {};
  }

  // Already wrapped — don't double-wrap.
  if (command.includes('run-with-trace.mjs')) {
    return {};
  }

  if (!NODEISH.test(command)) {
    return {};
  }

  const root = firstWorkspaceRoot(payload.workspace_roots) || repoRoot;
  const preload = path.join(
    workbenchHome,
    'packages/program-tracer/dist/guest/preload.js',
  );
  if (!fs.existsSync(preload)) {
    return {};
  }

  const manifest = resolveManifest(root);
  if (!manifest) {
    return {};
  }

  const origin =
    (typeof payload.tool_use_id === 'string' && payload.tool_use_id) ||
    (typeof payload.toolUseId === 'string' && payload.toolUseId) ||
    `cursor_shell_${Date.now()}`;

  const outPath = path.join(root, '.agent-workbench', 'trace-records.jsonl');
  const runner = path.join(__dirname, 'run-with-trace.mjs');
  const cwd =
    typeof input.working_directory === 'string' && input.working_directory
      ? input.working_directory
      : typeof payload.cwd === 'string'
        ? payload.cwd
        : root;

  const launchPayload = Buffer.from(
    JSON.stringify({ origin, manifest, outPath, cwd, command }),
    'utf8',
  ).toString('base64');
  const wrapped = [
    'node',
    quote(runner),
    '--payload-b64',
    launchPayload,
  ].join(' ');

  return {
    updated_input: {
      ...input,
      command: wrapped,
    },
  };
}

function resolveManifest(root) {
  const candidates = [
    path.join(root, '.agent-workbench', 'trace-manifest.json'),
    path.join(root, 'apps/worker/.agent-workbench', 'trace-manifest.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function firstWorkspaceRoot(roots) {
  if (!Array.isArray(roots) || roots.length === 0) {
    return null;
  }
  return typeof roots[0] === 'string' ? roots[0] : null;
}

function quote(value) {
  return `"${String(value).replaceAll('\\', '/').replaceAll('"', '\\"')}"`;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function logError(payload, error) {
  try {
    const root = firstWorkspaceRoot(payload?.workspace_roots) || repoRoot;
    const logPath = path.join(root, '.agent-workbench', 'hook-errors.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      `${new Date().toISOString()} inject-shell-trace ${redactCredentialText(error instanceof Error ? error.stack || error.message : String(error))}\n`,
      'utf8',
    );
  } catch {
    // ignore
  }
}

if (sharedModuleReady) {
  main();
} else {
  writeJson({});
}
