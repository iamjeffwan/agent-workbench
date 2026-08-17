import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  listCodexSessionProjects,
  listCodexProjectSessions,
  readCodexProjectSession,
  readCodexTaskEvidence,
} from '../dist/index.js';

test('lists project turns by turn_context cwd and keeps their user input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-project-'));
  const projectRoot = path.join(root, 'project');
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(path.join(projectRoot, 'packages', 'app'), { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  const sessionFile = path.join(sessionsDir, 'rollout-project.jsonl');

  writeRollout(sessionFile, [
    row('2026-08-10T01:00:00.000Z', 'session_meta', {
      session_id: 'session-project',
      cwd: path.join(root, 'different-project'),
      source: 'vscode',
      thread_source: 'user',
    }),
    row('2026-08-10T01:01:00.000Z', 'event_msg', {
      type: 'task_started', turn_id: 'turn-one', started_at: '2026-08-10T01:01:00.000Z',
    }),
    userRow('2026-08-10T01:01:01.000Z', 'turn-one', 'Build the feature with token=ghp_1234567890abcdefghijklmnopqrstuvwxyz'),
    userRow(
      '2026-08-10T01:01:01.500Z',
      'turn-one',
      '<recommended_plugins>ignored</recommended_plugins>\n# AGENTS.md instructions\n<environment_context>ignored</environment_context>',
      'runtime-context',
    ),
    userRow(
      '2026-08-10T01:01:01.750Z',
      'turn-one',
      '<environment_context><workspace_roots></workspace_roots><current_date>2026-08-10</current_date><timezone>UTC</timezone></environment_context>',
      'environment-context',
    ),
    row('2026-08-10T01:01:02.000Z', 'turn_context', {
      turn_id: 'turn-one', cwd: projectRoot,
    }),
    row('2026-08-10T01:01:03.000Z', 'response_item', {
      type: 'custom_tool_call',
      name: 'exec',
      input: 'await tools.apply_patch("*** Begin Patch")',
      call_id: 'patch-one',
      internal_chat_message_metadata_passthrough: { turn_id: 'turn-one' },
    }),
    row('2026-08-10T01:01:04.000Z', 'event_msg', {
      type: 'task_complete', turn_id: 'turn-one', completed_at: '2026-08-10T01:01:04.000Z',
    }),
    row('2026-08-10T01:02:00.000Z', 'turn_context', {
      turn_id: 'turn-outside', cwd: path.join(root, 'different-project'),
    }),
    userRow('2026-08-10T01:02:01.000Z', 'turn-outside', 'This belongs elsewhere'),
    row('2026-08-10T01:03:00.000Z', 'turn_context', {
      turn_id: 'turn-two', cwd: path.join(projectRoot, 'packages', 'app'),
    }),
    userRow('2026-08-10T01:03:01.000Z', 'turn-two', 'Explain the existing implementation'),
    row('2026-08-10T01:03:02.000Z', 'event_msg', {
      type: 'turn_aborted', turn_id: 'turn-two', completed_at: '2026-08-10T01:03:02.000Z',
    }),
  ]);

  const sessions = listCodexProjectSessions({ projectRoot, sessionsDir });

  assert.equal(sessions.length, 1);
  const [session] = sessions;
  assert.equal(session.id, 'session-project');
  assert.equal(session.provider, 'codex');
  assert.equal(session.source, 'vscode');
  assert.equal(session.sessionFile, path.resolve(sessionFile));
  assert.equal(session.turns.length, 2);
  assert.deepEqual(session.turns.map(turn => turn.id), ['turn-one', 'turn-two']);
  assert.equal(session.turns[0].cwd, path.resolve(projectRoot));
  assert.equal(session.turns[0].status, 'completed');
  assert.equal(session.threadSource, 'user');
  assert.deepEqual(session.turns[0].activities, ['WRITE', 'DIFF']);
  assert.equal(session.turns[0].hasObservableActivity, true);
  assert.match(session.turns[0].userInput, /ghp_1234567890abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(session.turns[0].userInput, /recommended_plugins/);
  assert.doesNotMatch(session.turns[0].userInput, /workspace_roots/);
  assert.equal(session.turns[1].status, 'aborted');
  assert.deepEqual(session.turns[1].activities, ['ERROR']);
  assert.equal(session.turns[1].hasObservableActivity, false);
  assert.equal(session.startedAt, '2026-08-10T01:01:00.000Z');
  assert.equal(session.updatedAt, '2026-08-10T01:03:02.000Z');
});

test('uses response metadata before current context and never guesses project ownership', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-assignment-'));
  const projectRoot = path.join(root, 'project');
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  writeRollout(path.join(sessionsDir, 'rollout-assignment.jsonl'), [
    row('2026-08-10T02:00:00.000Z', 'session_meta', {
      session_id: 'session-assignment', cwd: projectRoot, thread_source: 'user',
    }),
    row('2026-08-10T02:01:00.000Z', 'turn_context', {
      turn_id: 'project-turn', cwd: projectRoot,
    }),
    userRow('2026-08-10T02:01:01.000Z', 'outside-turn', 'Outside prompt arrives while project turn is current'),
    row('2026-08-10T02:01:02.000Z', 'response_item', {
      type: 'message',
      role: 'user',
      id: 'current-project-input',
      content: [{ type: 'input_text', text: 'Project prompt without metadata' }],
    }),
    row('2026-08-10T02:02:00.000Z', 'turn_context', {
      turn_id: 'outside-turn', cwd: path.join(root, 'outside'),
    }),
    row('2026-08-10T02:03:00.000Z', 'event_msg', {
      type: 'task_started', turn_id: 'missing-context-turn',
    }),
    row('2026-08-10T02:03:01.000Z', 'response_item', {
      type: 'message',
      role: 'user',
      id: 'unassigned-input',
      content: [{ type: 'input_text', text: 'Never assign this from session cwd' }],
    }),
  ]);

  const [session] = listCodexProjectSessions({ projectRoot, sessionsDir });

  assert.deepEqual(session.turns.map(turn => turn.id), ['project-turn']);
  assert.equal(session.turns[0].userInput, 'Project prompt without metadata');
  assert.doesNotMatch(session.turns[0].userInput, /Outside prompt/);
  assert.doesNotMatch(session.turns[0].userInput, /Never assign/);
});

test('classifies observable work, failures and leaves reads out of activity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-activity-'));
  const projectRoot = path.join(root, 'project');
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  writeRollout(path.join(sessionsDir, 'rollout-activity.jsonl'), [
    row('2026-08-10T03:00:00.000Z', 'session_meta', {
      session_id: 'session-activity', source: { type: 'appServer' }, thread_source: 'user',
    }),
    row('2026-08-10T03:00:01.000Z', 'turn_context', {
      turn_id: 'activity-turn', cwd: projectRoot,
    }),
    userRow('2026-08-10T03:00:02.000Z', 'activity-turn', 'Run checks and research the error'),
    toolRow('2026-08-10T03:00:03.000Z', 'activity-turn', 'read_file', { path: 'README.md' }),
    toolRow('2026-08-10T03:00:04.000Z', 'activity-turn', 'exec_command', { cmd: 'pnpm test' }),
    toolRow('2026-08-10T03:00:05.000Z', 'activity-turn', 'web_search', { query: 'official docs' }),
    toolRow('2026-08-10T03:00:06.000Z', 'activity-turn', 'write_file', { path: 'src/app.ts' }),
    row('2026-08-10T03:00:07.000Z', 'event_msg', {
      type: 'mcp_tool_call_end', turn_id: 'activity-turn', result: { isError: false },
    }),
    row('2026-08-10T03:00:08.000Z', 'event_msg', {
      type: 'task_complete', turn_id: 'activity-turn', error: { message: 'failed' },
    }),
  ]);

  const [session] = listCodexProjectSessions({ projectRoot, sessionsDir });
  const [turn] = session.turns;

  assert.equal(session.source, 'appServer');
  assert.equal(turn.status, 'failed');
  assert.deepEqual(turn.activities, [
    'SEARCH', 'PROCESS', 'REQUEST', 'WRITE', 'TEST', 'TOOL', 'ERROR',
  ]);
  assert.equal(turn.hasObservableActivity, true);
});

test('keeps the complete original turn input while bounding only its title', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-bounds-'));
  const projectRoot = path.join(root, 'project');
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  const secret = 'sk-1234567890abcdefghijklmnop';
  const longPrompt = `Use ${secret} only as a fixture ${'x'.repeat(9_000)}`;

  writeRollout(path.join(sessionsDir, 'rollout-bounds.jsonl'), [
    row('2026-08-10T04:00:00.000Z', 'session_meta', {
      session_id: 'session-bounds', thread_source: 'user',
    }),
    row('2026-08-10T04:00:01.000Z', 'turn_context', {
      turn_id: 'bounds-turn', cwd: projectRoot,
    }),
    userRow('2026-08-10T04:00:02.000Z', 'bounds-turn', longPrompt),
  ]);

  const [session] = listCodexProjectSessions({ projectRoot, sessionsDir });
  const [turn] = session.turns;

  assert.equal(turn.userInput, longPrompt);
  assert.equal(turn.userInputs[0].text, longPrompt);
  assert.match(turn.userInput, new RegExp(secret));
  assert.ok(session.title.length <= 120);
  assert.match(session.title, /\u2026$/);
});

test('accepts only explicit user threads in the session picker', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-subagents-'));
  const projectRoot = path.join(root, 'project');
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  writeRollout(path.join(sessionsDir, 'rollout-subagent.jsonl'), [
    row('2026-08-10T05:00:00.000Z', 'session_meta', {
      session_id: 'internal-subagent', thread_source: 'subagent',
    }),
    row('2026-08-10T05:00:01.000Z', 'turn_context', {
      turn_id: 'subagent-turn', cwd: projectRoot,
    }),
    userRow('2026-08-10T05:00:02.000Z', 'subagent-turn', 'Internal delegated task'),
  ]);

  writeRollout(path.join(sessionsDir, 'rollout-unknown.jsonl'), [
    row('2026-08-10T05:01:00.000Z', 'session_meta', {
      session_id: 'missing-thread-source',
    }),
    row('2026-08-10T05:01:01.000Z', 'turn_context', {
      turn_id: 'unknown-turn', cwd: projectRoot,
    }),
    userRow('2026-08-10T05:01:02.000Z', 'unknown-turn', 'Unknown source task'),
  ]);

  assert.deepEqual(
    listCodexProjectSessions({ projectRoot, sessionsDir }),
    [],
  );
});

test('keeps the rollout identity from its first session metadata record', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-copied-parent-'));
  const projectRoot = path.join(root, 'project');
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  writeRollout(path.join(sessionsDir, 'rollout-subagent-own-id.jsonl'), [
    row('2026-08-10T05:05:00.000Z', 'session_meta', {
      id: 'subagent-own-id',
      session_id: 'parent-user-id',
      thread_source: 'subagent',
      source: { subagent: { parent_thread_id: 'parent-user-id' } },
    }),
    row('2026-08-10T05:05:01.000Z', 'turn_context', {
      turn_id: 'subagent-turn', cwd: projectRoot,
    }),
    userRow('2026-08-10T05:05:02.000Z', 'subagent-turn', 'Internal delegated task'),
    row('2026-08-10T05:06:00.000Z', 'session_meta', {
      id: 'parent-user-id',
      session_id: 'parent-user-id',
      thread_source: 'user',
      source: 'vscode',
    }),
  ]);

  assert.deepEqual(
    listCodexProjectSessions({ projectRoot, sessionsDir }),
    [],
  );
});

test('groups user sessions by project folder and sorts projects by recent activity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-project-groups-'));
  const firstProject = path.join(root, 'first-project');
  const secondProject = path.join(root, 'second-project');
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(firstProject, { recursive: true });
  fs.mkdirSync(secondProject, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  const createSession = (id, projectRoot, updatedAt, threadSource = 'user') => {
    writeRollout(path.join(sessionsDir, `rollout-${id}.jsonl`), [
      row('2026-08-10T01:00:00.000Z', 'session_meta', {
        id, session_id: id, thread_source: threadSource,
      }),
      row('2026-08-10T01:00:01.000Z', 'turn_context', {
        turn_id: `${id}-turn`, cwd: projectRoot,
      }),
      userRow(updatedAt, `${id}-turn`, `Prompt for ${id}`),
    ]);
  };

  createSession('first-older', firstProject, '2026-08-10T02:00:00.000Z');
  createSession('first-newer', firstProject, '2026-08-10T03:00:00.000Z');
  createSession('second-newest', secondProject, '2026-08-10T04:00:00.000Z');
  createSession('ignored-subagent', secondProject, '2026-08-10T05:00:00.000Z', 'subagent');

  const projects = listCodexSessionProjects({ sessionsDir });

  assert.deepEqual(projects, [
    {
      projectRoot: path.resolve(secondProject),
      updatedAt: '2026-08-10T04:00:00.000Z',
      sessionCount: 1,
    },
    {
      projectRoot: path.resolve(firstProject),
      updatedAt: '2026-08-10T03:00:00.000Z',
      sessionCount: 2,
    },
  ]);
  assert.deepEqual(
    listCodexProjectSessions({ projectRoot: firstProject, sessionsDir })
      .map(session => session.id),
    ['first-newer', 'first-older'],
  );
});

test('task evidence contains only selected turn behavior with metrics and source lines', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-task-evidence-'));
  const projectRoot = path.join(root, 'project');
  const sessionFile = path.join(root, 'rollout-task.jsonl');
  fs.mkdirSync(projectRoot, { recursive: true });

  writeRollout(sessionFile, [
    row('2026-08-10T07:00:00.000Z', 'session_meta', {
      id: 'task-session', session_id: 'task-session', thread_source: 'user',
    }),
    row('2026-08-10T07:00:01.000Z', 'turn_context', {
      turn_id: 'selected-turn', cwd: projectRoot,
    }),
    userRow('2026-08-10T07:00:02.000Z', 'selected-turn', 'Implement the selected task'),
    userRow(
      '2026-08-10T07:00:02.500Z',
      'selected-turn',
      '<recommended_plugins>ignored</recommended_plugins>\n# AGENTS.md instructions\n<environment_context>ignored</environment_context>',
      'runtime-context',
    ),
    row('2026-08-10T07:00:03.000Z', 'event_msg', {
      type: 'agent_reasoning', text: 'Inspect the implementation before editing.',
    }),
    toolRow('2026-08-10T07:00:04.000Z', 'selected-turn', 'exec_command', { cmd: 'pnpm test' }),
    row('2026-08-10T07:00:05.000Z', 'response_item', {
      type: 'function_call_output', call_id: 'call-exec_command', output: { exit_code: 0, output: 'passed' },
      internal_chat_message_metadata_passthrough: { turn_id: 'selected-turn' },
    }),
    row('2026-08-10T07:00:06.000Z', 'event_msg', {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: 100, cached_input_tokens: 25, cache_write_input_tokens: 0,
          output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120,
        },
      },
    }),
    row('2026-08-10T07:00:07.000Z', 'event_msg', {
      type: 'task_complete', turn_id: 'selected-turn', duration_ms: 6_000, time_to_first_token_ms: 450,
    }),
    row('2026-08-10T07:01:00.000Z', 'turn_context', {
      turn_id: 'unselected-turn', cwd: projectRoot,
    }),
    userRow('2026-08-10T07:01:01.000Z', 'unselected-turn', 'Do not include this turn'),
  ]);

  const evidence = readCodexTaskEvidence({
    projectRoot,
    sessionFile,
    sessionId: 'task-session',
    turnIds: ['selected-turn'],
  });

  assert.deepEqual(evidence.turns.map(turn => turn.id), ['selected-turn']);
  assert.equal(evidence.turns[0].userInput, 'Implement the selected task');
  assert.equal(evidence.turns[0].metrics.durationMs, 6_000);
  assert.equal(evidence.turns[0].metrics.timeToFirstTokenMs, 450);
  assert.equal(evidence.turns[0].metrics.tokens.total, 120);
  assert.deepEqual(
    evidence.turns[0].events.map(event => event.kind),
    ['user-input', 'reasoning', 'tool-call', 'tool-result', 'completion'],
  );
  assert.ok(evidence.turns[0].events.every(event => event.source.line > 0));
  assert.doesNotMatch(JSON.stringify(evidence), /recommended_plugins|Do not include this turn/);
});

test('reads one rollout through the same project and source rules', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-single-'));
  const projectRoot = path.join(root, 'project');
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  const sessionFile = path.join(sessionsDir, 'rollout-single.jsonl');

  writeRollout(sessionFile, [
    row('2026-08-10T05:10:00.000Z', 'session_meta', {
      session_id: 'single-user', thread_source: 'user',
    }),
    row('2026-08-10T05:10:01.000Z', 'turn_context', {
      turn_id: 'single-turn', cwd: projectRoot,
    }),
    userRow('2026-08-10T05:10:02.000Z', 'single-turn', 'Inspect this one file'),
  ]);

  const session = readCodexProjectSession({ projectRoot, sessionFile });
  assert.equal(session.id, 'single-user');
  assert.deepEqual(session.turns.map(turn => turn.id), ['single-turn']);

  fs.writeFileSync(sessionFile, `${JSON.stringify(row(
    '2026-08-10T05:10:00.000Z',
    'session_meta',
    { session_id: 'single-user' },
  ))}\n`, 'utf8');
  assert.equal(readCodexProjectSession({ projectRoot, sessionFile }), null);
});

test('single-rollout reads surface source file failures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-read-error-'));
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });

  assert.throws(
    () => readCodexProjectSession({
      projectRoot,
      sessionFile: path.join(root, 'missing-rollout.jsonl'),
    }),
    error => error?.code === 'ENOENT',
  );
});

test('ignores bad lines, handles a missing sessions directory and sorts deterministically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-stability-'));
  const projectRoot = path.join(root, 'project');
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  assert.deepEqual(
    listCodexProjectSessions({
      projectRoot,
      sessionsDir: path.join(root, 'missing-sessions'),
    }),
    [],
  );

  for (const sessionId of ['session-b', 'session-a']) {
    const file = path.join(sessionsDir, `rollout-${sessionId}.jsonl`);
    writeRollout(file, [
      row('2026-08-10T06:00:00.000Z', 'session_meta', {
        session_id: sessionId, thread_source: 'user',
      }),
      row('2026-08-10T06:00:01.000Z', 'turn_context', {
        turn_id: 'turn-b', cwd: projectRoot,
      }),
      userRow('2026-08-10T06:00:02.000Z', 'turn-b', 'Second by id'),
      row('2026-08-10T06:00:01.000Z', 'turn_context', {
        turn_id: 'turn-a', cwd: projectRoot,
      }),
      userRow('2026-08-10T06:00:02.000Z', 'turn-a', 'First by id'),
    ]);
    fs.appendFileSync(file, '{not valid json}\n', 'utf8');
  }

  const sessions = listCodexProjectSessions({ projectRoot, sessionsDir });
  assert.deepEqual(
    sessions.map(session => session.id),
    ['session-a', 'session-b'],
  );
  assert.deepEqual(
    sessions[0].turns.map(turn => turn.id),
    ['turn-a', 'turn-b'],
  );
});

function row(timestamp, type, payload) {
  return { timestamp, type, payload };
}

function userRow(timestamp, turnId, text, id = `message-${turnId}`) {
  return row(timestamp, 'response_item', {
    type: 'message',
    role: 'user',
    id,
    content: [{ type: 'input_text', text }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId },
  });
}

function toolRow(timestamp, turnId, name, args) {
  return row(timestamp, 'response_item', {
    type: 'function_call',
    name,
    arguments: JSON.stringify(args),
    call_id: `call-${name}`,
    internal_chat_message_metadata_passthrough: { turn_id: turnId },
  });
}

function writeRollout(file, rows) {
  fs.writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`, 'utf8');
}
