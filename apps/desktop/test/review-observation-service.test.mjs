import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createReviewObservationService } from '../electron/review-observation-service.mjs';

test('prepares a complete review case, evidence package, and project context from selected turns', async () => {
  const fixture = createFixture();
  const service = createService(fixture);

  const result = await service.prepareFromTurns({
    projectRoot: fixture.projectRoot,
    sessionId: 'session-1',
    turnIds: ['turn-1'],
  });

  assert.equal(result.status, 'ready', result.error);
  assert.equal(result.data.reviewCase.sourceType, 'manual_turn_selection');
  assert.deepEqual(result.data.reviewCase.turns, [{ sessionId: 'session-1', turnId: 'turn-1' }]);
  assert.equal(result.data.evidencePackage.reviewability, 'sufficient');
  assert.equal(result.data.evidencePackage.turns[0].userInput, 'Add the parser and test it.');
  assert.equal(result.data.evidencePackage.turns[0].projectContext.turnDiff.diffId, 'diff-1');
  assert.equal(result.data.evidencePackage.projectContext.scope, 'working_tree');
  assert.deepEqual(
    result.data.evidencePackage.projectContext.files.map(file => file.path),
    ['src/parser.mjs'],
  );
  assert.match(result.data.evidencePackage.projectContext.diff.content, /src\/parser\.mjs/);
});

test('prepares a task review from the task’s saved turn selection', async () => {
  const fixture = createFixture();
  const service = createService(fixture, {
    readTask: taskId => ({
      status: 'ready',
      data: {
        id: taskId,
        projectRoot: fixture.projectRoot,
        sessionId: 'session-1',
        turnIds: ['turn-1'],
      },
    }),
  });

  const result = await service.prepareFromTask('task-123');

  assert.equal(result.status, 'ready', result.error);
  assert.equal(result.data.reviewCase.sourceType, 'task');
  assert.equal(result.data.reviewCase.sourceTaskId, 'task-123');
  assert.deepEqual(result.data.selection.turnIds, ['turn-1']);
});

test('keeps the missing historical project observation explicit', async () => {
  const fixture = createFixture();
  const service = createService(fixture, {
    readProjectObservation: () => ({
      status: 'ready',
      data: { projectId: 'project-1', turns: {} },
      error: null,
    }),
  });

  const result = await service.prepareFromTurns({
    projectRoot: fixture.projectRoot,
    sessionId: 'session-1',
    turnIds: ['turn-1'],
  });

  assert.equal(result.status, 'ready', result.error);
  assert.equal(result.data.evidencePackage.reviewability, 'sufficient');
  assert.equal(result.data.evidencePackage.gaps[0].code, 'project_observation_unavailable');
  assert.match(result.data.evidencePackage.gaps[0].description, /No persisted project observation/);
  assert.equal(result.data.evidencePackage.projectContext.files[0].roles.includes('changed'), true);
});

function createService(fixture, overrides = {}) {
  return createReviewObservationService({
    resolveSessionFiles: () => ({
      status: 'ready',
      data: { sessionFiles: [fixture.sessionFile] },
      error: null,
    }),
    adaptSession: () => observationSession(),
    readTask: overrides.readTask,
    readProjectObservation: overrides.readProjectObservation ?? (() => ({
      status: 'ready',
      data: {
        projectId: 'project-1',
        turns: {
          ['session-1\0turn-1']: completedObservation(),
        },
      },
      error: null,
    })),
    now: () => new Date('2026-08-20T10:00:00.000Z'),
    createId: () => 'test-case',
  });
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-observation-service-'));
  const projectRoot = path.join(root, 'project');
  const source = path.join(projectRoot, 'src', 'parser.mjs');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'export function parse(value) { return value; }\n', 'utf8');
  git(projectRoot, ['init']);
  git(projectRoot, ['config', 'user.email', 'review@example.invalid']);
  git(projectRoot, ['config', 'user.name', 'Review test']);
  git(projectRoot, ['add', '.']);
  git(projectRoot, ['commit', '-m', 'Initial parser']);
  fs.writeFileSync(source, 'export function parse(value) { return value.trim(); }\n', 'utf8');
  return { projectRoot, sessionFile: path.join(root, 'session.jsonl') };
}

function observationSession() {
  return {
    schemaVersion: '1.0-draft',
    session: {
      sessionId: 'session-1',
      projectId: 'project-1',
      sourceAgent: 'codex',
      sourceVersion: '0.148.0',
      adapterVersion: '0.1.0',
      rawRef: rawRef(1, 'session_meta'),
    },
    turns: [{
      turnId: 'turn-1',
      sequence: 0,
      status: 'completed',
      sourceRef: rawRef(2, 'turn_context'),
      events: [
        event('event-user', 'turn-1', 0, 'message', 3, { actor: 'user', content: 'Add the parser and test it.' }),
        event('event-assistant', 'turn-1', 1, 'message', 4, { actor: 'assistant', content: 'Implemented.' }),
      ],
    }],
    capabilityManifest: {
      agent: 'codex',
      capabilities: Object.fromEntries([
        'user_message', 'agent_message', 'tool_call', 'tool_result', 'file_diff',
        'token_usage', 'reasoning_summary', 'approval_events', 'subagent_events',
        'inter_agent_messages',
      ].map(name => [name, 'full'])),
    },
    diagnostics: {
      unknownSourceEventCount: 0,
      parseErrorCount: 0,
      lossyEventCount: 0,
      unsupportedFieldCount: 0,
      entries: [],
    },
  };
}

function completedObservation() {
  return {
    status: 'completed',
    facts: {
      turnDiff: {
        diffId: 'diff-1',
        projectId: 'project-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        builderVersion: '0.1.0',
        baseRef: 'base',
        resultRef: 'result',
        filesChanged: [{ path: 'src/parser.mjs', status: 'modified' }],
        unifiedDiff: [
          'diff --git a/src/parser.mjs b/src/parser.mjs',
          '--- a/src/parser.mjs',
          '+++ b/src/parser.mjs',
          '@@ -1 +1 @@',
          '-export function parse(value) { return value; }',
          '+export function parse(value) { return value.trim(); }',
          '',
        ].join('\n'),
        generatedAt: '2026-08-20T10:00:00.000Z',
        contentHash: 'hash-1',
        isCurrent: true,
      },
      environmentDelta: {
        deltaId: 'delta-1',
        projectId: 'project-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        generatorVersion: '0.1.0',
        beforeSnapshotId: 'snapshot-base',
        afterSnapshotId: 'snapshot-result',
        generatedAt: '2026-08-20T10:00:00.000Z',
        changes: [],
      },
    },
    after: {
      profile: {
        profileId: 'profile-1',
        projectId: 'project-1',
        version: 'profile-v1',
        generatedAt: '2026-08-20T10:00:00.000Z',
        technologyStack: ['Node.js'],
        packageManagers: [],
        keyDependencies: [],
        commands: [],
        ruleFiles: [],
        skillFiles: [],
        mcpFiles: [],
        sourceFiles: ['src/parser.mjs'],
        fingerprints: { configuration: 'a', rules: 'b', skills: 'c', mcp: 'd' },
      },
      snapshot: {
        snapshotId: 'snapshot-result',
        projectId: 'project-1',
        sessionId: 'session-1',
        generatorVersion: '0.1.0',
        capturedAt: '2026-08-20T10:00:00.000Z',
        projectProfileVersion: 'profile-v1',
        git: { treeHash: 'result', dirty: true },
        runtime: { os: 'win32', arch: 'x64', nodeVersion: '24.0.0' },
      },
    },
  };
}

function event(eventId, turnId, sequence, type, line, extra) {
  return {
    eventId,
    turnId,
    sequence,
    type,
    sourceAgent: 'codex',
    sourceVersion: '0.148.0',
    sourceEventType: `event_msg/${type}`,
    adapterVersion: '0.1.0',
    provenance: 'direct',
    fidelity: 'full',
    rawRef: rawRef(line, type),
    ...extra,
  };
}

function rawRef(line, sourceType) {
  return { sourceFile: 'session.jsonl', line, sourceType };
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}
