import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProjectObservationService } from '../electron/project-observation-service.mjs';

test('captures a turn before completion and persists derived facts once', () => {
  const fixture = createFixture();
  const captures = [];
  let derivations = 0;
  const service = createService(fixture, {
    captureState(context) {
      const capture = fakeCapture(context, `tree-${captures.length}`);
      captures.push(capture);
      return capture;
    },
    deriveFacts(context, before, after) {
      derivations += 1;
      return fakeFacts(context, before, after);
    },
  });

  assert.equal(service.observe(fixture.projectRoot, [contextEvent()]).data.observing, 1);
  const completed = service.observe(fixture.projectRoot, [contextEvent(), completedEvent()]);
  assert.equal(completed.status, 'ready');
  assert.equal(completed.data.completed, 1);
  assert.equal(captures.length, 2);
  assert.equal(derivations, 1);

  service.observe(fixture.projectRoot, [contextEvent(), completedEvent()]);
  assert.equal(captures.length, 2);
  assert.equal(derivations, 1);
  const stored = service.read(fixture.projectRoot).data;
  const turn = Object.values(stored.turns)[0];
  assert.equal(turn.facts.turnDiff.baseRef, 'tree-0');
  assert.equal(turn.facts.turnDiff.resultRef, 'tree-1');
  assert.equal(turn.attribution, 'source_uncertain');
});

test('continues an observing turn after the desktop service restarts', () => {
  const fixture = createFixture();
  let captures = 0;
  const dependencies = {
    captureState(context) {
      return fakeCapture(context, `tree-${captures++}`);
    },
    deriveFacts: fakeFacts,
  };
  createService(fixture, dependencies).observe(fixture.projectRoot, [contextEvent()]);

  const restarted = createService(fixture, dependencies);
  const result = restarted.observe(fixture.projectRoot, [contextEvent(), completedEvent()]);
  assert.equal(result.data.completed, 1);
  assert.equal(captures, 2);
});

test('marks a completed turn unavailable when listening began too late', () => {
  const fixture = createFixture();
  let captures = 0;
  const service = createService(fixture, {
    captureState() {
      captures += 1;
      throw new Error('should not capture');
    },
  });

  const result = service.observe(fixture.projectRoot, [contextEvent(), completedEvent()]);
  assert.equal(result.data.unavailable, 1);
  assert.equal(captures, 0);
  const turn = Object.values(service.read(fixture.projectRoot).data.turns)[0];
  assert.equal(turn.reason, 'turn_started_before_observation');
});

test('records capture failures without breaking later refreshes', () => {
  const fixture = createFixture();
  let shouldFail = true;
  const service = createService(fixture, {
    captureState(context) {
      if (shouldFail) throw new Error('git unavailable');
      return fakeCapture(context, 'tree-retry');
    },
  });

  const failed = service.observe(fixture.projectRoot, [contextEvent()]);
  assert.equal(failed.status, 'ready');
  assert.equal(failed.data.error, 1);
  shouldFail = false;
  const retried = service.observe(fixture.projectRoot, [contextEvent()]);
  assert.equal(retried.data.observing, 1);
});

test('retries an after-state capture failure without replacing the before state', () => {
  const fixture = createFixture();
  let captureCount = 0;
  let failAfter = true;
  const service = createService(fixture, {
    captureState(context) {
      captureCount += 1;
      if (captureCount > 1 && failAfter) throw new Error('temporary git failure');
      return fakeCapture(context, `tree-${captureCount}`);
    },
  });

  service.observe(fixture.projectRoot, [contextEvent()]);
  const failed = service.observe(fixture.projectRoot, [contextEvent(), completedEvent()]);
  assert.equal(failed.data.error, 1);
  const failedTurn = Object.values(service.read(fixture.projectRoot).data.turns)[0];
  assert.equal(failedTurn.stage, 'after_capture');
  assert.equal(failedTurn.after, undefined);
  failAfter = false;
  const retried = service.observe(fixture.projectRoot, [contextEvent(), completedEvent()]);
  assert.equal(retried.data.completed, 1);
  const turn = Object.values(service.read(fixture.projectRoot).data.turns)[0];
  assert.equal(turn.facts.turnDiff.baseRef, 'tree-1');
  assert.equal(turn.facts.turnDiff.resultRef, 'tree-3');
});

test('retries fact derivation without recapturing the after state', () => {
  const fixture = createFixture();
  let captureCount = 0;
  let shouldFail = true;
  const service = createService(fixture, {
    captureState(context) {
      captureCount += 1;
      return fakeCapture(context, `tree-${captureCount}`);
    },
    deriveFacts(context, before, after) {
      if (shouldFail) throw new Error('temporary diff failure');
      return fakeFacts(context, before, after);
    },
  });

  service.observe(fixture.projectRoot, [contextEvent()]);
  const failed = service.observe(fixture.projectRoot, [contextEvent(), completedEvent()]);
  assert.equal(failed.data.error, 1);
  const failedTurn = Object.values(service.read(fixture.projectRoot).data.turns)[0];
  assert.equal(failedTurn.stage, 'derive');
  assert.equal(failedTurn.after.snapshot.git.treeHash, 'tree-2');
  assert.equal(captureCount, 2);

  shouldFail = false;
  const retried = service.observe(fixture.projectRoot, [contextEvent(), completedEvent()]);
  assert.equal(retried.data.completed, 1);
  assert.equal(captureCount, 2);
  const turn = Object.values(service.read(fixture.projectRoot).data.turns)[0];
  assert.equal(turn.facts.turnDiff.baseRef, 'tree-1');
  assert.equal(turn.facts.turnDiff.resultRef, 'tree-2');
});

test('does not confuse turns from different sessions', () => {
  const fixture = createFixture();
  const service = createService(fixture);
  service.observe(fixture.projectRoot, [contextEvent('session-a'), contextEvent('session-b')]);
  const stored = service.read(fixture.projectRoot).data;
  assert.equal(Object.keys(stored.turns).length, 2);
});

test('observes the same project facts from a canonical ObservationSession', () => {
  const fixture = createFixture();
  let captures = 0;
  const service = createService(fixture, {
    captureState(context) {
      return fakeCapture(context, `tree-${captures++}`);
    },
  });

  const running = observationSession(fixture.projectRoot, 'in_progress');
  assert.equal(service.observeSession(fixture.projectRoot, running).data.observing, 1);
  const completed = service.observeSession(
    fixture.projectRoot,
    observationSession(fixture.projectRoot, 'completed'),
  );
  assert.equal(completed.data.completed, 1);

  const turn = Object.values(service.read(fixture.projectRoot).data.turns)[0];
  assert.equal(turn.sessionId, 'canonical-session');
  assert.equal(turn.turnId, 'turn-0001');
  assert.equal(turn.facts.turnDiff.baseRef, 'tree-0');
  assert.equal(turn.facts.turnDiff.resultRef, 'tree-1');
});

test('treats a failed canonical turn as terminal for project observation', () => {
  const fixture = createFixture();
  let captures = 0;
  const service = createService(fixture, {
    captureState(context) {
      return fakeCapture(context, `tree-${captures++}`);
    },
  });

  service.observeSession(fixture.projectRoot, observationSession(fixture.projectRoot, 'in_progress'));
  const completed = service.observeSession(fixture.projectRoot, observationSession(fixture.projectRoot, 'failed'));

  assert.equal(completed.data.completed, 1);
});

test('reports an invalid canonical ObservationSession without throwing', () => {
  const fixture = createFixture();
  const result = createService(fixture).observeSession(fixture.projectRoot, { turns: [] });
  assert.equal(result.status, 'error');
  assert.match(result.error, /identity or turns/);
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-project-observation-'));
  const projectRoot = path.join(root, 'project');
  const userDataPath = path.join(root, 'user-data');
  fs.mkdirSync(projectRoot, { recursive: true });
  return { projectRoot, userDataPath };
}

function createService(fixture, overrides = {}) {
  let tick = 0;
  return createProjectObservationService({
    getUserDataPath: () => fixture.userDataPath,
    captureState: overrides.captureState ?? (context => fakeCapture(context, 'tree')),
    deriveFacts: overrides.deriveFacts ?? fakeFacts,
    now: () => new Date(`2026-08-18T08:00:${String(tick++).padStart(2, '0')}.000Z`),
  });
}

function contextEvent(sessionId = 'session-one') {
  return {
    sessionId,
    generationId: 'turn-one',
    cwd: 'D:/project',
    eventKind: 'context_ref',
    name: 'Turn context',
  };
}

function completedEvent(sessionId = 'session-one') {
  return {
    sessionId,
    generationId: 'turn-one',
    cwd: 'D:/project',
    eventKind: 'task_status',
    name: 'Task completed',
  };
}

function observationSession(cwd, status) {
  return {
    schemaVersion: '1.0-draft',
    session: { sessionId: 'canonical-session', cwd },
    turns: [{ turnId: 'turn-0001', cwd, status, events: [] }],
  };
}

function fakeCapture(context, treeHash) {
  return {
    repositoryRoot: context.cwd,
    profile: { version: 'profile-one' },
    snapshot: {
      projectId: context.projectId,
      sessionId: context.sessionId,
      snapshotId: `snapshot:${treeHash}`,
      git: { treeHash },
    },
  };
}

function fakeFacts(context, before, after) {
  return {
    turnDiff: {
      turnId: context.turnId,
      baseRef: before.snapshot.git.treeHash,
      resultRef: after.snapshot.git.treeHash,
    },
    environmentDelta: { changes: [] },
  };
}
