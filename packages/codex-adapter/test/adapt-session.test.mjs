import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { adaptCodexSession } from '../dist/index.js';
import { validateObservationSession } from '@agent-workbench/observation-schema';

const testDir = path.dirname(fileURLToPath(import.meta.url));

test('adaptCodexSession returns a valid canonical observation session', () => {
  const fixture = path.join(testDir, 'fixtures', 'unified-session.jsonl');
  const observation = adaptCodexSession(fixture);

  assert.equal(observation.schemaVersion, '1.0-draft');
  assert.equal(observation.session.sessionId, 'session-demo');
  assert.equal(observation.session.sourceAgent, 'codex');
  assert.equal(observation.session.sourceVersion, '0.148.0');
  assert.equal(observation.turns.length, 1);

  const [turn] = observation.turns;
  assert.equal(turn.turnId, 'turn-0001');
  assert.equal(turn.sourceRef.sourceId, 'native-turn-a');
  assert.deepEqual(turn.events.map(event => event.type), [
    'message',
    'lifecycle',
    'reasoning_summary',
    'tool_call',
    'tool_result',
    'lifecycle',
    'message',
    'lifecycle',
  ]);
  assert.ok(turn.events.every(event => event.rawRef.line >= 1));
  assert.ok(turn.events.every(event => event.provenance === 'direct'));
  assert.equal(turn.usage.totalTokens, 14);
  assert.equal(observation.diagnostics.unknownSourceEventCount, 0);
  assert.equal(observation.diagnostics.parseErrorCount, 0);
  assert.deepEqual(validateObservationSession(observation), { valid: true, errors: [] });
});

test('adaptCodexSession maps modern records and reports unsupported input', () => {
  const fixture = path.join(testDir, 'fixtures', 'modern-events.jsonl');
  const observation = adaptCodexSession(fixture);
  const events = observation.turns[0].events;

  assert.deepEqual(events.map(event => [event.type, event.category ?? event.subtype]), [
    ['lifecycle', 'context_instruction'],
    ['message', undefined],
    ['tool_result', 'search'],
    ['tool_result', 'mcp'],
    ['file_change', 'patch'],
    ['lifecycle', 'context_compacted'],
  ]);
  assert.equal(events.find(event => event.type === 'file_change').fidelity, 'partial');
  assert.equal(observation.diagnostics.lossyEventCount, 1);
  assert.equal(observation.diagnostics.unknownSourceEventCount, 1);
  assert.equal(observation.diagnostics.parseErrorCount, 1);
  assert.equal(observation.diagnostics.entries.length, 2);
});
