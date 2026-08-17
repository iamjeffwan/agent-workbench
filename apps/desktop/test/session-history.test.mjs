// Session history service contract tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSessionHistoryService } from '../electron/session-history.mjs';

test('history returns explicit empty results until a project is open', () => {
  const service = createService([]);

  assert.deepEqual(service.listSessions(null), {
    status: 'unavailable',
    source: 'codex-rollout',
    data: [],
    error: 'Open a project to browse Codex sessions.',
  });
  assert.deepEqual(service.readSession(null, 'session-one').data, null);
  assert.deepEqual(service.getTrackedSelection(null).data, {
    projectRoot: null,
    sessionIds: [],
  });
});

test('history lists project folders without requiring an active project', () => {
  const projects = [
    {
      projectRoot: path.resolve('recent-project'),
      updatedAt: '2026-08-11T02:00:00.000Z',
      sessionCount: 3,
    },
    {
      projectRoot: path.resolve('older-project'),
      updatedAt: '2026-08-10T02:00:00.000Z',
      sessionCount: 1,
    },
  ];
  const service = createSessionHistoryService({
    getUserDataPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-history-projects-')),
    listSessionProjects: () => projects,
  });

  assert.deepEqual(service.listProjects(), {
    status: 'ready',
    source: 'codex-rollout',
    data: projects,
    error: null,
  });
});

test('history exposes compact session summaries and full selected turns', () => {
  const projectRoot = path.resolve('project-one');
  const turns = [
    { id: 'turn-one', hasObservableActivity: true },
    { id: 'turn-two', hasObservableActivity: false },
  ];
  const service = createService([{
    id: 'session-one',
    provider: 'codex',
    title: 'Implement history',
    startedAt: '2026-08-10T01:00:00.000Z',
    updatedAt: '2026-08-10T02:00:00.000Z',
    turns,
  }]);

  const listed = service.listSessions(projectRoot);
  assert.equal(listed.status, 'ready');
  assert.deepEqual(listed.data[0], {
    id: 'session-one',
    provider: 'codex',
    title: 'Implement history',
    startedAt: '2026-08-10T01:00:00.000Z',
    updatedAt: '2026-08-10T02:00:00.000Z',
    turnCount: 2,
    observableTurnCount: 1,
  });

  const selected = service.readSession(projectRoot, 'session-one');
  assert.equal(selected.status, 'ready');
  assert.deepEqual(selected.data.turns, turns);
  assert.equal(service.readSession(projectRoot, 'missing').data, null);
});

test('tracked session selection persists independently for each project', () => {
  const fixture = createIndexFixture(['one', 'two', 'three']);
  const { userData } = fixture;
  const service = fixture.createService();
  const firstProject = fixture.projectRoot;
  const secondProject = path.join(userData, 'project-two');
  fs.mkdirSync(secondProject, { recursive: true });
  service.listSessions(firstProject);
  service.listSessions(secondProject);

  assert.equal(
    service.setTrackedSelection(firstProject, ['one', 'one', 'two']).status,
    'ready',
  );
  assert.equal(
    service.setTrackedSelection(secondProject, { sessionIds: ['three'] }).status,
    'ready',
  );

  assert.deepEqual(
    service.getTrackedSelection(firstProject).data.sessionIds,
    ['one', 'two'],
  );
  assert.deepEqual(
    service.getTrackedSelection(secondProject).data.sessionIds,
    ['three'],
  );
  assert.equal(
    fs.existsSync(path.join(userData, 'session-tracking.json')),
    true,
  );
});

test('tracking rejects unindexed IDs without replacing the previous selection', () => {
  const fixture = createIndexFixture(['one']);
  const service = fixture.createService();
  assert.equal(service.setTrackedSelection(fixture.projectRoot, []).status, 'ready');
  service.listSessions(fixture.projectRoot);
  assert.equal(service.setTrackedSelection(fixture.projectRoot, ['one']).status, 'ready');

  const rejected = service.setTrackedSelection(
    fixture.projectRoot,
    ['one', 'not-indexed'],
  );

  assert.equal(rejected.status, 'error');
  assert.deepEqual(rejected.data.sessionIds, ['one']);
  assert.deepEqual(
    service.getTrackedSelection(fixture.projectRoot).data.sessionIds,
    ['one'],
  );
});

test('history reader failures are returned without throwing', () => {
  const service = createSessionHistoryService({
    findSessionFiles() {
      throw new Error('rollout unavailable');
    },
    readProjectSession() {
      throw new Error('not reached');
    },
    getUserDataPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-history-error-')),
  });

  assert.deepEqual(service.listSessions(path.resolve('project')).error, 'rollout unavailable');
  assert.equal(service.readSession(path.resolve('project'), 'one').status, 'error');
});

test('history index reuses unchanged rollout files across service restarts', () => {
  const fixture = createIndexFixture(['one', 'two']);

  const first = fixture.createService();
  assert.deepEqual(
    first.listSessions(fixture.projectRoot).data.map(item => item.id),
    ['one', 'two'],
  );
  assert.deepEqual(fixture.reads, ['one', 'two']);

  fixture.reads.length = 0;
  const restarted = fixture.createService();
  assert.deepEqual(
    restarted.listSessions(fixture.projectRoot).data.map(item => item.id),
    ['one', 'two'],
  );
  assert.deepEqual(fixture.reads, []);
});

test('persistent history index stores summaries without turns or original prompts', () => {
  const fixture = createIndexFixture(['one']);
  fixture.prompts.set('one', `private prompt ${'x'.repeat(2_000)}`);
  fixture.createService().listSessions(fixture.projectRoot);
  const indexDir = path.join(fixture.userData, 'session-history');
  const [indexName] = fs.readdirSync(indexDir);
  const indexText = fs.readFileSync(path.join(indexDir, indexName), 'utf8');

  assert.doesNotMatch(indexText, /private prompt/);
  assert.doesNotMatch(indexText, /"turns"/);
  assert.match(indexText, /"turnCount"/);
});

test('session details are reread from the original rollout after restart', () => {
  const fixture = createIndexFixture(['one']);
  fixture.createService().listSessions(fixture.projectRoot);
  fixture.reads.length = 0;
  const restarted = fixture.createService();
  restarted.listSessions(fixture.projectRoot);

  const selected = restarted.readSession(fixture.projectRoot, 'one');

  assert.equal(selected.status, 'ready');
  assert.deepEqual(fixture.reads, ['one']);
  assert.equal(selected.data.turns[0].userInput, fixture.prompts.get('one'));
});

test('session details never fall back to old index data when source reading fails', () => {
  const fixture = createIndexFixture(['one']);
  fixture.createService().listSessions(fixture.projectRoot);
  fixture.failedReads.add('one');

  const unreadable = fixture.createService().readSession(fixture.projectRoot, 'one');
  assert.equal(unreadable.status, 'error');
  assert.equal(unreadable.data, null);

  fixture.failedReads.clear();
  const sourceFile = fixture.files.get('one');
  fs.renameSync(sourceFile, `${sourceFile}.gone`);
  const missing = fixture.createService().readSession(fixture.projectRoot, 'one');
  assert.equal(missing.status, 'error');
  assert.equal(missing.data, null);
});

test('history index reparses only changed or newly discovered rollout files', () => {
  const fixture = createIndexFixture(['one', 'two']);
  fixture.createService().listSessions(fixture.projectRoot);
  fixture.reads.length = 0;

  fs.appendFileSync(fixture.files.get('one'), 'changed', 'utf8');
  fixture.add('three');
  const result = fixture.createService().listSessions(fixture.projectRoot);

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.data.map(item => item.id), ['one', 'three', 'two']);
  assert.deepEqual(fixture.reads, ['one', 'three']);
});

test('history index removes sessions whose rollout files disappeared', () => {
  const fixture = createIndexFixture(['one', 'two']);
  fixture.createService().listSessions(fixture.projectRoot);
  fixture.files.delete('two');
  fixture.reads.length = 0;

  const afterRemoval = fixture.createService().listSessions(fixture.projectRoot);
  assert.deepEqual(afterRemoval.data.map(item => item.id), ['one']);
  assert.deepEqual(fixture.reads, []);

  const restarted = fixture.createService().listSessions(fixture.projectRoot);
  assert.deepEqual(restarted.data.map(item => item.id), ['one']);
});

test('history index safely rebuilds after its stored JSON is corrupted', () => {
  const fixture = createIndexFixture(['one']);
  fixture.createService().listSessions(fixture.projectRoot);
  const indexDir = path.join(fixture.userData, 'session-history');
  const [indexName] = fs.readdirSync(indexDir);
  const indexFile = path.join(indexDir, indexName);
  fs.writeFileSync(indexFile, '{broken index', 'utf8');
  fixture.reads.length = 0;

  const rebuilt = fixture.createService().listSessions(fixture.projectRoot);

  assert.equal(rebuilt.status, 'ready');
  assert.deepEqual(rebuilt.data.map(item => item.id), ['one']);
  assert.deepEqual(fixture.reads, ['one']);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(indexFile, 'utf8')));
});

test('history refresh errors keep the last successful sessions visible', () => {
  const fixture = createIndexFixture(['one']);
  const service = fixture.createService();
  service.listSessions(fixture.projectRoot);
  fixture.failDiscovery = true;

  const failedRefresh = service.listSessions(fixture.projectRoot);

  assert.equal(failedRefresh.status, 'error');
  assert.deepEqual(failedRefresh.data.map(item => item.id), ['one']);

  const afterRestart = fixture.createService().listSessions(fixture.projectRoot);
  assert.equal(afterRestart.status, 'error');
  assert.deepEqual(afterRestart.data.map(item => item.id), ['one']);
});

test('tracked sessions resolve to exact rollout files only through an existing index', () => {
  const fixture = createIndexFixture(['one', 'two']);
  const service = fixture.createService();
  const emptySelection = service.resolveTrackedSessionFiles(fixture.projectRoot, []);
  assert.equal(emptySelection.status, 'ready');
  assert.deepEqual(emptySelection.data.sessionFiles, []);

  const beforeIndex = service.resolveTrackedSessionFiles(fixture.projectRoot, ['one']);
  assert.equal(beforeIndex.status, 'unavailable');
  assert.deepEqual(beforeIndex.data.sessionFiles, []);

  service.listSessions(fixture.projectRoot);
  const resolved = service.resolveTrackedSessionFiles(
    fixture.projectRoot,
    ['two', 'one', 'two'],
  );
  assert.equal(resolved.status, 'ready');
  assert.deepEqual(resolved.data.sessionIds, ['two', 'one']);
  assert.deepEqual(resolved.data.sessionFiles, [
    path.resolve(fixture.files.get('two')),
    path.resolve(fixture.files.get('one')),
  ]);
  assert.deepEqual(resolved.data.missingSessionIds, []);

  const missing = service.resolveTrackedSessionFiles(
    fixture.projectRoot,
    ['one', 'not-indexed'],
  );
  assert.equal(missing.status, 'error');
  assert.deepEqual(missing.data.sessionFiles, [path.resolve(fixture.files.get('one'))]);
  assert.deepEqual(missing.data.missingSessionIds, ['not-indexed']);
});

test('active tracked rollouts stay exact after append only when metadata keeps the same ID', () => {
  const fixture = createIndexFixture(['one']);
  const service = fixture.createService();
  service.listSessions(fixture.projectRoot);
  fs.appendFileSync(fixture.files.get('one'), 'active append', 'utf8');

  const active = service.resolveTrackedSessionFiles(fixture.projectRoot, ['one']);
  assert.equal(active.status, 'ready');
  assert.deepEqual(active.data.sessionFiles, [path.resolve(fixture.files.get('one'))]);

  fixture.metadataIds.set('one', 'different-session');
  const mismatched = service.resolveTrackedSessionFiles(fixture.projectRoot, ['one']);
  assert.equal(mismatched.status, 'error');
  assert.deepEqual(mismatched.data.sessionFiles, []);
  assert.deepEqual(mismatched.data.staleSessionIds, ['one']);
});

test('appended user rollout without an initial cwd still resolves after restart', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-history-no-cwd-'));
  const projectRoot = path.join(userData, 'project');
  const sessionFile = path.join(userData, 'rollout-no-cwd.jsonl');
  fs.mkdirSync(projectRoot, { recursive: true });
  const rows = [
    {
      timestamp: '2026-08-11T01:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'no-cwd-session',
        thread_source: 'user',
      },
    },
    {
      timestamp: '2026-08-11T01:00:01.000Z',
      type: 'turn_context',
      payload: {
        turn_id: 'project-turn',
        cwd: projectRoot,
      },
    },
    {
      timestamp: '2026-08-11T01:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        id: 'project-prompt',
        content: [{ type: 'input_text', text: 'Continue this project task' }],
        internal_chat_message_metadata_passthrough: { turn_id: 'project-turn' },
      },
    },
  ];
  fs.writeFileSync(sessionFile, `${rows.map(JSON.stringify).join('\n')}\n`, 'utf8');
  const first = createSessionHistoryService({
    findSessionFiles: () => [sessionFile],
    getUserDataPath: () => userData,
  });
  assert.equal(first.listSessions(projectRoot).status, 'ready');

  fs.appendFileSync(sessionFile, `${JSON.stringify({
    timestamp: '2026-08-11T01:00:03.000Z',
    type: 'event_msg',
    payload: { type: 'task_complete', turn_id: 'project-turn' },
  })}\n`, 'utf8');
  const restarted = createSessionHistoryService({
    findSessionFiles: () => [sessionFile],
    getUserDataPath: () => userData,
  });

  const resolved = restarted.resolveTrackedSessionFiles(
    projectRoot,
    ['no-cwd-session'],
  );
  assert.equal(resolved.status, 'ready');
  assert.deepEqual(resolved.data.sessionFiles, [path.resolve(sessionFile)]);
});

test('a changed rollout read failure preserves the previous persistent index', () => {
  const fixture = createIndexFixture(['one']);
  fixture.createService().listSessions(fixture.projectRoot);
  fs.appendFileSync(fixture.files.get('one'), 'changed', 'utf8');
  fixture.failedReads.add('one');

  const failed = fixture.createService().listSessions(fixture.projectRoot);
  assert.equal(failed.status, 'error');
  assert.deepEqual(failed.data.map(item => item.id), ['one']);

  fixture.failedReads.clear();
  const recovered = fixture.createService().listSessions(fixture.projectRoot);
  assert.equal(recovered.status, 'ready');
  assert.deepEqual(recovered.data.map(item => item.id), ['one']);
});

function createService(sessions, userData = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-history-'))) {
  const sessionFiles = sessions.map((_, index) => {
    const file = path.join(userData, `rollout-fixture-${index}.jsonl`);
    fs.writeFileSync(file, `${index}\n`, 'utf8');
    return file;
  });
  return createSessionHistoryService({
    findSessionFiles: () => sessionFiles,
    readProjectSession: ({ sessionFile }) =>
      sessions[sessionFiles.indexOf(sessionFile)] ?? null,
    getUserDataPath: () => userData,
  });
}

function createIndexFixture(ids) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-history-index-'));
  const projectRoot = path.join(userData, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  const files = new Map();
  const reads = [];
  const metadataIds = new Map();
  const failedReads = new Set();
  const prompts = new Map();
  let failDiscovery = false;

  const fixture = {
    userData,
    projectRoot,
    files,
    reads,
    metadataIds,
    failedReads,
    prompts,
    get failDiscovery() {
      return failDiscovery;
    },
    set failDiscovery(value) {
      failDiscovery = value;
    },
    add(id) {
      const file = path.join(userData, `rollout-${id}.jsonl`);
      fs.writeFileSync(file, `${id}\n`, 'utf8');
      files.set(id, file);
      metadataIds.set(id, id);
      prompts.set(id, `Prompt for ${id}`);
    },
    createService() {
      return createSessionHistoryService({
        findSessionFiles() {
          if (failDiscovery) throw new Error('session discovery failed');
          return [...files.values()];
        },
        readProjectSession({ sessionFile }) {
          const id = path.basename(sessionFile, '.jsonl').replace('rollout-', '');
          reads.push(id);
          if (failedReads.has(id)) throw new Error(`cannot read ${id}`);
          return sessionFixture(id, prompts.get(id));
        },
        readSessionMetadata(sessionFile) {
          const id = path.basename(sessionFile, '.jsonl').replace('rollout-', '');
          const sessionId = metadataIds.get(id);
          return sessionId ? { sessionId } : null;
        },
        getUserDataPath: () => userData,
      });
    },
  };

  for (const id of ids) fixture.add(id);
  return fixture;
}

function sessionFixture(id, userInput = `Prompt for ${id}`) {
  const order = { one: '03', three: '02', two: '01' }[id] ?? '00';
  return {
    id,
    provider: 'codex',
    title: `Session ${id}`,
    startedAt: `2026-08-10T00:00:${order}.000Z`,
    updatedAt: `2026-08-10T00:00:${order}.000Z`,
    turns: [{ id: `turn-${id}`, hasObservableActivity: true, userInput }],
  };
}
