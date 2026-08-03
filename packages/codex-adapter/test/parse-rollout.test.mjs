import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseCodexRollout } from '../dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));

test('Codex records hide credentials before callers can store them', () => {
  const fixture = path.join(testDir, 'fixtures', 'credentials-rollout.jsonl');
  const [step] = parseCodexRollout(fixture);

  assert.deepEqual(step.arguments, {
    DEEPSEEK_API_KEY: '[REDACTED]',
    command: 'TOKEN=[REDACTED] node app.js',
    content: 'A token budget is ordinary product text.',
  });
  assert.equal(step.output, 'Authorization: [REDACTED]');
});
