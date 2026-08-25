import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createReviewWorkflowService } from '../electron/review-workflow-service.mjs';

test('starts a review, publishes progress, resolves evidence and appends human review', async () => {
  const store = memoryStore();
  const changes = [];
  const workflow = createReviewWorkflowService({
    reviewObservation: observation(),
    projectObservation: { read: () => ready({ projectId: 'project-1' }) },
    getUserDataPath: () => 'C:\\review-artifacts',
    openDatabase: () => ({ close() {} }),
    createStore: () => store,
    createAdapter: () => ({ descriptor: { provider: 'test', model: 'test-model' } }),
    createExecutor: ({ store: target }) => ({
      async execute({ reviewCase }) {
        const result = completedResult(reviewCase.caseId);
        await target.recordRun(result);
        return result;
      },
    }),
    createId: () => 'fixed',
  });
  workflow.onChange(change => changes.push(change));

  const started = await workflow.start({ source: 'turns', projectRoot: 'C:\\project', sessionId: 'session-1', turnIds: ['turn-1'] });
  assert.equal(started.status, 'ready');
  await tick();

  const listed = await workflow.list('C:\\project');
  assert.equal(listed.status, 'ready');
  assert.equal(listed.data[0].runStatus, 'completed');
  assert.equal(listed.data[0].judgementCount, 1);

  const evidence = await workflow.resolveEvidence('C:\\project', 'case-1', 'evidence-1');
  assert.equal(evidence.status, 'ready');
  assert.equal(evidence.data.availability, 'available');
  assert.equal(evidence.data.location.kind, 'activity');

  const annotated = await workflow.appendAnnotation('C:\\project', {
    caseId: 'case-1', judgementId: 'judgement-1', verdict: 'correct', reason: 'Verified in the activity record.',
  });
  assert.equal(annotated.status, 'ready');
  assert.equal(annotated.data.annotations.length, 1);
  assert.deepEqual(changes.map(change => change.state), ['created', 'running', 'completed', 'annotated']);
});

function observation() {
  const evidencePackage = {
    schemaVersion: '1.0-draft', evidenceSchemaVersion: 'review-evidence-1', caseId: 'case-1', projectId: 'project-1', builtAt: '2026-08-24T00:00:00.000Z', reviewability: 'sufficient', gaps: [],
    turns: [{
      sessionId: 'session-1', turnId: 'turn-1', sequence: 0, status: 'completed', userInput: 'Review this change.', source: {},
      events: [{ eventId: 'event-1', content: 'Evidence content', rawRef: { sourceFile: 'session.jsonl', line: 1 } }],
    }],
  };
  const data = {
    reviewCase: { caseId: 'case-1', projectId: 'project-1', sourceType: 'manual_turn_selection', turns: [{ sessionId: 'session-1', turnId: 'turn-1' }], createdAt: '2026-08-24T00:00:00.000Z' },
    evidencePackage,
    selection: { projectRoot: 'C:\\project', sessionId: 'session-1', turnIds: ['turn-1'], sessionFile: 'C:\\sessions\\session.jsonl' },
  };
  return {
    prepareFromTurns: async () => ready(data),
    prepareFromTask: async () => ready(data),
  };
}

function completedResult(caseId) {
  return {
    run: {
      runId: 'run-1', caseId, invocation: { provider: 'test', model: 'test-model', promptVersion: 'review-prompt-1', reviewPolicyVersion: 'review-policy-1', evidenceSchemaVersion: 'review-evidence-1' },
      startedAt: '2026-08-24T00:00:00.000Z', completedAt: '2026-08-24T00:00:01.000Z', status: 'completed', latencyMs: 1_000,
    },
    judgements: [{ judgementId: 'judgement-1', runId: 'run-1', category: 'testability', title: 'Missing test', summary: 'A test is missing.', severity: 'medium', confidence: .8, impact: 'Regression risk.', alternativeExplanation: 'The test may exist elsewhere.', recommendation: 'Add coverage.', reviewability: 'sufficient', createdAt: '2026-08-24T00:00:01.000Z' }],
    evidence: [{ evidenceId: 'evidence-1', judgementId: 'judgement-1', evidenceType: 'event', targetType: 'event', targetId: 'event-1', description: 'The activity confirms the change.', cachedExcerpt: 'Evidence content', contentHash: hash('Evidence content') }],
  };
}

function memoryStore() {
  const records = new Map();
  return {
    async createCase(reviewCase) {
      records.set(reviewCase.caseId, { schemaVersion: '1.0-draft', reviewCase, runs: [], judgements: [], evidence: [], annotations: [] });
    },
    async recordRun(result) {
      const record = records.get(result.run.caseId);
      const index = record.runs.findIndex(run => run.runId === result.run.runId);
      if (index >= 0) record.runs[index] = result.run; else record.runs.push(result.run);
      record.judgements.push(...result.judgements);
      record.evidence.push(...result.evidence);
      return structuredClone(record);
    },
    async appendAnnotation(annotation) {
      const record = [...records.values()].find(value => value.judgements.some(item => item.judgementId === annotation.judgementId));
      record.annotations.push(annotation);
      return structuredClone(record);
    },
    async getCase(caseId) { return structuredClone(records.get(caseId)); },
    async listCases({ projectId } = {}) {
      return [...records.values()].map(record => record.reviewCase).filter(item => !projectId || item.projectId === projectId);
    },
  };
}

function ready(data) { return { status: 'ready', data, error: null }; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function tick() { return new Promise(resolve => setTimeout(resolve, 0)); }
