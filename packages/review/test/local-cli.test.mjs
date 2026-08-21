import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { openLocalDatabase } from '@agent-workbench/local-database';
import { createSqliteReviewStore } from '../dist/index.js';

const executeFile = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const commandScript = path.join(repositoryRoot, 'scripts', 'manage-review-local.mjs');

test('local review commands query, annotate, export, back up, and inspect the database', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-local-cli-'));
  const databasePath = path.join(root, 'agent-workbench.db');
  const exportPath = path.join(root, 'exports', 'case.json');
  const backupPath = path.join(root, 'backups', 'agent-workbench.db');
  const database = openLocalDatabase({ filePath: databasePath });
  const store = createSqliteReviewStore({ database });
  await store.createCase(reviewCase());
  await store.recordRun(completedResult());
  database.close();

  const listed = await run('list', '--database', databasePath);
  assert.deepEqual(listed.cases.map(item => item.caseId), ['case-cli']);

  const shown = await run('show', '--database', databasePath, '--case-id', 'case-cli');
  assert.equal(shown.record.judgements[0].judgementId, 'judgement-cli');

  const annotated = await run(
    'annotate', '--database', databasePath,
    '--judgement-id', 'judgement-cli', '--verdict', 'correct', '--reason', 'Confirmed locally.',
  );
  assert.equal(annotated.record.annotations[0].verdict, 'correct');

  await run('export', '--database', databasePath, '--case-id', 'case-cli', '--output', exportPath);
  assert.equal(JSON.parse(fs.readFileSync(exportPath, 'utf8')).reviewCase.caseId, 'case-cli');

  const backedUp = await run('backup', '--database', databasePath, '--output', backupPath);
  assert.equal(backedUp.integrity.ok, true);
  assert.equal(fs.existsSync(backupPath), true);

  const doctor = await run('doctor', '--database', databasePath);
  assert.equal(doctor.integrity.ok, true);
  assert.ok(doctor.migrations.some(item => item.name === 'review-records-v1'));
});

async function run(...args) {
  const result = await executeFile(process.execPath, [commandScript, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  return JSON.parse(result.stdout);
}

function reviewCase() {
  return {
    caseId: 'case-cli',
    projectId: 'project-cli',
    sourceType: 'manual_turn_selection',
    turns: [{ sessionId: 'session-cli', turnId: 'turn-cli' }],
    createdAt: '2026-08-21T05:00:00.000Z',
  };
}

function completedResult() {
  return {
    run: {
      runId: 'run-cli',
      caseId: 'case-cli',
      invocation: {
        provider: 'test-provider', model: 'test-model', promptVersion: 'prompt-1',
        reviewPolicyVersion: 'policy-1', evidenceSchemaVersion: 'evidence-1',
      },
      startedAt: '2026-08-21T05:01:00.000Z',
      completedAt: '2026-08-21T05:01:01.000Z',
      status: 'completed',
      latencyMs: 1000,
    },
    judgements: [{
      judgementId: 'judgement-cli', runId: 'run-cli', category: 'testability',
      title: 'Missing test', summary: 'A test is missing.', severity: 'medium', confidence: 0.9,
      impact: 'Regression risk.', alternativeExplanation: 'Covered elsewhere.',
      recommendation: 'Add a test.', reviewability: 'sufficient',
      createdAt: '2026-08-21T05:01:01.000Z',
    }],
    evidence: [{
      evidenceId: 'evidence-cli', judgementId: 'judgement-cli', evidenceType: 'missing_test',
      targetType: 'event', targetId: 'event-cli', description: 'No test action.',
    }],
  };
}
