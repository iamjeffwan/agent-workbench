import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openLocalDatabase } from '@agent-workbench/local-database';
import {
  createInMemoryReviewStore,
  createSqliteReviewStore,
  validateReviewCaseRecord,
} from '../dist/index.js';

const adapters = [
  {
    name: 'in-memory store',
    create() {
      return { store: createInMemoryReviewStore(), close() {} };
    },
  },
  {
    name: 'SQLite store',
    create() {
      const database = openLocalDatabase({ filePath: ':memory:' });
      return { store: createSqliteReviewStore({ database }), close: () => database.close() };
    },
  },
];

for (const adapter of adapters) {
  test(`${adapter.name} satisfies the review storage contract`, async () => {
    const context = adapter.create();
    try {
      await context.store.createCase(reviewCase('case-1'));
      await context.store.recordRun(runningResult());
      const saved = await context.store.recordRun(completedResult());
      await context.store.appendAnnotation(annotation());

      assert.equal(validateReviewCaseRecord(saved).valid, true);
      assert.deepEqual((await context.store.listCases()).map(item => item.caseId), ['case-1']);
      const record = await context.store.getCase('case-1');
      assert.equal(record.runs[0].status, 'completed');
      assert.equal(record.judgements.length, 1);
      assert.equal(record.evidence.length, 1);
      assert.equal(record.annotations.length, 1);
      assert.equal(record.runs[0].artifacts[0].kind, 'model_output');
    } finally {
      context.close();
    }
  });

  test(`${adapter.name} rejects invalid terminal writes without changing the active run`, async () => {
    const context = adapter.create();
    try {
      await context.store.createCase(reviewCase('case-1'));
      await context.store.recordRun(runningResult());
      const invalid = completedResult();
      invalid.evidence = [];
      await assert.rejects(context.store.recordRun(invalid), /must have at least one evidence item/);
      assert.equal((await context.store.getCase('case-1')).runs[0].status, 'running');
    } finally {
      context.close();
    }
  });
}

test('SQLite review records survive process-style close and reopen', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-sqlite-store-'));
  const file = path.join(root, 'review.db');
  const firstDatabase = openLocalDatabase({ filePath: file });
  const firstStore = createSqliteReviewStore({ database: firstDatabase });
  await firstStore.createCase(reviewCase('case-persisted'));
  await firstStore.recordRun(completedResult('case-persisted'));
  firstDatabase.close();

  const secondDatabase = openLocalDatabase({ filePath: file });
  const secondStore = createSqliteReviewStore({ database: secondDatabase });
  const restored = await secondStore.getCase('case-persisted');
  assert.equal(restored.reviewCase.caseId, 'case-persisted');
  assert.equal(restored.runs[0].status, 'completed');
  assert.equal(secondDatabase.integrityCheck().ok, true);
  secondDatabase.close();
});

for (const adapter of adapters) {
  test(`${adapter.name} persists daily batches, chunks, issues, and source judgements`, async () => {
    const context = adapter.create();
    try {
      await context.store.createCase(reviewCase('daily-case'));
      await context.store.recordRun(completedResult('daily-case'));
      const batch = dailyBatch();
      const chunk = dailyChunk();
      await context.store.createDailyBatch(batch, [chunk]);
      await context.store.updateDailyChunk({
        ...chunk,
        status: 'completed',
        reviewCaseId: 'daily-case',
        completedAt: '2026-08-25T10:01:00.000Z',
      });
      await context.store.updateDailyBatch({
        ...batch,
        status: 'completed',
        updatedAt: '2026-08-25T10:02:00.000Z',
        completedAt: '2026-08-25T10:02:00.000Z',
        synthesis: { status: 'completed', completedAt: '2026-08-25T10:02:00.000Z' },
      });
      const saved = await context.store.replaceDailyIssues('daily-batch-1', [{
        issueId: 'daily-issue-1', batchId: 'daily-batch-1', issueFingerprint: 'testability:failure-path',
        category: 'testability', title: 'Missing failure test', summary: 'The failure path is not covered.',
        severity: 'medium', impact: 'Regression risk.', recommendation: 'Add a focused test.',
        sourceJudgementIds: ['judgement-daily-case'], createdAt: '2026-08-25T10:02:00.000Z',
      }]);
      assert.equal(saved.batch.status, 'completed');
      assert.equal(saved.chunks[0].reviewCaseId, 'daily-case');
      assert.deepEqual(saved.issues[0].sourceJudgementIds, ['judgement-daily-case']);
      assert.equal((await context.store.findDailyBatch('project-1', '2026-08-25')).batch.batchId, 'daily-batch-1');
    } finally {
      context.close();
    }
  });
}

function reviewCase(caseId) {
  return {
    caseId,
    projectId: 'project-1',
    sourceType: 'manual_turn_selection',
    turns: [{ sessionId: 'session-1', turnId: 'turn-1' }],
    createdAt: '2026-08-21T04:00:00.000Z',
  };
}

function runningResult(caseId = 'case-1') {
  const completed = completedResult(caseId);
  const run = { ...completed.run, status: 'running' };
  delete run.completedAt;
  delete run.latencyMs;
  delete run.artifacts;
  return {
    run,
    judgements: [],
    evidence: [],
  };
}

function completedResult(caseId = 'case-1') {
  return {
    run: {
      runId: `run-${caseId}`,
      caseId,
      invocation: {
        provider: 'test-provider',
        model: 'test-model',
        promptVersion: 'review-prompt-1',
        reviewPolicyVersion: 'review-policy-1',
        evidenceSchemaVersion: 'review-evidence-1',
      },
      startedAt: '2026-08-21T04:01:00.000Z',
      completedAt: '2026-08-21T04:01:02.000Z',
      status: 'completed',
      usage: { totalTokens: 12 },
      latencyMs: 2000,
      artifacts: [{
        kind: 'model_output',
        path: 'C:\\review-artifacts\\last-message.json',
        contentHash: 'abc123',
        byteLength: 42,
      }],
    },
    judgements: [{
      judgementId: `judgement-${caseId}`,
      runId: `run-${caseId}`,
      category: 'testability',
      title: 'Missing failure-path test',
      summary: 'The failure path is not covered.',
      severity: 'medium',
      confidence: 0.9,
      impact: 'A regression could be missed.',
      alternativeExplanation: 'An external suite may cover the path.',
      recommendation: 'Add a focused test.',
      reviewability: 'sufficient',
      issueFingerprint: 'testability:failure-path',
      createdAt: '2026-08-21T04:01:02.000Z',
    }],
    evidence: [{
      evidenceId: `evidence-${caseId}`,
      judgementId: `judgement-${caseId}`,
      evidenceType: 'missing_test',
      targetType: 'event',
      targetId: 'event-1',
      description: 'No failure-path test was observed.',
      cachedExcerpt: 'sanitized excerpt',
      contentHash: 'evidence-hash',
    }],
  };
}

function annotation() {
  return {
    annotationId: 'annotation-1',
    judgementId: 'judgement-case-1',
    annotatorId: 'local-user',
    verdict: 'correct',
    reason: 'Confirmed from the evidence.',
    createdAt: '2026-08-21T04:02:00.000Z',
  };
}

function dailyBatch() {
  return {
    batchId: 'daily-batch-1', projectId: 'project-1', localDate: '2026-08-25', timeZone: 'Asia/Shanghai',
    status: 'queued', createdAt: '2026-08-25T10:00:00.000Z', updatedAt: '2026-08-25T10:00:00.000Z',
    synthesis: { status: 'queued' },
  };
}

function dailyChunk() {
  return {
    chunkId: 'daily-chunk-1', batchId: 'daily-batch-1', sequence: 0, groupKey: 'session:session-1',
    turns: [{ sessionId: 'session-1', turnId: 'turn-1' }], characterCount: 42, status: 'queued',
  };
}
