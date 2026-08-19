import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReviewEvidencePackage,
  validateReviewEvidencePackage,
} from '../dist/index.js';

test('builds ordered review evidence from canonical observations and project facts', () => {
  const reviewCase = selectedCase(['turn-2', 'turn-1']);
  const result = buildReviewEvidencePackage({
    reviewCase,
    sessions: [observationSession()],
    projectObservations: [projectObservation('turn-1'), projectObservation('turn-2')],
    builtAt: new Date('2026-08-19T04:00:00.000Z'),
  });

  assert.equal(result.reviewability, 'sufficient');
  assert.deepEqual(result.turns.map(turn => turn.turnId), ['turn-2', 'turn-1']);
  assert.equal(result.turns[0].userInput, 'second task');
  assert.equal(result.turns[0].events.length, 2);
  assert.equal(result.turns[0].projectContext.turnDiff.turnId, 'turn-2');
  assert.equal(result.turns[0].source.model, 'gpt-5.6-sol');
  assert.equal(validateReviewEvidencePackage(result).valid, true);
});

test('marks missing canonical turns as insufficient without fabricating evidence', () => {
  const result = buildReviewEvidencePackage({
    reviewCase: selectedCase(['turn-missing', 'turn-1']),
    sessions: [observationSession()],
    projectObservations: [projectObservation('turn-1')],
  });

  assert.equal(result.reviewability, 'insufficient');
  assert.deepEqual(result.turns.map(turn => turn.turnId), ['turn-1']);
  assert.deepEqual(result.gaps.map(item => item.code), ['missing_turn']);
});

test('keeps normalized events reviewable when project observation is unavailable', () => {
  const result = buildReviewEvidencePackage({
    reviewCase: selectedCase(['turn-1']),
    sessions: [observationSession()],
    projectObservations: [{
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'unavailable',
      unavailableReason: 'Listening started after the turn completed.',
    }],
  });

  assert.equal(result.reviewability, 'needs_project_context');
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].projectContext, undefined);
  assert.equal(result.gaps[0].description, 'Listening started after the turn completed.');
});

test('rejects duplicate selections and mismatched project observation identities', () => {
  assert.throws(() => buildReviewEvidencePackage({
    reviewCase: selectedCase(['turn-1', 'turn-1']),
    sessions: [observationSession()],
  }), /Duplicate review turn/);

  const mismatched = projectObservation('turn-1');
  mismatched.turnDiff.turnId = 'other-turn';
  assert.throws(() => buildReviewEvidencePackage({
    reviewCase: selectedCase(['turn-1']),
    sessions: [observationSession()],
    projectObservations: [mismatched],
  }), /identity does not match/);
});

test('does not expose mutable references to observation inputs', () => {
  const session = observationSession();
  const observation = projectObservation('turn-1');
  const result = buildReviewEvidencePackage({
    reviewCase: selectedCase(['turn-1']),
    sessions: [session],
    projectObservations: [observation],
  });

  result.turns[0].events[0].content = 'changed outside';
  result.turns[0].projectContext.projectProfile.technologyStack.push('Changed');
  assert.equal(session.turns[0].events[0].content, 'first task');
  assert.deepEqual(observation.projectProfile.technologyStack, ['Node.js']);
});

function selectedCase(turnIds) {
  return {
    caseId: 'case-evidence',
    projectId: 'project-1',
    sourceType: 'manual_turn_selection',
    turns: turnIds.map(turnId => ({ sessionId: 'session-1', turnId })),
    createdAt: '2026-08-19T03:59:00.000Z',
  };
}

function observationSession() {
  return {
    schemaVersion: '1.0-draft',
    session: {
      sessionId: 'session-1',
      projectId: 'project-1',
      sourceAgent: 'codex',
      sourceVersion: '0.148.0-alpha.15',
      adapterVersion: '0.1.0',
      model: 'gpt-5.6-sol',
      rawRef: rawRef(1, 'session_meta'),
    },
    turns: [turn('turn-1', 0, 'first task', 2), turn('turn-2', 1, 'second task', 4)],
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

function turn(turnId, sequence, userInput, line) {
  return {
    turnId,
    sequence,
    sourceRef: rawRef(line, 'turn_context'),
    status: 'completed',
    events: [
      event(`${turnId}-user`, turnId, 0, 'message', line, { actor: 'user', content: userInput }),
      event(`${turnId}-assistant`, turnId, 1, 'message', line + 1, { actor: 'assistant', content: 'done' }),
    ],
  };
}

function event(eventId, turnId, sequence, type, line, extra) {
  return {
    eventId,
    turnId,
    sequence,
    type,
    sourceAgent: 'codex',
    sourceVersion: '0.148.0-alpha.15',
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

function projectObservation(turnId) {
  return {
    sessionId: 'session-1',
    turnId,
    status: 'available',
    turnDiff: {
      diffId: `diff-${turnId}`,
      projectId: 'project-1',
      sessionId: 'session-1',
      turnId,
      builderVersion: '0.1.0',
      baseRef: 'base',
      resultRef: 'result',
      filesChanged: [],
      unifiedDiff: '',
      generatedAt: '2026-08-19T04:00:00.000Z',
      contentHash: `hash-${turnId}`,
      isCurrent: true,
    },
    projectProfile: {
      profileId: 'profile-1',
      projectId: 'project-1',
      version: 'profile-v1',
      generatedAt: '2026-08-19T03:50:00.000Z',
      technologyStack: ['Node.js'],
      packageManagers: ['pnpm'],
      keyDependencies: [],
      commands: ['test=node --test'],
      ruleFiles: [],
      skillFiles: [],
      mcpFiles: [],
      sourceFiles: ['package.json'],
      fingerprints: { configuration: 'a', rules: 'b', skills: 'c', mcp: 'd' },
    },
    environmentSnapshot: {
      snapshotId: `snapshot-${turnId}`,
      projectId: 'project-1',
      sessionId: 'session-1',
      generatorVersion: '0.1.0',
      capturedAt: '2026-08-19T04:00:00.000Z',
      projectProfileVersion: 'profile-v1',
      git: { branch: 'main', treeHash: 'result', dirty: true },
      runtime: { os: 'win32', arch: 'x64', nodeVersion: '22.0.0' },
    },
    environmentDelta: null,
  };
}
