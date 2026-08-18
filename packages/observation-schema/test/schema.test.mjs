import assert from 'node:assert/strict';
import test from 'node:test';

import { validateObservationSession } from '../dist/index.js';

test('validator reports contract paths for malformed sessions', () => {
  const result = validateObservationSession({ schemaVersion: '1.0-draft', turns: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path === '$.session'));
  assert.ok(result.errors.some(error => error.path === '$.capabilityManifest'));
  assert.ok(result.errors.some(error => error.path === '$.diagnostics'));
});

test('validator enforces the published JSON Schema contract', () => {
  const result = validateObservationSession({
    schemaVersion: '1.0-draft',
    session: {
      sessionId: 'session-one',
      sourceAgent: 'invalid-agent',
      sourceVersion: '1.0.0',
      adapterVersion: '1.0.0',
      rawRef: { sourceFile: 'session.jsonl', line: 1, sourceType: 'session_meta' },
      unexpected: true,
    },
    turns: [],
    capabilityManifest: {
      agent: 'invalid-agent',
      capabilities: { token_usage: 'invalid' },
    },
    diagnostics: {
      unknownSourceEventCount: 0,
      parseErrorCount: 0,
      lossyEventCount: 0,
      unsupportedFieldCount: 0,
      entries: [{ unexpected: true }],
    },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path === '$.session.sourceAgent'));
  assert.ok(result.errors.some(error => error.path === '$.session.unexpected'));
  assert.ok(result.errors.some(error => error.path === '$.capabilityManifest.agent'));
  assert.ok(result.errors.some(error => error.path === '$.capabilityManifest.capabilities.token_usage'));
  assert.ok(result.errors.some(error => error.path === '$.diagnostics.entries[0].rawRef'));
});
