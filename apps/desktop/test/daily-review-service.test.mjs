import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createInMemoryReviewStore } from '@agent-workbench/review';
import { createDailyReviewService } from '../electron/daily-review-service.mjs';

test('collects terminal turns for the local day, keeps failed and aborted turns, and splits after eight turns', async () => {
  const fixture = createFixture(Array.from({ length: 10 }, (_, index) => ({
    id: `turn-${index + 1}`,
    status: index === 8 ? 'failed' : index === 9 ? 'aborted' : 'completed',
    updatedAt: `2026-08-25T0${Math.floor(index / 6)}:${String(index + 1).padStart(2, '0')}:00.000Z`,
  })).concat([{ id: 'running', status: 'running', updatedAt: '2026-08-25T08:00:00.000Z' }]));
  const harness = serviceHarness(fixture);

  const result = await harness.service.run(fixture.projectRoot, { localDate: '2026-08-25', timeZone: 'UTC' });

  assert.equal(result.status, 'ready', result.error);
  assert.equal(result.data.chunks.length, 2);
  assert.deepEqual(result.data.chunks.map(chunk => chunk.turns.length), [8, 2]);
  assert.equal(result.data.chunks.flatMap(chunk => chunk.turns).some(turn => turn.turnId === 'running'), false);
  assert.equal(result.data.batch.status, 'completed');
});

test('uses saved task records first and keeps all remaining turns in session order without semantic grouping', async () => {
  const fixture = createFixture([
    turn('turn-1', 'completed', '2026-08-25T01:00:00.000Z'),
    turn('turn-2', 'completed', '2026-08-25T01:01:00.000Z'),
    turn('turn-3', 'completed', '2026-08-25T01:02:00.000Z'),
  ]);
  const harness = serviceHarness(fixture, {
    tasks: [{ id: 'task-explicit', sessionId: fixture.sessionId, turnIds: ['turn-2', 'turn-1'], createdAt: '2026-08-25T02:00:00.000Z' }],
  });

  const result = await harness.service.run(fixture.projectRoot, { localDate: '2026-08-25', timeZone: 'UTC' });

  assert.equal(result.status, 'ready', result.error);
  assert.deepEqual(result.data.chunks.map(chunk => chunk.groupKey), ['task:task-explicit', `session:${fixture.sessionId}`]);
  assert.deepEqual(result.data.chunks[0].turns.map(turn => turn.turnId), ['turn-2', 'turn-1']);
  assert.deepEqual(result.data.chunks[1].turns.map(turn => turn.turnId), ['turn-3']);
});

test('uses 120,000 characters as a split threshold while preserving an oversized single turn intact', async () => {
  const fixture = createFixture([
    { ...turn('large-turn', 'completed', '2026-08-25T01:00:00.000Z'), assistantMessages: Array.from({ length: 31 }, () => 'x'.repeat(5_000)) },
    turn('next-turn', 'completed', '2026-08-25T01:01:00.000Z'),
  ]);
  const harness = serviceHarness(fixture);

  const result = await harness.service.run(fixture.projectRoot, { localDate: '2026-08-25', timeZone: 'UTC' });

  assert.equal(result.status, 'ready', result.error);
  assert.equal(result.data.chunks.length, 2);
  assert.equal(result.data.chunks[0].turns[0].turnId, 'large-turn');
  assert.ok(result.data.chunks[0].characterCount > 120_000);
  assert.equal(result.data.chunks[1].turns[0].turnId, 'next-turn');
});

test('reuses a compatible completed active review without executing the chunk again', async () => {
  const fixture = createFixture([
    turn('turn-1', 'completed', '2026-08-25T01:00:00.000Z'),
    turn('turn-2', 'completed', '2026-08-25T01:01:00.000Z'),
  ]);
  const store = createInMemoryReviewStore();
  await store.createCase({
    caseId: 'active-case', projectId: 'project-1', sourceType: 'manual_turn_selection',
    turns: fixture.turns.map(item => ({ sessionId: fixture.sessionId, turnId: item.id })), createdAt: '2026-08-25T00:00:00.000Z',
  });
  await store.recordRun(completedResult('active-case', 'active-run'));
  const harness = serviceHarness(fixture, { store });

  const result = await harness.service.run(fixture.projectRoot, { localDate: '2026-08-25', timeZone: 'UTC' });

  assert.equal(result.status, 'ready', result.error);
  assert.equal(harness.executorCalls(), 0);
  assert.equal(result.data.chunks[0].reviewCaseId, 'active-case');
  assert.equal(result.data.chunks[0].reusedRunId, 'active-run');
});

test('retries only failed chunks and delays synthesis until all chunks complete', async () => {
  const fixture = createFixture([turn('turn-1', 'completed', '2026-08-25T01:00:00.000Z')]);
  let failedOnce = true;
  const harness = serviceHarness(fixture, {
    execute: async ({ store, reviewCase }) => {
      if (failedOnce) {
        failedOnce = false;
        const failed = failedResult(reviewCase.caseId, 'first failure');
        await store.recordRun(failed);
        return failed;
      }
      const completed = completedResult(reviewCase.caseId, `retry-run-${harness.executorCalls()}`);
      await store.recordRun(completed);
      return completed;
    },
  });

  const first = await harness.service.run(fixture.projectRoot, { localDate: '2026-08-25', timeZone: 'UTC' });
  assert.equal(first.data.batch.status, 'failed');
  assert.equal(harness.synthesisCalls(), 0);
  const second = await harness.service.run(fixture.projectRoot, { localDate: '2026-08-25', timeZone: 'UTC' });

  assert.equal(second.status, 'ready', second.error);
  assert.equal(second.data.batch.status, 'completed');
  assert.equal(harness.executorCalls(), 2);
  assert.equal(harness.synthesisCalls(), 1);
});

test('rejects a synthesis issue that cites a judgement outside the completed chunks', async () => {
  const fixture = createFixture([turn('turn-1', 'completed', '2026-08-25T01:00:00.000Z')]);
  const harness = serviceHarness(fixture, {
    synthesis: () => ({
      issues: [{
        issueFingerprint: 'testability:missing-test', category: 'testability', title: 'Missing test',
        summary: 'A test is missing.', severity: 'medium', impact: 'Regression risk.',
        recommendation: 'Add a test.', sourceJudgementIds: ['not-a-source'],
      }],
    }),
  });

  const result = await harness.service.run(fixture.projectRoot, { localDate: '2026-08-25', timeZone: 'UTC' });

  assert.equal(result.status, 'ready', result.error);
  assert.equal(result.data.batch.status, 'partial');
  assert.equal(result.data.batch.synthesis.status, 'failed');
  assert.equal(result.data.issues.length, 0);
});

test('returns the completed batch unchanged and completes an empty day without a model call', async () => {
  const fixture = createFixture([turn('old-turn', 'completed', '2026-08-24T23:59:00.000Z')]);
  const harness = serviceHarness(fixture);

  const empty = await harness.service.run(fixture.projectRoot, { localDate: '2026-08-25', timeZone: 'UTC' });
  assert.equal(empty.data.batch.status, 'completed');
  assert.equal(empty.data.chunks.length, 0);
  assert.equal(harness.executorCalls(), 0);
  const repeated = await harness.service.run(fixture.projectRoot, { localDate: '2026-08-25', timeZone: 'UTC' });
  assert.equal(repeated.data.batch.batchId, empty.data.batch.batchId);
  assert.equal(harness.executorCalls(), 0);
});

function serviceHarness(fixture, options = {}) {
  const store = options.store ?? createInMemoryReviewStore();
  let executorCount = 0;
  let synthesisCount = 0;
  const createExecutor = ({ store: target }) => ({
    async execute(input) {
      executorCount += 1;
      if (options.execute) return options.execute({ store: target, reviewCase: input.reviewCase });
      const result = completedResult(input.reviewCase.caseId, `run-${executorCount}`);
      await target.recordRun(result);
      return result;
    },
  });
  const createAdapter = () => ({
    descriptor: { provider: 'test', model: 'test-review-model', transport: 'test' },
    async review(request) {
      synthesisCount += 1;
      const judgements = request.evidencePackage.dailySynthesis.judgements;
      return { output: options.synthesis?.(judgements) ?? defaultSynthesis(judgements) };
    },
  });
  const service = createDailyReviewService({
    getStore: async () => store,
    getUserDataPath: () => fixture.root,
    projectObservation: { read: () => ready({ projectId: 'project-1', turns: {} }) },
    sessionHistory: {
      listSessions: () => ready([{ id: fixture.sessionId }]),
      readSession: () => ready({ turns: fixture.turns }),
      resolveSessionFiles: () => ready({ sessionFiles: [fixture.sessionFile] }),
    },
    taskLibrary: { listTasks: () => ready(options.tasks ?? []) },
    createAdapter,
    createExecutor,
    enrichEvidence: async ({ evidencePackage }) => evidencePackage,
    now: () => new Date('2026-08-25T12:00:00.000Z'),
    createId: sequenceId(),
  });
  return { service, executorCalls: () => executorCount, synthesisCalls: () => synthesisCount };
}

function createFixture(turns) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-review-service-'));
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot);
  const sessionId = 'session-1';
  const sessionFile = path.join(root, 'session.jsonl');
  const lines = [{ type: 'session_meta', timestamp: '2026-08-25T00:00:00.000Z', payload: { id: sessionId, cwd: projectRoot, cli_version: '0.1.0' } }];
  turns.forEach((item, index) => {
    lines.push({ type: 'turn_context', timestamp: item.updatedAt, payload: { turn_id: item.id, cwd: projectRoot } });
    lines.push({ type: 'response_item', timestamp: item.updatedAt, payload: { type: 'message', role: 'user', content: `Request ${item.id}`, internal_chat_message_metadata_passthrough: { turn_id: item.id } } });
    for (const content of item.assistantMessages ?? []) {
      lines.push({ type: 'response_item', timestamp: item.updatedAt, payload: { type: 'message', role: 'assistant', content, internal_chat_message_metadata_passthrough: { turn_id: item.id } } });
    }
    if (item.status === 'aborted') {
      lines.push({ type: 'event_msg', timestamp: item.updatedAt, payload: { type: 'turn_aborted', turn_id: item.id } });
    } else if (item.status !== 'running') {
      lines.push({ type: 'event_msg', timestamp: item.updatedAt, payload: { type: 'task_complete', turn_id: item.id, ...(item.status === 'failed' ? { error: 'failed' } : {}) } });
    }
  });
  fs.writeFileSync(sessionFile, `${lines.map(JSON.stringify).join('\n')}\n`, 'utf8');
  return { root, projectRoot, sessionFile, sessionId, turns };
}

function completedResult(caseId, runId) {
  const judgementId = `judgement-${runId}`;
  return {
    run: {
      runId, caseId,
      invocation: { provider: 'test', model: 'test-review-model', promptVersion: 'review-prompt-1', reviewPolicyVersion: 'review-policy-1', evidenceSchemaVersion: 'review-evidence-1' },
      startedAt: '2026-08-25T12:00:00.000Z', completedAt: '2026-08-25T12:00:01.000Z', status: 'completed', latencyMs: 1,
    },
    judgements: [{
      judgementId, runId, category: 'testability', title: 'Missing test', summary: 'A test is missing.', severity: 'medium', confidence: .8,
      impact: 'Regression risk.', alternativeExplanation: 'The test may exist elsewhere.', recommendation: 'Add a test.',
      reviewability: 'sufficient', issueFingerprint: 'testability:missing-test', createdAt: '2026-08-25T12:00:01.000Z',
    }],
    evidence: [{
      evidenceId: `evidence-${runId}`, judgementId, evidenceType: 'event', targetType: 'event', targetId: 'event-1',
      description: 'Observed user request.', cachedExcerpt: 'Request', contentHash: 'hash',
    }],
  };
}

function failedResult(caseId, reason) {
  return {
    run: {
      runId: `failed-${caseId}`, caseId,
      invocation: { provider: 'test', model: 'test-review-model', promptVersion: 'review-prompt-1', reviewPolicyVersion: 'review-policy-1', evidenceSchemaVersion: 'review-evidence-1' },
      startedAt: '2026-08-25T12:00:00.000Z', completedAt: '2026-08-25T12:00:01.000Z', status: 'failed', failureReason: reason, latencyMs: 1,
    }, judgements: [], evidence: [],
  };
}

function defaultSynthesis(judgements) {
  if (judgements.length === 0) return { issues: [] };
  return {
    issues: [{
      issueFingerprint: 'testability:missing-test', category: 'testability', title: 'Missing test', summary: 'A test is missing.',
      severity: 'medium', impact: 'Regression risk.', recommendation: 'Add a test.',
      sourceJudgementIds: [judgements[0].judgementId],
    }],
  };
}

function turn(id, status, updatedAt) { return { id, status, updatedAt }; }
function ready(data) { return { status: 'ready', data, error: null }; }
function sequenceId() { let index = 0; return () => `id-${++index}`; }
