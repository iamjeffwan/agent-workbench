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
  assert.equal(turn.turnId, 'native-turn-a');
  assert.equal(turn.sourceRef.sourceId, 'native-turn-a');
  assert.equal(turn.fieldProvenance.turnId, 'direct');
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
  assert.ok(turn.events.every(event => event.turnId === 'native-turn-a'));
  assert.ok(turn.events.every(event => event.fieldProvenance.turnId === 'direct'));
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

test('adaptCodexSession keeps one canonical turn per real user input', () => {
  const fixture = path.resolve(
    testDir,
    '../../../fixtures/external/naturebench/codex/gpt-5.4/s41592-024-02191-z/transcript.jsonl',
  );
  const observation = adaptCodexSession(fixture);

  assert.equal(observation.turns.length, 2);
  assert.deepEqual(
    observation.turns.map(turn => turn.events.filter(event => event.type === 'message' && event.actor === 'user').length),
    [1, 1],
  );
});

test('adaptCodexSession preserves agent collaboration inside its canonical turn', () => {
  const fixture = path.join(testDir, 'fixtures', 'agent-collaboration.jsonl');
  const observation = adaptCodexSession(fixture);

  assert.equal(observation.turns.length, 2);
  const [firstTurn, secondTurn] = observation.turns;
  const firstUserMessage = firstTurn.events.find(event => event.type === 'message' && event.actor === 'user');
  assert.ok(firstUserMessage);
  assert.equal(firstUserMessage.content, 'Implement the change');
  assert.equal(firstUserMessage.relatedRawRefs?.length, 1);

  const runtimeContext = firstTurn.events.find(event => event.subtype === 'runtime_context');
  assert.equal(runtimeContext?.type, 'lifecycle');
  assert.equal(runtimeContext?.actor, 'system');

  const subagentActivity = firstTurn.events.find(event => event.category === 'subagent');
  assert.equal(subagentActivity?.type, 'lifecycle');
  assert.equal(subagentActivity?.subtype, 'started');

  const agentMessage = firstTurn.events.find(event => event.subtype === 'agent_message');
  assert.equal(agentMessage?.type, 'message');
  assert.equal(agentMessage?.authorId, '/root/reviewer');
  assert.equal(agentMessage?.recipientId, '/root');
  assert.equal(agentMessage?.data?.triggerTurn, false);
  assert.equal(agentMessage?.relatedRawRefs?.length, 1);

  assert.equal(secondTurn.events.filter(event => event.type === 'message' && event.actor === 'user').length, 1);
  assert.equal(observation.diagnostics.unknownSourceEventCount, 0);
  assert.equal(observation.capabilityManifest.capabilities.subagent_events, 'full');
  assert.equal(observation.capabilityManifest.capabilities.inter_agent_messages, 'full');
});
