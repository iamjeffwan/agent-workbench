import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTimeline } from '../dist/index.js';

test('buildTimeline collapses exploration tools and nests program calls', () => {
  const turns = buildTimeline(
    [
      {
        id: 'r1',
        name: 'Read',
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
  assert.equal(turns[0].children[0].type, 'explore_group');
  assert.equal(turns[0].children[0].name, '文件探查 × 1');
  const shell = turns[0].children[1];
  assert.equal(shell.name, 'Shell');
  assert.equal(shell.children[0].name, 'Fetcher.fetch');
  assert.equal(shell.children[0].children[0].name, 'Summarizer.summarize');
});
