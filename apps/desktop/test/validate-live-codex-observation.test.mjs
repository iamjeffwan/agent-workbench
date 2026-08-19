import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  compareResults,
  summarizeRaw,
} from '../electron/live-codex-observation-comparison.mjs';

test('reports a failed comparison with a clear reason when the session file is missing', () => {
  const missingSessionFile = path.join(os.tmpdir(), `missing-codex-session-${process.pid}.json`);
  const raw = summarizeRaw(missingSessionFile, path.join(os.tmpdir(), 'missing-project'));
  const comparison = compareResults({
    sessionFile: missingSessionFile,
    projectRoot: path.join(os.tmpdir(), 'missing-project'),
    legacyEvents: [],
    canonicalSession: null,
    legacyTurn: null,
    canonicalTurn: null,
  });

  assert.equal(raw.sessionFilePresent, false);
  assert.deepEqual(raw.semanticLines, {
    reasoning: '',
    toolCalls: '',
    toolResults: '',
    fileChanges: '',
  });
  assert.equal(comparison.passed, false);
  assert.equal(comparison.checks.sessionFilePresent, false);
  assert.deepEqual(comparison.failureReasons, ['session_file_missing']);
});
