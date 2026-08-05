import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const hook = path.join(repoRoot, '.cursor/hooks/record-code-state.mjs');

test('Cursor lifecycle hooks record redacted code state changes for one turn', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-code-state-'));
  git(projectRoot, ['init']);
  git(projectRoot, ['config', 'user.email', 'test@example.com']);
  git(projectRoot, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(projectRoot, 'app.js'), 'export const value = 1;\n', 'utf8');
  git(projectRoot, ['add', 'app.js']);
  git(projectRoot, ['commit', '-m', 'baseline']);

  runHook(projectRoot, 'start');
  fs.writeFileSync(
    path.join(projectRoot, 'app.js'),
    "export const API_KEY = 'sk-test-1234567890abcdef';\n",
    'utf8',
  );
  runHook(projectRoot, 'end');

  const output = fs.readFileSync(
    path.join(projectRoot, '.agent-workbench', 'code-changes.jsonl'),
    'utf8',
  );
  const rows = output.trim().split(/\r?\n/).map(JSON.parse);
  const change = rows.find((row) => row.kind === 'code_change');
  assert.equal(change.attribution, 'unassigned');
  assert.equal(change.source, 'git-snapshot');
  assert.equal(change.observationWindow.generationId, 'turn-one');
  assert.equal(change.changed, true);
  assert.match(change.afterPatch, /API_KEY/);
  assert.doesNotMatch(output, /sk-test-1234567890abcdef/);
});

function runHook(projectRoot, phase) {
  const result = spawnSync(process.execPath, [hook, phase], {
    cwd: projectRoot,
    input: JSON.stringify({
      hook_event_name: phase === 'start' ? 'beforeSubmitPrompt' : 'stop',
      conversation_id: 'conversation-one',
      generation_id: 'turn-one',
      workspace_roots: [projectRoot],
      status: 'completed',
    }),
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '{}');
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
}
