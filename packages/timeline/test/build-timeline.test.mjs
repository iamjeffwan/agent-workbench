import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTimeline } from '../dist/index.js';

test('buildTimeline hides reads, normalizes useful operations and nests program calls', () => {
  const turns = buildTimeline(
    [
      {
        id: 'r1',
        name: 'Read',
        generationId: 'g1',
        status: 'completed',
      },
      {
        id: 'g1',
        name: 'Grep',
        generationId: 'g1',
        status: 'completed',
      },
      {
        id: 's1',
        name: 'Shell',
        generationId: 'g1',
        status: 'completed',
        launchesProcess: true,
      },
    ],
    [
      {
        callId: 1,
        methodId: 1,
        parentCallId: null,
        processOriginId: 's1',
        durationMs: 10,
      },
      {
        callId: 2,
        methodId: 2,
        parentCallId: 1,
        processOriginId: 's1',
        durationMs: 20,
      },
    ],
    {
      1: { label: 'Fetcher.fetch' },
      2: { label: 'Summarizer.summarize' },
    },
  );

  assert.equal(turns.length, 1);
  assert.equal(turns[0].children.some(child => child.name === 'Read'), false);
  assert.equal(turns[0].children[0].method, 'SEARCH');
  const shell = turns[0].children[1];
  assert.equal(shell.name, 'Shell');
  assert.equal(shell.method, 'SHELL');
  assert.equal(shell.children[0].name, 'Fetcher.fetch');
  assert.equal(shell.children[0].children[0].name, 'Summarizer.summarize');
});

test('buildTimeline keeps Codex turn identity and shell classification', () => {
  const turns = buildTimeline(
    [
      {
        id: 'c1',
        name: 'shell_command',
        provider: 'codex',
        conversationId: 'conversation-one',
        generationId: 'turn-one',
        launchesProcess: true,
      },
    ],
    [],
  );

  assert.equal(turns[0].provider, 'codex');
  assert.equal(turns[0].conversationId, 'conversation-one');
  assert.equal(turns[0].generationId, 'turn-one');
  assert.equal(turns[0].children[0].name, 'shell_command');
});

test('buildTimeline keeps observed code changes as independent unassigned roots', () => {
  const roots = buildTimeline(
    [{ id: 'write-one', name: 'Write', generationId: 'turn-one' }],
    [],
    {},
    [
      {
        kind: 'code_change',
        id: 'change-one',
        generationId: 'turn-one',
        changed: true,
        beforeHash: 'before',
        afterHash: 'after',
        afterPatch: 'diff contents',
        source: 'git-snapshot',
        attribution: 'unassigned',
      },
    ],
  );

  const turn = roots.find(root => root.type === 'turn');
  const change = roots.find(root => root.type === 'code_change');
  assert.equal(turn.children.some(child => child.type === 'code_change'), false);
  assert.equal(change.name, 'Code state changed');
  assert.equal(change.afterPatch, 'diff contents');
  assert.equal(change.parentId, null);
  assert.equal(change.attribution, 'unassigned');
  assert.equal(change.source, 'git-snapshot');
  assert.equal(change.display, false);
});

test('buildTimeline classifies tests and retains unknown tools without rendering them', () => {
  const [turn] = buildTimeline([
    {
      id: 'test-command',
      name: 'shell_command',
      generationId: 'turn-one',
      arguments: { command: 'pnpm test' },
    },
    {
      id: 'future-tool',
      name: 'future_tool',
      generationId: 'turn-one',
    },
  ], []);

  assert.equal(turn.children[0].method, 'TEST');
  assert.equal(turn.children[0].display, true);
  assert.equal(turn.children[1].method, 'OTHER');
  assert.equal(turn.children[1].normalized, false);
  assert.equal(turn.children[1].display, false);
});

test('buildTimeline never merges equal turn ids from different agent sources', () => {
  const roots = buildTimeline([
    { id: 'codex-call', name: 'Grep', provider: 'codex', conversationId: 'codex-thread', generationId: 'same-turn' },
    { id: 'cursor-call', name: 'Grep', provider: 'cursor', conversationId: 'cursor-thread', generationId: 'same-turn' },
  ], []);

  const turns = roots.filter(root => root.type === 'turn');
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map(turn => turn.provider), ['codex', 'cursor']);
  assert.ok(turns.every(turn => turn.generationId === 'same-turn'));
});
