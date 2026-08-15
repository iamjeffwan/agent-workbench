import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProjectAssetsService } from '../electron/project-assets.mjs';

test('scans managed documents and writes only an unchanged confirmed draft target', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-assets-'));
  const overview = path.join(projectRoot, 'docs', 'project-overview', 'overview.md');
  fs.mkdirSync(path.dirname(overview), { recursive: true });
  fs.writeFileSync(overview, '# Existing\n', 'utf8');

  const service = createProjectAssetsService({
    readTask: () => ({
      status: 'ready',
      data: {
        id: 'task-one',
        title: 'One task',
        projectRoot,
        status: 'ready',
        document: { markdown: '# Task flow\n' },
      },
      error: null,
    }),
    skillInstructions: 'Return the complete Markdown document.',
    completeModel: async () => ({
      status: 'ready',
      data: { callId: 'call-one', model: 'deepseek-v4-flash', content: '# Existing\n\n## New lesson\nKeep this.\n' },
      error: null,
    }),
  });

  const listed = service.listAssets(projectRoot);
  assert.equal(listed.status, 'ready');
  assert.deepEqual(
    listed.data.categories.find(category => category.id === 'project-overview').files.map(file => file.relativePath),
    ['docs/project-overview/overview.md'],
  );

  const draft = await service.createDraft({
    projectRoot,
    taskId: 'task-one',
    experience: 'Keep this lesson.',
    category: 'project-overview',
    relativePath: 'docs/project-overview/overview.md',
  });
  assert.equal(draft.status, 'ready');

  const escaped = service.writeDraft({
    ...draft.data,
    relativePath: '../outside.md',
    markdown: draft.data.after,
  });
  assert.equal(escaped.status, 'error');

  fs.writeFileSync(overview, '# Changed by user\n', 'utf8');
  const stale = service.writeDraft({
    ...draft.data,
    markdown: draft.data.after,
  });
  assert.equal(stale.status, 'error');
  assert.equal(fs.readFileSync(overview, 'utf8'), '# Changed by user\n');

  const fresh = await service.createDraft({
    projectRoot,
    taskId: 'task-one',
    experience: 'Keep this lesson.',
    category: 'project-overview',
    relativePath: 'docs/project-overview/overview.md',
  });
  const written = service.writeDraft({ ...fresh.data, markdown: fresh.data.after });
  assert.equal(written.status, 'ready');
  assert.match(fs.readFileSync(overview, 'utf8'), /New lesson/);
});

test('creates, renames and moves project document nodes through the managed tree', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-assets-tree-'));
  const recycle = path.join(projectRoot, '.recycle');
  fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
  fs.mkdirSync(recycle);
  const service = createProjectAssetsService({
    readTask: () => ({ status: 'error', data: null, error: 'unused' }),
    completeModel: async () => ({ status: 'error', data: null, error: 'unused' }),
    skillInstructions: '',
    trashItem: async target => {
      fs.renameSync(target, path.join(recycle, path.basename(target)));
    },
  });

  assert.equal(service.createFolder(projectRoot, 'docs/notes').status, 'ready');
  assert.equal(service.createDocument(projectRoot, 'docs/notes/first.md').status, 'ready');
  assert.equal(service.renameDocument(projectRoot, 'docs/notes/first.md', 'renamed').status, 'ready');
  assert.equal(service.renameFolder(projectRoot, 'docs/notes', 'references').status, 'ready');
  assert.equal(fs.existsSync(path.join(projectRoot, 'docs', 'references', 'renamed.md')), true);

  assert.equal((await service.trashDocument(projectRoot, 'docs/references/renamed.md')).status, 'ready');
  assert.equal(fs.existsSync(path.join(recycle, 'renamed.md')), true);
  assert.equal((await service.trashFolder(projectRoot, 'docs/references')).status, 'ready');
  assert.equal(fs.existsSync(path.join(recycle, 'references')), true);
});
