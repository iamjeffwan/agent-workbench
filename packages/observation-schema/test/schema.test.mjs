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
