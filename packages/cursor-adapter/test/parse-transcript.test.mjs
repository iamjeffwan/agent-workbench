import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseCursorTranscript } from '../dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));

test('Cursor transcripts hide credentials before callers can store them', () => {
  const fixture = path.join(testDir, 'fixtures', 'credentials-transcript.jsonl');
  const [step] = parseCursorTranscript(fixture);

  assert.deepEqual(step.arguments, {
    accessToken: '[REDACTED]',
    command: "DEEPSEEK_API_KEY=[REDACTED] node app.js && token='[REDACTED]';",
    content: 'A token budget is ordinary product text.',
  });
});
