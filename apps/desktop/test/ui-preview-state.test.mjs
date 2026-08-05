import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPreviewState,
  getRowHeight,
  getRowSpacing,
  getVisibleRows,
  reducePreviewState,
  resolveSelectedRecord,
} from '../renderer/react/src/workbench-preview/view-model.ts';
import { previewRecords } from '../renderer/react/src/workbench-preview/fixtures.ts';
import { parsePatchFiles } from '../renderer/react/src/workbench-preview/patch-files.ts';
import {
  buildObservableTurns,
  buildStandaloneRecords,
  createLiveRange,
  extendLiveRange,
  recordsForView,
  recordsForTurnIds,
} from '../renderer/react/src/workbench-preview/turn-model.ts';

const records = [
  {
    id: 'operation-ok',
    kind: 'operation',
    children: [
      { id: 'call-ok', kind: 'call' },
      { id: 'network-ok', kind: 'network' },
    ],
  },
  { id: 'changes', kind: 'changes' },
];

test('patch details convert Git and apply_patch records into the shared diff model', () => {
  const git = parsePatchFiles(`diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`);
  const applied = parsePatchFiles(`*** Begin Patch
*** Add File: src/new.ts
+export const created = true;
*** End Patch`);

  assert.equal(git[0].path, 'src/app.ts');
  assert.equal(git[0].change, 'modified');
  assert.equal(git[0].before, 'export const value = 1;');
  assert.equal(git[0].after, 'export const value = 2;');
  assert.equal(applied[0].path, 'src/new.ts');
  assert.equal(applied[0].change, 'added');
});

test('preview starts with program calls expanded below their operation', () => {
  const state = createPreviewState(records);
  assert.equal(state.selectedId, 'operation-ok');
  assert.deepEqual(getVisibleRows(records, state).map(row => row.record.id), [
    'operation-ok',
    'call-ok',
    'network-ok',
    'changes',
  ]);
});

test('focus filters can promote runtime and change evidence without agent rows', () => {
  const runtime = reducePreviewState(createPreviewState(records), {
    type: 'set-focus',
    focus: 'runtime',
  });
  assert.deepEqual(getVisibleRows(records, runtime).map(row => [row.record.id, row.depth]), [
    ['call-ok', 0],
    ['network-ok', 0],
  ]);

  const changes = reducePreviewState(runtime, { type: 'set-focus', focus: 'changes' });
  assert.deepEqual(getVisibleRows(records, changes).map(row => row.record.id), ['changes']);
});

test('row spacing joins operations to edge children and separates adjacent ordinary rows', () => {
  const rows = [
    { record: { id: 'operation-a', kind: 'operation' }, depth: 0 },
    { record: { id: 'child-a', kind: 'call' }, depth: 1 },
    { record: { id: 'child-b', kind: 'network' }, depth: 1 },
    { record: { id: 'operation-b', kind: 'operation' }, depth: 0 },
    { record: { id: 'only-child', kind: 'changes' }, depth: 1 },
    { record: { id: 'operation-c', kind: 'operation' }, depth: 0 },
  ];

  assert.deepEqual(getRowSpacing(rows, 0), { top: 0, bottom: 0 });
  assert.deepEqual(getRowSpacing(rows, 1), { top: 2, bottom: 2 });
  assert.deepEqual(getRowSpacing(rows, 2), { top: 2, bottom: 2 });
  assert.deepEqual(getRowSpacing(rows, 3), { top: 0, bottom: 0 });
  assert.deepEqual(getRowSpacing(rows, 4), { top: 2, bottom: 2 });
});

test('activity labels format method and status for display', async () => {
  const { formatMethodLabel, formatStatusLabel, formatDisplayPath } = await import('../renderer/react/src/workbench-preview/display-labels.ts');

  assert.equal(formatMethodLabel('SHELL'), 'Shell');
  assert.equal(formatMethodLabel('EDIT'), 'Edit');
  assert.equal(formatMethodLabel('DIFF'), 'Diff');
  assert.equal(formatMethodLabel('GET'), 'GET');
  assert.equal(formatMethodLabel('buildTimeline'), 'buildTimeline');
  assert.equal(formatStatusLabel('OK'), 'Ok');
  assert.equal(formatStatusLabel('ERROR'), 'Error');
  assert.equal(formatStatusLabel('200'), '200');
  assert.equal(
    formatDisplayPath('apps/desktop/renderer/react/src/workbench-preview/PreviewApp.tsx'),
    'react/src/workbench-preview/…/PreviewApp.tsx',
  );
});

test('agent operations stay taller while independent evidence and nested rows stay compact', () => {
  const shell = previewRecords.find(record => record.id === 'operation-tests');
  const network = previewRecords.find(record => record.id === 'network-refresh');
  const edit = previewRecords.find(record => record.id === 'operation-error');

  assert.equal(getRowHeight({ record: shell, depth: 0 }), 43);
  assert.equal(getRowHeight({ record: network, depth: 0 }), 34);
  assert.equal(getRowHeight({ record: edit, depth: 0 }), 43);
  assert.equal(getRowHeight({ record: { id: 'child', kind: 'call' }, depth: 1 }), 34);
});

test('unassigned code changes stay independent from the edit operation', () => {
  const editOperation = previewRecords.find(record => record.id === 'operation-error');

  assert.equal(editOperation?.kind, 'operation');
  assert.deepEqual(editOperation?.children.map(record => record.id), []);
  assert.equal(previewRecords.some(record => record.id === 'code-changes'), true);
});

test('list selection switches the active detail card', () => {
  const state = reducePreviewState(createPreviewState(records), {
    type: 'select-record',
    id: 'call-ok',
  });
  assert.equal(resolveSelectedRecord(records, state)?.kind, 'call');
});

test('operations can collapse and restore their compact child rows', () => {
  const collapsed = reducePreviewState(createPreviewState(records), {
    type: 'toggle-operation',
    id: 'operation-ok',
  });
  assert.deepEqual(getVisibleRows(records, collapsed).map(row => row.record.id), [
    'operation-ok',
    'changes',
  ]);

  const expanded = reducePreviewState(collapsed, {
    type: 'toggle-operation',
    id: 'operation-ok',
  });
  assert.equal(getVisibleRows(records, expanded).length, 4);
});

test('split diff enters wide mode and unified diff restores the list', () => {
  const split = reducePreviewState(createPreviewState(records), {
    type: 'set-diff-layout',
    layout: 'split',
  });
  assert.equal(split.diffLayout, 'split');
  assert.equal(split.wideInspector, true);

  const unified = reducePreviewState(split, {
    type: 'set-diff-layout',
    layout: 'unified',
  });
  assert.equal(unified.wideInspector, false);
});

test('changed tree files select a diff card while ordinary files open source', () => {
  const changed = reducePreviewState(createPreviewState(records), {
    type: 'open-project-file',
    path: 'src/app.ts',
    changed: true,
  });
  assert.equal(changed.focusedChangedPath, 'src/app.ts');
  assert.equal(changed.sourceModalPath, undefined);

  const ordinary = reducePreviewState(changed, {
    type: 'open-project-file',
    path: 'src/types.ts',
    changed: false,
  });
  assert.equal(ordinary.sourceModalPath, 'src/types.ts');

  const closed = reducePreviewState(ordinary, { type: 'close-source' });
  assert.equal(closed.sourceModalPath, undefined);
});

test('selection is cleared when refreshed preview data no longer contains it', () => {
  const selected = reducePreviewState(createPreviewState(records), {
    type: 'select-record',
    id: 'call-ok',
  });
  const refreshed = reducePreviewState(selected, {
    type: 'reconcile-records',
    records: [{ id: 'changes', kind: 'changes' }],
  });
  assert.equal(refreshed.selectedId, 'changes');
  assert.equal(refreshed.wideInspector, false);
});

test('observable turn index excludes read-only turns and keeps search turns', () => {
  const state = workbenchState([
    turn('read-turn', [{ type: 'agent_tool', id: 'read-1', name: 'Read' }]),
    turn('search-turn', [{ type: 'agent_tool', id: 'search-1', name: 'WebSearch' }]),
  ]);

  const turns = buildObservableTurns(state);
  assert.deepEqual(turns.map(item => item.generationId), ['search-turn']);
  assert.deepEqual(turns[0].activities, ['SEARCH']);
});

test('start from now includes the complete latest turn and later activity adds complete turns from every source', () => {
  const initial = buildObservableTurns(workbenchState([
    turn('codex-old', [{ type: 'agent_tool', id: 'old-shell', name: 'Shell' }], 'codex', 1),
    turn('cursor-latest', [
      { type: 'agent_tool', id: 'cursor-search', name: 'SemanticSearch' },
      { type: 'agent_tool', id: 'cursor-write', name: 'Write' },
    ], 'cursor', 2),
  ]));
  const range = createLiveRange(initial);

  assert.deepEqual(range.turnIds, [initial[1].id]);
  assert.deepEqual(recordsForTurnIds(initial, range.turnIds).map(record => record.method), ['SEARCH', 'EDIT']);

  const updated = buildObservableTurns(workbenchState([
    turn('codex-old', [{ type: 'agent_tool', id: 'old-shell', name: 'Shell' }], 'codex', 1),
    turn('cursor-latest', [
      { type: 'agent_tool', id: 'cursor-search', name: 'SemanticSearch' },
      { type: 'agent_tool', id: 'cursor-write', name: 'Write' },
    ], 'cursor', 2),
    turn('codex-new', [
      { type: 'agent_tool', id: 'new-search', name: 'WebSearch' },
      { type: 'agent_tool', id: 'new-edit', name: 'apply_patch' },
    ], 'codex', 3),
  ]));
  const extended = extendLiveRange(range, updated);

  assert.equal(extended.turnIds.length, 2);
  assert.deepEqual(recordsForTurnIds(updated, extended.turnIds).map(record => record.method), [
    'SEARCH', 'EDIT', 'WEB', 'EDIT',
  ]);
});

test('observed diffs stay independent while remaining visible in their observation window', () => {
  const state = workbenchState([
    turn('cursor-turn', [{ type: 'agent_tool', id: 'cursor-edit', name: 'Write', method: 'EDIT', display: true }], 'cursor', 1),
    {
      type: 'code_change',
      id: 'observed-change',
      parentId: null,
      method: 'DIFF',
      display: true,
      changed: true,
      source: 'git-snapshot',
      attribution: 'unassigned',
      observationWindow: { generationId: 'cursor-turn' },
      startedAt: '2026-08-04T10:01:00.000Z',
      endedAt: '2026-08-04T10:01:10.000Z',
      afterPatch: 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n',
      children: [],
    },
  ]);
  const turns = buildObservableTurns(state);
  const evidence = buildStandaloneRecords(state);
  const records = recordsForView(turns, [turns[0].id], evidence);

  assert.equal(records[0].method, 'EDIT');
  assert.equal(records[0].children.length, 0);
  assert.equal(records[1].kind, 'changes');
  assert.equal(records[1].status, 'OBSERVED');
  assert.equal(records[1].rawRecord.attribution, 'unassigned');
  assert.equal(records[1].files.length, 1);
});

function turn(generationId, children, provider = 'codex', minute = 0) {
  const startedAt = `2026-08-04T10:0${minute}:00.000Z`;
  return {
    type: 'turn',
    id: `turn:${generationId}`,
    generationId,
    conversationId: `${provider}-conversation`,
    provider,
    startedAt,
    endedAt: startedAt,
    children: children.map(child => ({
      parentId: `turn:${generationId}`,
      status: 'completed',
      startedAt,
      endedAt: startedAt,
      provider,
      children: [],
      ...child,
    })),
  };
}

function workbenchState(turns) {
  return {
    projectRoot: 'F:\\agent-workbench',
    turns,
    error: null,
    observation: null,
    adapters: {},
    sources: {},
    files: {},
    fileBus: { status: 'watching', directory: 'F:\\agent-workbench\\.agent-workbench', lastRefreshAt: null, error: null },
  };
}
