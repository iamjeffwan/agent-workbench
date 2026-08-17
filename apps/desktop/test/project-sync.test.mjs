import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { createProjectSyncService } from '../electron/project-sync.mjs';

test('writes a sanitized task package inside the selected project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-sync-'));
  const documentFile = path.join(root, 'docs', 'task-flows', 'task.md');
  fs.mkdirSync(path.dirname(documentFile), { recursive: true });
  fs.writeFileSync(documentFile, '# Task\n', 'utf8');
  const sessionFile = path.join(root, 'private-session.jsonl');
  const task = {
    id: 'task-one',
    title: 'Sanitize task',
    projectRoot: root,
    sessionId: 'session-one',
    turnIds: ['turn-one'],
    createdAt: '2026-08-16T00:00:00.000Z',
    status: 'ready',
    document: { projectFile: 'docs/task-flows/task.md' },
    evidence: { sessionFile },
  };
  const service = createProjectSyncService({
    readTask: () => ({ status: 'ready', source: 'workbench-task', data: task, error: null }),
    readTaskEvidence: () => ({
      missingTurnIds: [],
      turns: [{
        id: 'turn-one',
        sessionId: 'session-one',
        cwd: root,
        userInput: 'Use token=secret-value',
        startedAt: '2026-08-16T00:00:01.000Z',
        updatedAt: '2026-08-16T00:00:02.000Z',
        status: 'completed',
        metrics: { durationMs: 1_000, tokens: { total: 10 } },
        events: [{
          kind: 'tool-call',
          timestamp: '2026-08-16T00:00:01.500Z',
          name: 'exec_command',
          detail: `pwd=${root} token=secret-value`,
          callId: 'call-one',
          success: null,
          source: { sessionFile, line: 8 },
        }],
      }],
    }),
    now: () => new Date('2026-08-16T00:01:00.000Z'),
  });

  const added = service.addTaskToSync('task-one');
  assert.equal(added.status, 'ready', added.error);
  assert.equal(added.data.projectFile, 'docs/task-flows/task.md');
  assert.equal(added.data.privacy.rawSessionIncluded, false);
  const evidenceFile = path.join(root, '.agent-workbench-sync', 'tasks', 'task-one', 'evidence.jsonl');
  const evidence = fs.readFileSync(evidenceFile, 'utf8');
  assert.equal(evidence.includes(root), false);
  assert.equal(evidence.includes('secret-value'), false);
  assert.match(evidence, /\[REDACTED\]/);

  const listed = service.listSyncTasks(root);
  assert.equal(listed.status, 'ready');
  assert.deepEqual(listed.data.map(item => item.id), ['task-one']);
  const read = service.readSyncTask(root, 'task-one');
  assert.equal(read.status, 'ready');
  assert.equal(read.data.evidence.length, 1);
  assert.equal(read.data.evidence[0].evidence.sourceLine, 8);
});

test('blocks sensitive repository files from publish selection', async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'rev-parse') return { stdout: 'C:\\project\n', stderr: '' };
    if (args[0] === 'branch') return { stdout: 'main\n', stderr: '' };
    if (args[0] === 'remote' && args[1] === 'get-url') return { stdout: 'git@github.com:user/project.git\n', stderr: '' };
    if (args[0] === 'remote') return { stdout: 'origin\n', stderr: '' };
    if (args[0] === 'status') return { stdout: ' M app.js\0?? .env\0', stderr: '' };
    if (args[0] === 'fetch') return { stdout: '', stderr: '' };
    if (args[0] === 'rev-list') return { stdout: '0 0\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const service = createProjectSyncService({ readTask: () => null, readTaskEvidence: () => null, run });
  const result = await service.getRepositoryStatus('C:\\project');
  assert.equal(result.status, 'ready', result.error);
  assert.equal(result.data.changes[1].blocked, true);
  assert.ok(calls.some(([, args]) => args[0] === 'status'));
});

test('publishes the confirmed project change set without force pushing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-git-'));
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-remote-'));
  execFileSync('git', ['init', '--bare', remote], { encoding: 'utf8' });
  execFileSync('git', ['init', '-b', 'main', root], { encoding: 'utf8' });
  git(root, ['config', 'user.name', 'Workbench Test']);
  git(root, ['config', 'user.email', 'workbench@example.test']);
  fs.writeFileSync(path.join(root, 'app.js'), 'export const value = 1;\n', 'utf8');
  git(root, ['add', 'app.js']);
  git(root, ['commit', '-m', 'baseline']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '--set-upstream', 'origin', 'main']);
  fs.writeFileSync(path.join(root, 'app.js'), 'export const value = 2;\n', 'utf8');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'state.md'), '# State\n', 'utf8');

  const service = createProjectSyncService({ readTask: () => null, readTaskEvidence: () => null });
  const result = await service.publishRepository({
    projectRoot: root,
    selectedPaths: ['app.js', 'docs/'],
    message: 'sync project state',
  });
  assert.equal(result.status, 'ready', result.error);
  assert.equal(result.data.clean, true);
  assert.equal(result.data.localAhead, 0);
  assert.equal(result.data.remoteAhead, 0);
  const remoteMessage = execFileSync('git', ['--git-dir', remote, 'log', 'main', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
  assert.equal(remoteMessage, 'sync project state');
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
