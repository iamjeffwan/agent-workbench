import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInMemoryReviewStore,
  validateReviewCaseRecord,
} from '../dist/index.js';

test('creates an empty review case with a valid published contract', async () => {
  const store = createInMemoryReviewStore();
  const record = await store.createCase(reviewCase());

  assert.deepEqual(record.runs, []);
  assert.equal(validateReviewCaseRecord(record).valid, true);
  record.reviewCase.projectId = 'mutated-outside';
  assert.equal((await store.getCase('case-1')).reviewCase.projectId, 'project-1');
});

test('appends evidence-backed runs and preserves re-review history', async () => {
  const store = createInMemoryReviewStore();
  await store.createCase(reviewCase());
  await store.recordRun(completedResult('run-1', 'gpt-5.6-sol', 'judgement-1', 'evidence-1'));
  const record = await store.recordRun(completedResult('run-2', 'future-review-model', 'judgement-2', 'evidence-2'));

  assert.deepEqual(record.runs.map(run => run.runId), ['run-1', 'run-2']);
  assert.deepEqual(record.runs.map(run => run.invocation.model), ['gpt-5.6-sol', 'future-review-model']);
  assert.equal(record.judgements.length, 2);
  assert.equal(record.evidence.length, 2);
});

test('rejects judgements without evidence or a completed run', async () => {
  const store = createInMemoryReviewStore();
  await store.createCase(reviewCase());
  const missingEvidence = completedResult('run-1', 'gpt-5.6-sol', 'judgement-1', 'evidence-1');
  missingEvidence.evidence = [];
  await assert.rejects(store.recordRun(missingEvidence), /must have at least one evidence item/);

  const running = completedResult('run-2', 'gpt-5.6-sol', 'judgement-2', 'evidence-2');
  running.run.status = 'running';
  delete running.run.completedAt;
  await assert.rejects(store.recordRun(running), /must reference a completed run/);
});

test('keeps runs immutable and human annotations append-only', async () => {
  const store = createInMemoryReviewStore();
  await store.createCase(reviewCase());
  const result = completedResult('run-1', 'gpt-5.6-sol', 'judgement-1', 'evidence-1');
  await store.recordRun(result);

  await assert.rejects(store.recordRun(result), /Review run is already terminal/);
  const first = await store.appendAnnotation(annotation('annotation-1'));
  const second = await store.appendAnnotation(annotation('annotation-2'));
  assert.deepEqual(second.annotations.map(item => item.annotationId), ['annotation-1', 'annotation-2']);
  assert.equal(first.annotations.length, 1);
  await assert.rejects(store.appendAnnotation(annotation('annotation-2')), /Human annotation already exists/);
});

test('allows an active run to advance once and keeps its identity stable', async () => {
  const store = createInMemoryReviewStore();
  await store.createCase(reviewCase());
  const completed = completedResult('run-1', 'gpt-5.6-sol', 'judgement-1', 'evidence-1');
  const running = {
    run: { ...completed.run, status: 'running' },
    judgements: [],
    evidence: [],
  };
  delete running.run.completedAt;
  delete running.run.usage;
  delete running.run.latencyMs;
  await store.recordRun(running);
  const record = await store.recordRun(completed);

  assert.equal(record.runs.length, 1);
  assert.equal(record.runs[0].status, 'completed');
  await assert.rejects(store.recordRun(completed), /already terminal/);
});

test('reports structural and relationship errors with stable paths', () => {
  const record = {
    schemaVersion: '1.0-draft',
    reviewCase: { ...reviewCase(), turns: [] },
    runs: [{
      ...completedResult('run-1', 'gpt-5.6-sol', 'judgement-1', 'evidence-1').run,
      caseId: 'other-case',
    }],
    judgements: [],
    evidence: [],
    annotations: [],
    unexpected: true,
  };
  const result = validateReviewCaseRecord(record);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path === '$.reviewCase.turns'));
  assert.ok(result.errors.some(error => error.path === '$.unexpected'));
});

function reviewCase() {
  return {
    caseId: 'case-1',
    projectId: 'project-1',
    sourceType: 'manual_turn_selection',
    turns: [{ sessionId: 'session-1', turnId: 'turn-1' }],
    createdAt: '2026-08-19T03:00:00.000Z',
  };
}

function completedResult(runId, model, judgementId, evidenceId) {
  return {
    run: {
      runId,
      caseId: 'case-1',
      invocation: {
        provider: 'test-provider',
        model,
        promptVersion: 'review-prompt-1',
        reviewPolicyVersion: 'review-policy-1',
        evidenceSchemaVersion: 'review-evidence-1',
      },
      startedAt: '2026-08-19T03:01:00.000Z',
      completedAt: '2026-08-19T03:01:02.000Z',
      status: 'completed',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      latencyMs: 2000,
    },
    judgements: [{
      judgementId,
      runId,
      category: 'testability',
      title: 'Missing failure-path test',
      summary: 'The failure path is not covered.',
      severity: 'medium',
      confidence: 0.9,
      impact: 'A regression could be missed.',
      alternativeExplanation: 'The path may be covered by an external suite.',
      recommendation: 'Add a focused failure-path test.',
      reviewability: 'sufficient',
      createdAt: '2026-08-19T03:01:02.000Z',
    }],
    evidence: [{
      evidenceId,
      judgementId,
      evidenceType: 'missing_test',
      targetType: 'turn_diff',
      targetId: 'diff-1',
      description: 'The diff changes error handling without a matching test.',
    }],
  };
}

function annotation(annotationId) {
  return {
    annotationId,
    judgementId: 'judgement-1',
    annotatorId: 'user-1',
    verdict: 'correct',
    reason: 'Confirmed after reading the changed test suite.',
    createdAt: '2026-08-19T03:02:00.000Z',
  };
}
