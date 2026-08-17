import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTimeline, reviewTimelineResults } from '../dist/index.js';

test('result review reports failed test evidence and keeps its evidence ids', () => {
  const [turn] = buildTimeline([
    {
      id: 'test-command',
      name: 'shell_command',
      generationId: 'turn-one',
      arguments: { command: 'pnpm test' },
      failed: true,
      error: 'exit code 1',
      sessionFile: 'session.jsonl',
      sourceLine: 12,
    },
  ], []);

  const review = reviewTimelineResults([turn]);

  assert.equal(review.status, 'failed');
  assert.equal(review.checkedEventCount, 1);
  assert.equal(review.checks[0].command, 'pnpm test');
  assert.equal(review.checks[0].result, 'exit code 1');
  assert.equal(review.findings[0].ruleId, 'test-failed');
  assert.deepEqual(review.findings[0].eventIds, ['test-command']);
  assert.deepEqual(review.findings[0].evidenceIds, [
    'evidence:test-command:raw',
    'evidence:test-command:validation',
  ]);
});

test('result review distinguishes build and lint failures', () => {
  const [turn] = buildTimeline([
    {
      id: 'build-command',
      name: 'shell_command',
      generationId: 'turn-one',
      arguments: { command: 'pnpm build' },
      failed: true,
    },
    {
      id: 'lint-command',
      name: 'shell_command',
      generationId: 'turn-one',
      arguments: { command: 'pnpm lint' },
      failed: true,
    },
  ], []);

  const review = reviewTimelineResults([turn]);

  assert.deepEqual(review.findings.map(finding => finding.ruleId), [
    'build-failed',
    'lint-failed',
  ]);
});

test('result review reports unknown when a task has no verification evidence', () => {
  const [turn] = buildTimeline([
    {
      id: 'edit-command',
      name: 'apply_patch',
      generationId: 'turn-one',
    },
  ], []);

  const review = reviewTimelineResults([turn]);

  assert.equal(review.status, 'unknown');
  assert.equal(review.findings[0].ruleId, 'verification-missing');
});

test('result review reports incomplete when a required profile has no result', () => {
  const review = reviewTimelineResults([], {
    profile: {
      id: 'logic-check',
      checks: [{ id: 'unit-tests', label: 'Unit tests', kind: 'test' }],
    },
  });

  assert.equal(review.status, 'incomplete');
  assert.equal(review.findings[0].ruleId, 'verification-not-run');
});

test('result review reports structured Playwright assertion failures', () => {
  const review = reviewTimelineResults([], {
    profile: {
      id: 'ui-smoke',
      checks: [{ id: 'open-home', label: 'Open home', kind: 'playwright' }],
    },
    results: {
      version: 1,
      profileId: 'ui-smoke',
      status: 'failed',
      checks: [{
        id: 'open-home',
        status: 'failed',
        summary: 'Home page did not render',
      }],
    },
  });

  assert.equal(review.status, 'failed');
  assert.equal(review.findings[0].ruleId, 'playwright-assertion-failed');
});

test('result review passes when all required structured checks pass', () => {
  const review = reviewTimelineResults([], {
    profile: {
      id: 'ui-smoke',
      checks: [{ id: 'open-home', label: 'Open home', kind: 'playwright' }],
    },
    results: {
      version: 1,
      profileId: 'ui-smoke',
      status: 'passed',
      checks: [{ id: 'open-home', status: 'passed' }],
    },
  });

  assert.equal(review.status, 'passed');
  assert.equal(review.findings.length, 0);
});
