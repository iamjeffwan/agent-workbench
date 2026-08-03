import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const templateHook = path.join(
  repoRoot,
  'templates/beside-cursor-hooks/inject-shell-trace.mjs',
);

test('Cursor shell injection passes dynamic values in one encoded payload', () => {
  const command = 'node app.js && node verify.js';
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, '.cursor/hooks/inject-shell-trace.mjs')],
    {
      cwd: repoRoot,
      input: JSON.stringify({
        tool_name: 'Shell',
        tool_use_id: 'tool_shell_payload',
        workspace_roots: [repoRoot],
        cwd: repoRoot,
        tool_input: { command },
      }),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  const wrapped = response.updated_input.command;
  assert.doesNotMatch(wrapped, /node app\.js && node verify\.js/);
  const encoded = wrapped.match(/--payload-b64\s+([A-Za-z0-9+/=]+)/)?.[1];
  assert.ok(encoded, wrapped);
  assert.deepEqual(
    JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')),
    {
      origin: 'tool_shell_payload',
      manifest: path.join(repoRoot, '.agent-workbench', 'trace-manifest.json'),
      outPath: path.join(repoRoot, '.agent-workbench', 'trace-records.jsonl'),
      cwd: repoRoot,
      command,
    },
  );
});

test('Cursor shell injection fails open when shared modules are unavailable', () => {
  const secret = 'sk-test-1234567890abcdef';
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, '.cursor/hooks/inject-shell-trace.mjs')],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENT_WORKBENCH_HOME: path.join(
          os.tmpdir(),
          `missing-DEEPSEEK_API_KEY=${secret}`,
        ),
      },
      input: JSON.stringify({
        tool_name: 'Shell',
        tool_use_id: 'tool_fail_open',
        workspace_roots: [repoRoot],
        tool_input: { command: 'node app.js' },
      }),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});

test('deployed Cursor shell injection template fails open', () => {
  const secret = 'sk-test-1234567890abcdef';
  const result = spawnSync(process.execPath, [templateHook], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AGENT_WORKBENCH_HOME: path.join(
        os.tmpdir(),
        `missing-DEEPSEEK_API_KEY=${secret}`,
      ),
    },
    input: JSON.stringify({
      tool_name: 'Shell',
      workspace_roots: [repoRoot],
      tool_input: { command: 'node app.js' },
    }),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});
