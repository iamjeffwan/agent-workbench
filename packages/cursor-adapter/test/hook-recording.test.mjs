import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const templateHook = path.join(
  repoRoot,
  'templates/beside-cursor-hooks/record-agent-tool.mjs',
);

test('Cursor hook hides credentials before appending an agent step', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workbench-hook-'));
  const payload = {
    hook_event_name: 'postToolUse',
    tool_name: 'Shell',
    tool_use_id: 'tool_credentials',
    conversation_id: 'SESSION_ID=session-secret',
    transcript_path: 'C:/sessions/sk-test-1234567890abcdef.jsonl',
    workspace_roots: [workspace],
    tool_input: {
      DEEPSEEK_API_KEY: 'sk-test-1234567890abcdef',
      command:
        "TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz node app.js && token='abc123';",
      content: 'A token budget is ordinary product text.',
    },
    tool_output: 'Authorization: Bearer abc.def.ghi',
  };

  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, '.cursor/hooks/record-agent-tool.mjs')],
    { input: JSON.stringify(payload), encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  const outPath = path.join(workspace, '.agent-workbench', 'agent-steps.jsonl');
  const step = JSON.parse(fs.readFileSync(outPath, 'utf8').trim());
  assert.deepEqual(step.arguments, {
    DEEPSEEK_API_KEY: '[REDACTED]',
    command: "TOKEN=[REDACTED] node app.js && token='[REDACTED]';",
    content: 'A token budget is ordinary product text.',
  });
  assert.equal(step.output, 'Authorization: [REDACTED]');
  assert.doesNotMatch(
    JSON.stringify(step),
    /session-secret|sk-test-1234567890abcdef/,
  );
});

test('synthetic Cursor tool ids do not depend on credential values', () => {
  const first = recordWithoutToolId('first-secret');
  const second = recordWithoutToolId('second-secret');

  assert.equal(first.id, second.id);
});

test('Cursor failure errors use strict text redaction before storage', () => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agent-workbench-hook-failure-'),
  );
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, '.cursor/hooks/record-agent-tool.mjs')],
    {
      input: JSON.stringify({
        hook_event_name: 'postToolUseFailure',
        tool_name: 'Shell',
        tool_use_id: 'tool_failure',
        workspace_roots: [workspace],
        tool_input: { command: 'node app.js' },
        error_message: "token='abc123';",
      }),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const step = JSON.parse(
    fs.readFileSync(
      path.join(workspace, '.agent-workbench', 'agent-steps.jsonl'),
      'utf8',
    ),
  );
  assert.equal(step.output.error_message, "token='[REDACTED]';");
});

test('Cursor recording hook fails open when shared modules are unavailable', () => {
  const secret = 'sk-test-1234567890abcdef';
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agent-workbench-hook-fail-open-'),
  );
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, '.cursor/hooks/record-agent-tool.mjs')],
    {
      env: {
        ...process.env,
        AGENT_WORKBENCH_HOME: path.join(
          os.tmpdir(),
          `missing-DEEPSEEK_API_KEY=${secret}`,
        ),
      },
      input: JSON.stringify({
        hook_event_name: 'postToolUse',
        tool_name: 'Shell',
        workspace_roots: [workspace],
        tool_input: { command: 'node app.js' },
      }),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
  assert.doesNotMatch(result.stderr, new RegExp(secret));
  assert.equal(
    fs.existsSync(
      path.join(workspace, '.agent-workbench', 'agent-steps.jsonl'),
    ),
    false,
  );
});

test('deployed Cursor recording template fails open', () => {
  const secret = 'sk-test-1234567890abcdef';
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agent-workbench-template-hook-fail-open-'),
  );
  const result = spawnSync(process.execPath, [templateHook], {
    env: {
      ...process.env,
      AGENT_WORKBENCH_HOME: path.join(
        os.tmpdir(),
        `missing-DEEPSEEK_API_KEY=${secret}`,
      ),
    },
    input: JSON.stringify({
      hook_event_name: 'postToolUse',
      tool_name: 'Shell',
      workspace_roots: [workspace],
      tool_input: { command: 'node app.js' },
    }),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});

function recordWithoutToolId(secret) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workbench-hook-id-'));
  const payload = {
    hook_event_name: 'postToolUse',
    tool_name: 'Shell',
    conversation_id: 'conversation-id',
    workspace_roots: [workspace],
    tool_input: {
      password: secret,
      command: 'node app.js',
    },
    tool_output: { ok: true },
  };
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, '.cursor/hooks/record-agent-tool.mjs')],
    { input: JSON.stringify(payload), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(
    fs.readFileSync(
      path.join(workspace, '.agent-workbench', 'agent-steps.jsonl'),
      'utf8',
    ),
  );
}
