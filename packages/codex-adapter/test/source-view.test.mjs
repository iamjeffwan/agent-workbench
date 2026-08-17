import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseCodexRollout,
  readCodexProjectSteps,
  readCodexProjectTimelineEvents,
} from '../dist/index.js';

test('uses the original patch result and does not write a derived Codex ledger', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-source-view-'));
  const sessionFile = path.join(projectRoot, 'rollout-source.jsonl');
  const rows = [
    event('session_meta', { session_id: 'session-one', cwd: projectRoot }),
    event('turn_context', { turn_id: 'turn-one', cwd: projectRoot }),
    event('response_item', {
      type: 'custom_tool_call',
      name: 'exec',
      call_id: 'transport-one',
      input: 'text(await tools.apply_patch("requested patch"))',
    }),
    event('event_msg', {
      type: 'patch_apply_end',
      call_id: 'exec-one',
      turn_id: 'turn-one',
      success: true,
      changes: {
        [path.join(projectRoot, 'src', 'app.ts')]: {
          type: 'update',
          unified_diff: '@@ -1 +1 @@\n-old\n+final',
          move_path: null,
        },
      },
    }),
  ];
  fs.writeFileSync(sessionFile, `${rows.map(JSON.stringify).join('\n')}\n`, 'utf8');

  const steps = parseCodexRollout(sessionFile);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].id, 'patch:exec-one');
  assert.equal(steps[0].appliedChangeSuccess, true);
  assert.match(steps[0].appliedChanges[path.join(projectRoot, 'src', 'app.ts')].unified_diff, /\+final/);

  assert.equal(readCodexProjectSteps({ projectRoot, sessionFiles: [sessionFile] }).length, 1);
  assert.deepEqual(
    readCodexProjectTimelineEvents({ projectRoot, sessionFiles: [sessionFile] })
      .map(event => event.eventKind),
    ['context_ref', 'file_change'],
  );
  assert.equal(fs.existsSync(path.join(projectRoot, '.agent-workbench', 'codex-agent-steps.jsonl')), false);
});

function event(type, payload) {
  return { timestamp: '2026-08-12T01:00:00.000Z', type, payload };
}
