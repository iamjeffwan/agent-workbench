import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseCodexRollout } from '../dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));

test('Codex records hide credentials before callers can store them', () => {
  const fixture = path.join(testDir, 'fixtures', 'credentials-rollout.jsonl');
  const [step] = parseCodexRollout(fixture);

  assert.deepEqual(step.arguments, {
    DEEPSEEK_API_KEY: '[REDACTED]',
    command: "TOKEN=[REDACTED] node app.js && token='[REDACTED]';",
    content: 'A token budget is ordinary product text.',
  });
  assert.equal(step.output, 'Authorization: [REDACTED]');
});

test('Codex records keep separate execution turns and custom tool calls', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-turns-'));
  const fixture = path.join(dir, 'rollout-turns.jsonl');
  const rows = [
    line('session_meta', { session_id: 'conversation-one', cwd: dir }),
    line('turn_context', { turn_id: 'turn-one', cwd: dir }),
    line('event_msg', { type: 'task_started', turn_id: 'turn-one' }),
    line('response_item', {
      type: 'custom_tool_call',
      name: 'exec',
      input: 'await tools.shell_command({ command: "pnpm test" })',
      call_id: 'call-custom',
    }),
    line('response_item', {
      type: 'custom_tool_call_output',
      call_id: 'call-custom',
      output: 'tests passed',
    }),
    line('event_msg', { type: 'task_complete', turn_id: 'turn-one' }),
    line('turn_context', { turn_id: 'turn-two', cwd: path.join(dir, 'packages', 'app') }),
    line('event_msg', { type: 'task_started', turn_id: 'turn-two' }),
    line('response_item', {
      type: 'function_call',
      name: 'read_file',
      arguments: JSON.stringify({ path: 'README.md' }),
      call_id: 'call-function',
    }),
    line('response_item', {
      type: 'function_call_output',
      call_id: 'call-function',
      output: 'contents',
    }),
  ];
  fs.writeFileSync(fixture, `${rows.map(JSON.stringify).join('\n')}\n`, 'utf8');

  const steps = parseCodexRollout(fixture);

  assert.equal(steps.length, 2);
  assert.equal(steps[0].conversationId, 'conversation-one');
  assert.equal(steps[0].generationId, 'turn-one');
  assert.equal(steps[0].cwd, path.resolve(dir));
  assert.equal(steps[0].projectAssignment, 'turn_context');
  assert.equal(steps[0].launchesProcess, true);
  assert.equal(steps[0].source, 'codex-rollout');
  assert.equal(steps[1].generationId, 'turn-two');
  assert.equal(steps[1].cwd, path.resolve(dir, 'packages', 'app'));
});

test('Codex unwraps nested exec tools and preserves an exact apply patch payload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-nested-tools-'));
  const fixture = path.join(dir, 'rollout-nested.jsonl');
  const patch = '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-old\n+new\n*** End Patch';
  const rows = [
    line('session_meta', { session_id: 'nested-tools', cwd: dir }),
    line('turn_context', { turn_id: 'turn-nested', cwd: dir }),
    line('response_item', {
      type: 'custom_tool_call',
      name: 'exec',
      input: `const result = await tools.apply_patch(${JSON.stringify(patch)}); text(result)`,
      call_id: 'outer-exec',
    }),
    line('response_item', {
      type: 'custom_tool_call_output',
      call_id: 'outer-exec',
      output: 'Done!',
    }),
  ];
  fs.writeFileSync(fixture, `${rows.map(JSON.stringify).join('\n')}\n`, 'utf8');

  const [step] = parseCodexRollout(fixture);
  assert.equal(step.name, 'apply_patch');
  assert.equal(step.id, 'outer-exec:1:apply_patch');
  assert.equal(step.arguments, patch);
  assert.equal(step.output, 'Done!');
  assert.equal(step.status, 'completed');
  assert.equal(step.outcome, 'exact');
});

test('Codex does not attribute a shared exec result to individual nested tools', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-batched-tools-'));
  const fixture = path.join(dir, 'rollout-batched.jsonl');
  const rows = [
    line('session_meta', { session_id: 'batched-tools', cwd: dir }),
    line('turn_context', { turn_id: 'batched-turn', cwd: dir }),
    line('response_item', {
      type: 'custom_tool_call',
      name: 'exec',
      input: 'const [one, two] = await Promise.all([tools.shell_command({ command: "one" }), tools.shell_command({ command: "two" })])',
      call_id: 'batched-exec',
    }),
    line('response_item', {
      type: 'custom_tool_call_output',
      call_id: 'batched-exec',
      output: '["one result", "two result"]',
    }),
  ];
  fs.writeFileSync(fixture, `${rows.map(JSON.stringify).join('\n')}\n`, 'utf8');

  const steps = parseCodexRollout(fixture);
  assert.equal(steps.length, 2);
  assert.ok(steps.every(step => step.outcome === 'transport-only'));
  assert.ok(steps.every(step => step.output === undefined));
  assert.ok(steps.every(step => step.failed === undefined));
});

test('Codex does not carry a previous turn cwd across a new turn without context', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-missing-context-'));
  const fixture = path.join(dir, 'rollout-missing-context.jsonl');
  const rows = [
    line('session_meta', { session_id: 'missing-context', cwd: dir }),
    line('turn_context', { turn_id: 'turn-one', cwd: dir }),
    line('event_msg', { type: 'task_started', turn_id: 'turn-one' }),
    line('event_msg', { type: 'task_started', turn_id: 'turn-two' }),
    line('response_item', {
      type: 'function_call', name: 'read_file', arguments: '{}', call_id: 'unassigned-call',
    }),
  ];
  fs.writeFileSync(fixture, `${rows.map(JSON.stringify).join('\n')}\n`, 'utf8');

  const [step] = parseCodexRollout(fixture);
  assert.equal(step.generationId, 'turn-two');
  assert.equal(step.cwd, undefined);
  assert.equal(step.projectAssignment, undefined);
});

test('Codex exec unwrapping ignores tool-like text inside strings and comments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-exec-source-'));
  const fixture = path.join(dir, 'rollout-exec-source.jsonl');
  const rows = [
    line('session_meta', { session_id: 'exec-source', cwd: dir }),
    line('turn_context', { turn_id: 'exec-source-turn', cwd: dir }),
    line('response_item', {
      type: 'custom_tool_call',
      name: 'exec',
      input: `const example = "tools.apply_patch('not a call')"; // tools.view_image({ path: 'fake.png' })\nawait tools.shell_command({ command: "pnpm test" })`,
      call_id: 'exec-source-call',
    }),
  ];
  fs.writeFileSync(fixture, `${rows.map(JSON.stringify).join('\n')}\n`, 'utf8');

  const steps = parseCodexRollout(fixture);
  assert.deepEqual(steps.map(step => step.name), ['shell_command']);
  assert.deepEqual(steps[0].arguments, { command: 'pnpm test' });
});

test('Codex records bound large tool output before storage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-output-limit-'));
  const fixture = path.join(dir, 'rollout-large.jsonl');
  const rows = [
    line('session_meta', { session_id: 'large-output', cwd: dir }),
    line('response_item', {
      type: 'function_call',
      name: 'read_file',
      arguments: '{}',
      call_id: 'large-call',
    }),
    line('response_item', {
      type: 'function_call_output',
      call_id: 'large-call',
      output: 'x'.repeat(5_000),
    }),
  ];
  fs.writeFileSync(fixture, `${rows.map(JSON.stringify).join('\n')}\n`, 'utf8');

  const [step] = parseCodexRollout(fixture);
  assert.equal(step.output.$summary, 'truncated');
  assert.equal(step.output.$length, 5_000);
});

function line(type, payload) {
  return {
    timestamp: '2026-08-03T01:00:00.000Z',
    type,
    payload,
  };
}
