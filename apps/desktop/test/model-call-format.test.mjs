import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(root, '../renderer/react/src/workbench-preview/model-call-format.ts');
const source = readFileSync(sourcePath, 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const { parseModelCallEvents } = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}`
);

test('presents task model calls as structured prompts, evidence and responses', () => {
  const evidence = {
    conversationId: 'conversation-one',
    projectRoot: 'F:\\agent-workbench',
    requestedTurnIds: ['turn-one'],
    missingTurnIds: [],
    turns: [{ id: 'turn-one', events: [] }],
  };
  const requestBody = JSON.stringify({
    model: 'deepseek-v4-flash',
    messages: [
      { role: 'system', content: 'Generate a factual document.' },
      {
        role: 'user',
        content: [
          'Task title: Connect DeepSeek',
          'Use every selected turn as the task scope.',
          '',
          '<task-evidence-json>',
          JSON.stringify(evidence, null, 2),
          '</task-evidence-json>',
        ].join('\n'),
      },
    ],
    stream: false,
    thinking: { type: 'disabled' },
    max_tokens: 12_000,
  });
  const responseBody = JSON.stringify({
    model: 'deepseek-v4-flash',
    choices: [{
      message: { content: '# Connect DeepSeek', reasoning_content: 'Internal plan' },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });

  const view = parseModelCallEvents([{
    event: 'request.started', callId: 'call-one', timestamp: '2026-08-11T00:00:00.000Z',
    model: 'deepseek-v4-flash', request: { method: 'POST', url: 'https://api.deepseek.com', body: requestBody },
  }, {
    event: 'response.completed', callId: 'call-one', timestamp: '2026-08-11T00:00:01.000Z',
    response: { status: 200, body: responseBody }, summary: { durationMs: 1_000 },
  }]);

  assert.equal(view.request.userMessage.title, 'Connect DeepSeek');
  assert.equal(view.request.userMessage.instructions, 'Use every selected turn as the task scope.');
  assert.equal(view.request.evidence.projectRoot, 'F:\\agent-workbench');
  assert.deepEqual(view.request.parameters, {
    model: 'deepseek-v4-flash', stream: false,
    thinking: { type: 'disabled' }, max_tokens: 12_000,
  });
  assert.equal(view.response.content, '# Connect DeepSeek');
  assert.equal(view.response.finishReason, 'stop');
  assert.equal('rawRequest' in view, false);
});
