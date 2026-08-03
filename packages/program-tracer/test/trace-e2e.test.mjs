import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, '..');
const repoRoot = path.resolve(packageRoot, '../..');
const observeRun = path.join(packageRoot, 'scripts', 'observe-run.mjs');
const injectShellTrace = path.join(repoRoot, '.cursor', 'hooks', 'inject-shell-trace.mjs');
const shellRun = path.join(repoRoot, '.cursor', 'hooks', 'run-with-trace.mjs');
const fixtureRoot = path.join(testDir, 'fixtures', 'traced-app');
const manifest = path.join(fixtureRoot, 'trace-manifest.json');
const mainScript = path.join(fixtureRoot, 'main.cjs');

test('observed sync and async calls preserve results, nesting, and safe snapshots', () => {
  const { result, records } = runFixture('success');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESULT:{"ok":true,"content":"A token budget is ordinary product text\."}/);
  assert.equal(records.length, 3);

  const echo = records.find((record) => record.methodId === 1);
  const outer = records.find((record) => record.methodId === 2);
  const inner = records.find((record) => record.methodId === 3);
  assert.equal(echo.parentCallId, null);
  assert.equal(outer.parentCallId, null);
  assert.equal(inner.parentCallId, outer.callId);
  assert.equal(inner.processOriginId, 'trace-e2e-success');

  const stored = JSON.stringify(records);
  assert.doesNotMatch(stored, /sk-test-1234567890abcdef|access-secret|ghp_1234567890abcdefghijklmnopqrstuvwxyz/);
  assert.match(stored, /\[REDACTED\]/);
  assert.match(stored, /A token budget is ordinary product text\./);
});

test('observed async errors keep the exit result and hide credentials in errors', () => {
  const { result, records } = runFixture('error');

  assert.equal(result.status, 2, result.stderr);
  const inner = records.find((record) => record.methodId === 3);
  const outer = records.find((record) => record.methodId === 2);
  assert.deepEqual(inner.error, {
    name: 'Error',
    message: 'Authorization: [REDACTED]',
  });
  assert.deepEqual(outer.error, {
    name: 'Error',
    message: 'Authorization: [REDACTED]',
  });
});

test('credential-like process origins are hidden before records are written', () => {
  const secret = 'sk-test-1234567890abcdef';
  const { result, records } = runFixture(
    'success',
    `trace-DEEPSEEK_API_KEY=${secret}`,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(records), new RegExp(secret));
  assert.equal(
    records.every((record) => record.processOriginId.includes('[REDACTED]')),
    true,
  );
});

test('Cursor tool origin follows the injected payload into real program calls', () => {
  const command = `node ${quoteForShell(mainScript)} success`;
  const injection = spawnSync(process.execPath, [injectShellTrace], {
    cwd: repoRoot,
    input: JSON.stringify({
      tool_name: 'Shell',
      tool_use_id: 'tool_trace_e2e',
      workspace_roots: [repoRoot],
      cwd: repoRoot,
      tool_input: { command },
    }),
    encoding: 'utf8',
  });
  assert.equal(injection.status, 0, injection.stderr);

  const wrapped = JSON.parse(injection.stdout).updated_input.command;
  const encoded = wrapped.match(/--payload-b64\s+([A-Za-z0-9+/=]+)/)?.[1];
  assert.ok(encoded, wrapped);
  const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workbench-tool-origin-'));
  payload.manifest = manifest;
  payload.outPath = path.join(tempDir, 'trace-records.jsonl');

  const result = spawnSync(
    process.execPath,
    [
      shellRun,
      '--payload-b64',
      Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);

  const records = fs
    .readFileSync(payload.outPath, 'utf8')
    .trim()
    .split(/\n+/)
    .map((line) => JSON.parse(line));
  assert.equal(records.length, 3);
  assert.equal(
    records.every((record) => record.processOriginId === 'tool_trace_e2e'),
    true,
  );
  const outer = records.find((record) => record.methodId === 2);
  const inner = records.find((record) => record.methodId === 3);
  assert.equal(inner.parentCallId, outer.callId);
});

test('guest preload fails open and redacts initialization errors', () => {
  const secret = 'sk-test-1234567890abcdef';
  const preloadUrl = pathToFileURL(
    path.join(packageRoot, 'dist', 'guest', 'preload.js'),
  ).href;
  const result = spawnSync(
    process.execPath,
    ['-e', "console.log('app-ran')"],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${preloadUrl}`,
        AGENT_WORKBENCH_TRACE_MANIFEST: path.join(
          os.tmpdir(),
          `missing-DEEPSEEK_API_KEY=${secret}.json`,
        ),
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /app-ran/);
  assert.match(result.stderr, /guest unavailable/i);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});

function runFixture(mode, origin = `trace-e2e-${mode}`) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-workbench-trace-${mode}-`));
  const outPath = path.join(tempDir, 'trace-records.jsonl');
  const result = spawnSync(
    process.execPath,
    [
      observeRun,
      '--origin',
      origin,
      '--manifest',
      manifest,
      '--out',
      outPath,
      '--',
      process.execPath,
      mainScript,
      mode,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const records = fs.existsSync(outPath)
    ? fs
        .readFileSync(outPath, 'utf8')
        .trim()
        .split(/\n+/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  return { result, records };
}

function quoteForShell(value) {
  if (process.platform === 'win32') {
    return `"${String(value).replaceAll('"', '""')}"`;
  }
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
