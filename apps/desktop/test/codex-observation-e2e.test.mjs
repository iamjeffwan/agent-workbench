import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { watchCodexProjectSessions } from '@agent-workbench/codex-adapter';
import { buildTimeline, readJsonl } from '@agent-workbench/timeline';

test('desktop Codex source keeps projects separate and builds distinct turns', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-codex-e2e-'));
  const projectRoot = path.join(root, 'project with spaces');
  const sessionsDir = path.join(root, 'sessions');
  const outFile = path.join(projectRoot, '.agent-workbench', 'codex-agent-steps.jsonl');
  fs.mkdirSync(projectRoot, { recursive: true });
  writeSession(sessionsDir, projectRoot, 'matching', [
    ['turn-one', 'call-one'],
    ['turn-two', 'call-two'],
  ]);
  writeSession(sessionsDir, path.join(root, 'other'), 'other', [
    ['other-turn', 'other-call'],
  ]);

  const watcher = watchCodexProjectSessions({
    projectRoot,
    sessionsDir,
    outFile,
    intervalMs: 60_000,
  });
  watcher.close();
  const rows = readJsonl(outFile);
  const turns = buildTimeline(rows, []);

  assert.deepEqual(rows.map((row) => row.id), ['call-one', 'call-two']);
  assert.deepEqual(turns.map((turn) => turn.generationId), ['turn-one', 'turn-two']);
  assert.ok(turns.every((turn) => turn.provider === 'codex'));
});

function writeSession(sessionsDir, cwd, sessionId, calls) {
  fs.mkdirSync(sessionsDir, { recursive: true });
  const rows = [
    event('session_meta', { session_id: sessionId, cwd }),
  ];
  for (const [turnId, callId] of calls) {
    rows.push(event('turn_context', { turn_id: turnId, cwd }));
    rows.push(event('event_msg', { type: 'task_started', turn_id: turnId }));
    rows.push(event('response_item', {
      type: 'function_call',
      name: 'shell_command',
      arguments: JSON.stringify({ command: 'node app.js' }),
      call_id: callId,
    }));
    rows.push(event('response_item', {
      type: 'function_call_output',
      call_id: callId,
      output: 'ok',
    }));
    rows.push(event('event_msg', { type: 'task_complete', turn_id: turnId }));
  }
  fs.writeFileSync(
    path.join(sessionsDir, `rollout-${sessionId}.jsonl`),
    `${rows.map(JSON.stringify).join('\n')}\n`,
    'utf8',
  );
}

function event(type, payload) {
  return {
    timestamp: '2026-08-03T03:00:00.000Z',
    type,
    payload,
  };
}
