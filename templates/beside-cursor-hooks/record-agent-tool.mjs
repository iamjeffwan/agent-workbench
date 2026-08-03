#!/usr/bin/env node
/**
 * Cursor postToolUse / postToolUseFailure hook.
 * Appends enriched agent tool steps for the workbench verify viewer.
 *
 * Stable tool id = payload.tool_use_id (Cursor-provided).
 * This is the process-origin candidate for Shell-launched programs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const workbenchHome = process.env.AGENT_WORKBENCH_HOME
  ? path.resolve(process.env.AGENT_WORKBENCH_HOME)
  : path.resolve(repoRoot, '../agent-workbench');

let redactCredentials = () => ({ $summary: 'redaction-unavailable' });
let redactCredentialText = () => '[REDACTED]';
let sharedModuleReady = false;
try {
  ({ redactCredentials, redactCredentialText } = await import(
    pathToFileURL(
      path.join(workbenchHome, 'packages/agent-workbench-security/index.mjs'),
    ).href,
  ));
  sharedModuleReady = true;
} catch {
  // Fail open below without printing the potentially sensitive module path.
}

const MAX_ARG_CHARS = 2_000;
const MAX_OUTPUT_CHARS = 4_000;

function main() {
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw) {
    writeEmpty();
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    writeEmpty();
    return;
  }

  try {
    const step = toAgentStep(payload);
    if (step) {
      appendStep(step, payload.workspace_roots);
    }
  } catch (error) {
    // Fail open: never block the agent because of recorder problems.
    try {
      const root = firstWorkspaceRoot(payload.workspace_roots);
      if (root) {
        const logPath = path.join(root, '.agent-workbench', 'hook-errors.log');
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(
          logPath,
          `${new Date().toISOString()} ${redactCredentialText(error instanceof Error ? error.stack || error.message : String(error))}\n`,
          'utf8',
        );
      }
    } catch {
      // ignore
    }
  }

  writeEmpty();
}

function writeEmpty() {
  process.stdout.write('{}\n');
}

function toAgentStep(payload) {
  const toolName =
    stringOrNull(payload.tool_name) ||
    stringOrNull(payload.toolName) ||
    'unknown';
  const eventName = stringOrNull(payload.hook_event_name) || 'postToolUse';
  const args = payload.tool_input ?? null;
  const safeArgs = redactCredentials(args);
  const toolUseId =
    stringOrNull(payload.tool_use_id) ||
    stringOrNull(payload.toolUseId) ||
    synthesizeId(payload, toolName, safeArgs);

  const failed = eventName === 'postToolUseFailure';
  const output = failed
    ? {
        error_message: payload.error_message ?? null,
        failure_type: payload.failure_type ?? null,
      }
    : parsePossiblyJson(payload.tool_output);

  const now = new Date().toISOString();
  const durationMs =
    typeof payload.duration === 'number' ? payload.duration : null;

  return {
    kind: 'agent_tool',
    id: toolUseId,
    name: toolName,
    arguments: summarizeValue(safeArgs, MAX_ARG_CHARS),
    output: summarizeValue(redactCredentials(output), MAX_OUTPUT_CHARS),
    startedAt: now,
    endedAt: now,
    status: failed ? 'pending' : 'completed',
    sessionFile: stringOrNull(payload.transcript_path) || '',
    provider: 'cursor',
    source: 'cursor-hook',
    conversationId: stringOrNull(payload.conversation_id),
    generationId: stringOrNull(payload.generation_id),
    durationMs,
    launchesProcess: canLaunchProcess(toolName, args),
    failed,
  };
}

function canLaunchProcess(toolName, args) {
  if (toolName === 'Shell' || toolName === 'Task') {
    return true;
  }
  if (toolName === 'AwaitShell' || toolName === 'await') {
    return true;
  }
  const command =
    args && typeof args === 'object' && typeof args.command === 'string'
      ? args.command
      : '';
  return /\bnode\b|\bnpm\b|\bpnpm\b|\byarn\b|\bbun\b/i.test(command);
}

function appendStep(step, workspaceRoots) {
  const root = firstWorkspaceRoot(workspaceRoots) || process.cwd();
  const outDir = path.join(root, '.agent-workbench');
  const outPath = path.join(outDir, 'agent-steps.jsonl');
  fs.mkdirSync(outDir, { recursive: true });
  fs.appendFileSync(
    outPath,
    `${JSON.stringify(redactCredentials(step))}\n`,
    'utf8',
  );
}

function firstWorkspaceRoot(roots) {
  if (!Array.isArray(roots) || roots.length === 0) {
    return null;
  }
  return typeof roots[0] === 'string' ? roots[0] : null;
}

function synthesizeId(payload, toolName, safeArgs) {
  const basis = [
    payload.conversation_id || '',
    payload.generation_id || '',
    toolName,
    stableStringify(safeArgs),
    String(payload.duration ?? ''),
  ].join('|');
  const hash = createHash('sha1').update(basis).digest('hex').slice(0, 12);
  const conv = String(payload.conversation_id || 'local').slice(0, 8);
  return `cursor_hook_${conv}_${hash}`;
}

function summarizeValue(value, maxChars) {
  if (value === null || value === undefined) {
    return value;
  }
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text.length <= maxChars) {
    if (typeof value === 'string') {
      return tryParseJson(text) ?? text;
    }
    return value;
  }
  return {
    $summary: 'truncated',
    $length: text.length,
    $preview: text.slice(0, Math.min(400, maxChars)),
  };
}

function parsePossiblyJson(value) {
  if (typeof value !== 'string') {
    return value ?? null;
  }
  return tryParseJson(value) ?? value;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stableStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

if (sharedModuleReady) {
  main();
} else {
  writeEmpty();
}
