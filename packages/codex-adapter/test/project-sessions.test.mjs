import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isCodexSessionForProject,
  readCodexSessionMetadata,
  syncCodexProjectSessions,
  watchCodexProjectSessions,
} from '../dist/index.js';

test('session metadata identifies its project and conversation', () => {
  const fixture = makeSession({ cwd: 'C:/work/project', sessionId: 'session-one' });
  const metadata = readCodexSessionMetadata(fixture);

  assert.equal(metadata?.sessionId, 'session-one');
  assert.equal(metadata?.cwd, path.resolve('C:/work/project'));
  assert.equal(metadata?.startedAt, '2026-08-03T01:00:00.000Z');
});

test('session metadata keeps conversation identity when initial cwd is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-identity-'));
  const sessionFile = path.join(root, 'rollout-no-cwd.jsonl');
  fs.writeFileSync(
    sessionFile,
    `${JSON.stringify(sessionLine('session_meta', {
      session_id: 'identity-only-session',
    }))}\n`,
    'utf8',
  );

  const metadata = readCodexSessionMetadata(sessionFile);

  assert.equal(metadata?.sessionId, 'identity-only-session');
  assert.equal(metadata?.cwd, null);
});

test('session metadata uses the rollout own ID instead of its parent session ID', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-own-id-'));
  const sessionFile = path.join(root, 'rollout-subagent.jsonl');
  fs.writeFileSync(
    sessionFile,
    `${JSON.stringify(sessionLine('session_meta', {
      id: 'subagent-own-id',
      session_id: 'parent-user-id',
      thread_source: 'subagent',
    }))}\n`,
    'utf8',
  );

  assert.equal(readCodexSessionMetadata(sessionFile)?.sessionId, 'subagent-own-id');
});

test('project matching accepts the project and its children but rejects other places', () => {
  assert.equal(isCodexSessionForProject('C:/work/project', 'C:/work/project'), true);
  assert.equal(isCodexSessionForProject('C:/work/project/packages/app', 'C:/work/project'), true);
  assert.equal(isCodexSessionForProject('C:/work/project-other', 'C:/work/project'), false);
  assert.equal(isCodexSessionForProject('C:/work/elsewhere', 'C:/work/project'), false);
});

test('project sync writes only matching Codex conversations to its own source file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-project-sync-'));
  const projectRoot = path.join(root, 'registered project');
  const otherRoot = path.join(root, 'other-project');
  const sessionsDir = path.join(root, 'sessions');
  const outFile = path.join(projectRoot, '.agent-workbench', 'codex-agent-steps.jsonl');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(otherRoot, { recursive: true });

  makeSession({
    sessionsDir,
    cwd: projectRoot,
    sessionId: 'matching-session',
    callId: 'matching-call',
  });
  makeSession({
    sessionsDir,
    cwd: otherRoot,
    sessionId: 'other-session',
    callId: 'other-call',
  });

  const result = syncCodexProjectSessions({ projectRoot, sessionsDir, outFile });
  const rows = fs.readFileSync(outFile, 'utf8').trim().split(/\r?\n/).map(JSON.parse);

  assert.equal(result.sessionCount, 1);
  assert.equal(result.stepCount, 1);
  assert.equal(rows[0].id, 'matching-call');
  assert.equal(rows[0].conversationId, 'matching-session');
  assert.equal(rows[0].provider, 'codex');
  assert.equal(rows.some((row) => row.id === 'other-call'), false);
});

test('project sync reads only conversations explicitly selected for tracking', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-selected-sync-'));
  const projectRoot = path.join(root, 'project');
  const sessionsDir = path.join(root, 'sessions');
  const outFile = path.join(projectRoot, '.agent-workbench', 'codex-agent-steps.jsonl');
  fs.mkdirSync(projectRoot, { recursive: true });

  makeSession({
    sessionsDir,
    cwd: projectRoot,
    sessionId: 'selected-session',
    callId: 'selected-call',
  });
  makeSession({
    sessionsDir,
    cwd: projectRoot,
    sessionId: 'unselected-session',
    callId: 'unselected-call',
  });

  const result = syncCodexProjectSessions({
    projectRoot,
    sessionsDir,
    outFile,
    conversationIds: ['selected-session'],
  });
  const rows = fs.readFileSync(outFile, 'utf8').trim().split(/\r?\n/).map(JSON.parse);

  assert.equal(result.sessionCount, 1);
  assert.deepEqual(rows.map((row) => row.conversationId), ['selected-session']);
  assert.equal(rows.some((row) => row.id === 'unselected-call'), false);
});

test('project sync can use indexed rollout paths without rediscovering all sessions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-indexed-sync-'));
  const projectRoot = path.join(root, 'project');
  const indexedDir = path.join(root, 'indexed');
  const emptySessionsDir = path.join(root, 'empty-sessions');
  const outFile = path.join(projectRoot, '.agent-workbench', 'codex-agent-steps.jsonl');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(emptySessionsDir, { recursive: true });
  const sessionFile = makeSession({
    sessionsDir: indexedDir,
    cwd: projectRoot,
    sessionId: 'indexed-session',
    callId: 'indexed-call',
  });

  const result = syncCodexProjectSessions({
    projectRoot,
    sessionsDir: emptySessionsDir,
    sessionFiles: [sessionFile],
    conversationIds: ['indexed-session'],
    outFile,
  });

  assert.equal(result.sessionCount, 1);
  assert.equal(JSON.parse(fs.readFileSync(outFile, 'utf8').trim()).id, 'indexed-call');
});

test('indexed rollout paths use turn cwd even when session metadata has no cwd', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-indexed-turn-cwd-'));
  const projectRoot = path.join(root, 'project');
  const sessionsDir = path.join(root, 'sessions');
  const outFile = path.join(projectRoot, '.agent-workbench', 'codex-agent-steps.jsonl');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  const sessionFile = path.join(sessionsDir, 'rollout-turn-cwd.jsonl');
  const rows = [
    sessionLine('session_meta', { session_id: 'turn-cwd-session' }),
    sessionLine('turn_context', { turn_id: 'project-turn', cwd: projectRoot }),
    ...callRows('turn-cwd-call'),
  ];
  fs.writeFileSync(sessionFile, `${rows.map(JSON.stringify).join('\n')}\n`, 'utf8');

  const result = syncCodexProjectSessions({
    projectRoot,
    sessionFiles: [sessionFile],
    conversationIds: ['turn-cwd-session'],
    outFile,
  });

  assert.equal(result.sessionCount, 1);
  assert.equal(JSON.parse(fs.readFileSync(outFile, 'utf8').trim()).id, 'turn-cwd-call');
});

test('project sync assigns mixed-session tools by each turn context cwd', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-turn-project-sync-'));
  const projectRoot = path.join(root, 'current-project');
  const oldRoot = path.join(root, 'old-project');
  const sessionsDir = path.join(root, 'sessions');
  const outFile = path.join(projectRoot, '.agent-workbench', 'codex-agent-steps.jsonl');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(oldRoot, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  const sessionFile = path.join(sessionsDir, 'rollout-moved-session.jsonl');
  const rows = [
    sessionLine('session_meta', { session_id: 'moved-session', cwd: oldRoot }),
    sessionLine('turn_context', { turn_id: 'old-turn', cwd: oldRoot }),
    ...callRows('old-call'),
    sessionLine('turn_context', { turn_id: 'current-turn', cwd: projectRoot }),
    ...callRows('current-call'),
  ];
  fs.writeFileSync(sessionFile, `${rows.map(JSON.stringify).join('\n')}\n`, 'utf8');

  const result = syncCodexProjectSessions({ projectRoot, sessionsDir, outFile });
  const output = fs.readFileSync(outFile, 'utf8').trim().split(/\r?\n/).map(JSON.parse);

  assert.equal(result.sessionCount, 1);
  assert.equal(result.stepCount, 1);
  assert.equal(output[0].id, 'current-call');
  assert.equal(output[0].generationId, 'current-turn');
  assert.equal(output[0].cwd, path.resolve(projectRoot));
});

test('project watcher discovers a matching conversation created later', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-project-watch-'));
  const projectRoot = path.join(root, 'registered-project');
  const sessionsDir = path.join(root, 'sessions');
  const outFile = path.join(projectRoot, '.agent-workbench', 'codex-agent-steps.jsonl');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  const discovered = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('conversation was not discovered')), 3_000);
    const watcher = watchCodexProjectSessions({
      projectRoot,
      sessionsDir,
      outFile,
      intervalMs: 250,
      onChange(result) {
        if (result.stepCount === 1) {
          clearTimeout(timeout);
          watcher.close();
          resolve(result);
        }
      },
      onError(error) {
        clearTimeout(timeout);
        watcher.close();
        reject(error);
      },
    });
  });

  makeSession({
    sessionsDir,
    cwd: projectRoot,
    sessionId: 'later-session',
    callId: 'later-call',
  });

  await discovered;
  const row = JSON.parse(fs.readFileSync(outFile, 'utf8').trim());
  assert.equal(row.conversationId, 'later-session');
});

test('project watcher checkpoints complete lines and resumes after restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-project-resume-'));
  const projectRoot = path.join(root, 'registered-project');
  const sessionsDir = path.join(root, 'sessions');
  const outFile = path.join(projectRoot, '.agent-workbench', 'codex-agent-steps.jsonl');
  const stateFile = path.join(projectRoot, '.agent-workbench', 'codex-sync-state.json');
  fs.mkdirSync(projectRoot, { recursive: true });
  const sessionFile = makeSession({
    sessionsDir,
    cwd: projectRoot,
    sessionId: 'resumed-session',
    callId: 'first-call',
  });
  const watcher = watchCodexProjectSessions({
    projectRoot,
    sessionsDir,
    outFile,
    stateFile,
    intervalMs: 60_000,
  });

  const secondCall = JSON.stringify({
    timestamp: '2026-08-03T01:00:03.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'read_file',
      arguments: JSON.stringify({ path: 'second.md' }),
      call_id: 'second-call',
    },
  });
  fs.appendFileSync(sessionFile, secondCall.slice(0, 30), 'utf8');
  assert.equal(watcher.syncNow().stepCount, 1);
  fs.appendFileSync(
    sessionFile,
    `${secondCall.slice(30)}\n${JSON.stringify({
      timestamp: '2026-08-03T01:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'second-call',
        output: 'second output',
      },
    })}\n`,
    'utf8',
  );
  assert.equal(watcher.syncNow().stepCount, 2);
  watcher.close();

  const checkpoint = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(checkpoint.version, 4);
  assert.equal(checkpoint.sessions[path.resolve(sessionFile)].offset, fs.statSync(sessionFile).size);

  appendCall(sessionFile, 'third-call');
  const resumed = watchCodexProjectSessions({
    projectRoot,
    sessionsDir,
    outFile,
    stateFile,
    intervalMs: 60_000,
  });
  assert.equal(resumed.syncNow().stepCount, 3);
  resumed.close();
});

test('project watcher rebuilds a session after its source file is truncated', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-project-truncate-'));
  const projectRoot = path.join(root, 'project');
  const sessionsDir = path.join(root, 'sessions');
  const outFile = path.join(projectRoot, '.agent-workbench', 'codex-agent-steps.jsonl');
  const stateFile = path.join(projectRoot, '.agent-workbench', 'codex-sync-state.json');
  fs.mkdirSync(projectRoot, { recursive: true });
  const sessionFile = makeSession({
    sessionsDir,
    cwd: projectRoot,
    sessionId: 'truncated-session',
    callId: 'old-call-with-a-long-name',
  });
  const watcher = watchCodexProjectSessions({
    projectRoot,
    sessionsDir,
    outFile,
    stateFile,
    intervalMs: 60_000,
  });

  fs.writeFileSync(
    sessionFile,
    `${[
      {
        timestamp: '2026-08-03T02:00:00.000Z',
        type: 'session_meta',
        payload: { session_id: 'truncated-session', cwd: projectRoot },
      },
      {
        timestamp: '2026-08-03T02:00:00.500Z',
        type: 'turn_context',
        payload: { turn_id: 'truncated-turn', cwd: projectRoot },
      },
      {
        timestamp: '2026-08-03T02:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'read_file',
          arguments: '{}',
          call_id: 'new-call',
        },
      },
    ].map(JSON.stringify).join('\n')}\n`,
    'utf8',
  );

  const result = watcher.syncNow();
  watcher.close();
  const rows = fs.readFileSync(outFile, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(result.stepCount, 1);
  assert.equal(rows[0].id, 'new-call');
});

function makeSession({
  sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-')),
  cwd,
  sessionId,
  callId = 'call-one',
}) {
  fs.mkdirSync(sessionsDir, { recursive: true });
  const file = path.join(sessionsDir, `rollout-${sessionId}.jsonl`);
  const rows = [
    {
      timestamp: '2026-08-03T01:00:00.000Z',
      type: 'session_meta',
      payload: { id: sessionId, session_id: sessionId, cwd },
    },
    {
      timestamp: '2026-08-03T01:00:00.500Z',
      type: 'turn_context',
      payload: { turn_id: `${sessionId}-turn`, cwd },
    },
    {
      timestamp: '2026-08-03T01:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'read_file',
        arguments: JSON.stringify({ path: 'README.md' }),
        call_id: callId,
      },
    },
    {
      timestamp: '2026-08-03T01:00:02.000Z',
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: callId, output: 'ok' },
    },
  ];
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return file;
}

function appendCall(sessionFile, callId) {
  const rows = [
    {
      timestamp: '2026-08-03T01:00:05.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'read_file',
        arguments: JSON.stringify({ path: `${callId}.md` }),
        call_id: callId,
      },
    },
    {
      timestamp: '2026-08-03T01:00:06.000Z',
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: callId, output: 'ok' },
    },
  ];
  fs.appendFileSync(
    sessionFile,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
}

function sessionLine(type, payload, timestamp = '2026-08-03T01:00:00.000Z') {
  return { timestamp, type, payload };
}

function callRows(callId) {
  return [
    sessionLine('response_item', {
      type: 'function_call',
      name: 'read_file',
      arguments: '{}',
      call_id: callId,
    }),
    sessionLine('response_item', {
      type: 'function_call_output',
      call_id: callId,
      output: 'ok',
    }),
  ];
}
