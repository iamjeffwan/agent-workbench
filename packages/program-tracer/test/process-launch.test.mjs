import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, '..');
const repoRoot = path.resolve(packageRoot, '../..');
const observeRun = path.join(packageRoot, 'scripts', 'observe-run.mjs');
const shellRun = path.join(repoRoot, '.cursor', 'hooks', 'run-with-trace.mjs');
const templateShellRun = path.join(
  repoRoot,
  'templates',
  'beside-cursor-hooks',
  'run-with-trace.mjs',
);
const manifest = path.join(packageRoot, 'fixtures', 'sample-app', 'trace-manifest.json');

test('direct launch passes special characters as literal arguments', () => {
  const outPath = uniqueTempFile('direct-args');
  const script = path.join(testDir, 'fixtures', 'argv.cjs');
  const result = spawnSync(
    process.execPath,
    [
      observeRun,
      '--origin',
      'direct-args',
      '--manifest',
      manifest,
      '--out',
      outPath,
      '--',
      process.execPath,
      script,
      'literal&value',
      'value with spaces',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ARGV:\["literal&value","value with spaces"\]/);
  assert.doesNotMatch(result.stderr, /DEP0190/);
});

test('direct launch redacts credentials from its own diagnostics', () => {
  const secret = 'sk-test-1234567890abcdef';
  const outPath = uniqueTempFile('direct-log');
  const result = spawnSync(
    process.execPath,
    [
      observeRun,
      '--origin',
      `direct-log-DEEPSEEK_API_KEY=${secret}`,
      '--manifest',
      manifest,
      '--out',
      outPath,
      '--',
      process.execPath,
      '-e',
      '',
      `DEEPSEEK_API_KEY=${secret}`,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
  assert.match(result.stderr, /DEEPSEEK_API_KEY=\[REDACTED\]/);
});

test('direct launch reports startup failures without exposing credentials', () => {
  const secret = 'sk-test-1234567890abcdef';
  const missingCommand = `missing-DEEPSEEK_API_KEY=${secret}`;
  const result = spawnSync(
    process.execPath,
    [
      observeRun,
      '--origin',
      'direct-missing',
      '--manifest',
      manifest,
      '--out',
      uniqueTempFile('direct-missing'),
      '--',
      missingCommand,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /failed to start/i);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});

test('direct launch preserves a child signal termination outcome', () => {
  const result = spawnSync(
    process.execPath,
    [
      observeRun,
      '--origin',
      'direct-signal',
      '--manifest',
      manifest,
      '--out',
      uniqueTempFile('direct-signal'),
      '--',
      process.execPath,
      '-e',
      "process.kill(process.pid, 'SIGTERM')",
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status === 0, false);
  if (process.platform !== 'win32') {
    assert.equal(result.signal, 'SIGTERM');
  }
});

test('shell launch accepts one encoded payload and preserves shell composition', () => {
  const secret = 'sk-test-1234567890abcdef';
  const outPath = uniqueTempFile('shell-command');
  const command = [
    quoteForShell(process.execPath),
    '-e',
    quoteForShell("console.log('shell-first')"),
    quoteForShell(`DEEPSEEK_API_KEY=${secret}`),
    '&&',
    quoteForShell(process.execPath),
    '-e',
    quoteForShell("console.log('shell-second')"),
  ].join(' ');
  const payload = Buffer.from(
    JSON.stringify({
      origin: 'shell-command',
      manifest,
      outPath,
      cwd: repoRoot,
      command,
    }),
    'utf8',
  ).toString('base64');

  const result = spawnSync(
    process.execPath,
    [shellRun, '--payload-b64', payload],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /shell-first/);
  assert.match(result.stdout, /shell-second/);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
  assert.match(result.stderr, /DEEPSEEK_API_KEY=\[REDACTED\]/);
});

test('shell runner executes the original command when shared modules are unavailable', () => {
  const secret = 'sk-test-1234567890abcdef';
  const command = [
    quoteForShell(process.execPath),
    '-e',
    quoteForShell("console.log('fallback-ran')"),
  ].join(' ');
  const payload = Buffer.from(
    JSON.stringify({
      origin: 'fallback-shell',
      cwd: repoRoot,
      command,
    }),
    'utf8',
  ).toString('base64');

  const result = spawnSync(
    process.execPath,
    [shellRun, '--payload-b64', payload],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENT_WORKBENCH_HOME: path.join(
          os.tmpdir(),
          `missing-DEEPSEEK_API_KEY=${secret}`,
        ),
      },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fallback-ran/);
  assert.match(result.stderr, /tracing unavailable/i);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});

test('deployed shell runner template executes the original command when tracing is unavailable', () => {
  const secret = 'sk-test-1234567890abcdef';
  const command = [
    quoteForShell(process.execPath),
    '-e',
    quoteForShell("console.log('template-fallback-ran')"),
  ].join(' ');
  const payload = Buffer.from(
    JSON.stringify({ origin: 'template-fallback', cwd: repoRoot, command }),
    'utf8',
  ).toString('base64');
  const result = spawnSync(
    process.execPath,
    [templateShellRun, '--payload-b64', payload],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENT_WORKBENCH_HOME: path.join(
          os.tmpdir(),
          `missing-DEEPSEEK_API_KEY=${secret}`,
        ),
      },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /template-fallback-ran/);
  assert.match(result.stderr, /tracing unavailable/i);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});

test(
  'Windows command scripts are rejected by direct launch with guidance',
  { skip: process.platform !== 'win32' },
  () => {
    const script = path.join(testDir, 'fixtures', 'unsupported.cmd');
    const result = spawnSync(
      process.execPath,
      [
        observeRun,
        '--origin',
        'direct-cmd',
        '--manifest',
        manifest,
        '--out',
        uniqueTempFile('direct-cmd'),
        '--',
        script,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires explicit shell mode/i);
    assert.doesNotMatch(result.stdout, /should-not-run/);
  },
);

function uniqueTempFile(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-workbench-${label}-`));
  return path.join(dir, 'trace-records.jsonl');
}

function quoteForShell(value) {
  if (process.platform === 'win32') {
    return `"${String(value).replaceAll('"', '""')}"`;
  }
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
