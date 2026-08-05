#!/usr/bin/env node
/**
 * Cursor beforeSubmitPrompt / stop hook.
 * Captures a credential-redacted Git working-tree state for one execution turn.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const workbenchHome = process.env.AGENT_WORKBENCH_HOME
  ? path.resolve(process.env.AGENT_WORKBENCH_HOME)
  : repoRoot;
const MAX_PATCH_CHARS = 250_000;

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
  // Fail open without blocking Cursor.
}

function main() {
  const phase = process.argv[2] === 'end' ? 'end' : 'start';
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw) return writeEmpty();

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return writeEmpty();
  }

  try {
    const projectRoot = firstWorkspaceRoot(payload.workspace_roots) || path.resolve(process.cwd());
    const generationId =
      stringOrNull(payload.generation_id) ||
      stringOrNull(payload.generationId) ||
      stringOrNull(payload.conversation_id) ||
      'ungrouped';
    const conversationId =
      stringOrNull(payload.conversation_id) ||
      stringOrNull(payload.conversationId);
    const snapshot = captureGitState(projectRoot);
    if (!snapshot) return writeEmpty();

    const outDir = path.join(projectRoot, '.agent-workbench');
    const outPath = path.join(outDir, 'code-changes.jsonl');
    fs.mkdirSync(outDir, { recursive: true });

    const state = {
      kind: 'code_state',
      id: `code-state:${generationId}:${phase}`,
      phase,
      provider: 'cursor',
      conversationId,
      generationId,
      capturedAt: new Date().toISOString(),
      hash: snapshot.hash,
      patch: snapshot.patch,
      status: snapshot.status,
    };
    appendRow(outPath, state);

    if (phase === 'end') {
      const before = findLatestStart(outPath, generationId);
      appendRow(outPath, {
        kind: 'code_change',
        id: `code-change:${generationId}`,
        source: 'git-snapshot',
        attribution: 'unassigned',
        projectRoot,
        observationWindow: {
          provider: 'cursor',
          conversationId,
          generationId,
        },
        startedAt: before?.capturedAt ?? null,
        endedAt: state.capturedAt,
        beforeHash: before?.hash ?? null,
        afterHash: state.hash,
        changed: before ? before.hash !== state.hash : null,
        beforePatch: before?.patch ?? null,
        afterPatch: state.patch,
        status: stringOrNull(payload.status) || 'completed',
      });
    }
  } catch (error) {
    reportHookError(payload.workspace_roots, error);
  }

  writeEmpty();
}

function captureGitState(projectRoot) {
  const pathspec = ['--', '.', ':(exclude).agent-workbench/**'];
  const status = runGit(
    projectRoot,
    ['status', '--porcelain=v1', '--untracked-files=all', ...pathspec],
  );
  const patch = runGit(
    projectRoot,
    ['diff', '--no-ext-diff', '--no-color', '--binary', 'HEAD', ...pathspec],
  );
  const rawState = `${status}\n\0\n${patch}`;
  const safeStatus = redactCredentialText(status, { context: 'strict' });
  const safePatch = redactCredentialText(patch, { context: 'strict' });
  return {
    hash: createHash('sha256').update(rawState).digest('hex'),
    status: truncate(safeStatus),
    patch: truncate(safePatch),
  };
}

function runGit(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed with exit code ${result.status ?? 'unknown'}`);
  }
  return result.stdout;
}

function findLatestStart(outPath, generationId) {
  if (!fs.existsSync(outPath)) return null;
  const lines = fs.readFileSync(outPath, 'utf8').trim().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const row = JSON.parse(lines[index]);
      if (
        row.kind === 'code_state' &&
        row.phase === 'start' &&
        row.generationId === generationId
      ) {
        return row;
      }
    } catch {
      // Ignore interrupted rows.
    }
  }
  return null;
}

function appendRow(outPath, row) {
  fs.appendFileSync(
    outPath,
    `${JSON.stringify(redactCredentials(row))}\n`,
    'utf8',
  );
}

function truncate(value) {
  if (value.length <= MAX_PATCH_CHARS) return value;
  return `${value.slice(0, MAX_PATCH_CHARS)}\n[TRUNCATED]`;
}

function firstWorkspaceRoot(roots) {
  if (!Array.isArray(roots) || typeof roots[0] !== 'string') return null;
  let normalized = roots[0].trim();
  if (process.platform === 'win32' && /^\/[A-Za-z]:[\\/]/.test(normalized)) {
    normalized = normalized.slice(1);
  }
  return path.resolve(normalized);
}

function reportHookError(workspaceRoots, error) {
  const message = redactCredentialText(
    error instanceof Error ? error.stack || error.message : String(error),
    { context: 'strict' },
  );
  process.stderr.write(`Agent Workbench code-state hook error: ${message}\n`);
  try {
    const root = firstWorkspaceRoot(workspaceRoots);
    if (!root) return;
    const logPath = path.join(root, '.agent-workbench', 'hook-errors.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // stderr above remains visible when the project log cannot be written.
  }
}

function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function writeEmpty() {
  process.stdout.write('{}\n');
}

if (sharedModuleReady) {
  main();
} else {
  writeEmpty();
}
