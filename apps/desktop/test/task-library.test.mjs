import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createFlowDocumentGenerator } from '../electron/flow-document-generator.mjs';
import { createTaskLibraryService, suggestTaskTitle } from '../electron/task-library.mjs';

test('creates immediately, reports generation state and persists model output', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-task-library-'));
  const projectRoot = path.join(userData, 'project');
  const sessionFile = path.join(userData, 'rollout-task.jsonl');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(sessionFile, '', 'utf8');
  const modelCalls = [];
  const updates = [];
  const skillDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../resources/skills/generate-task-flow-document',
  );
  const generator = createFlowDocumentGenerator({
    skillDirectory,
    completeModel: async (input, context) => {
      modelCalls.push({ input, context });
      return {
        status: 'ready',
        source: 'deepseek',
        data: {
          callId: 'model-call-one',
          model: 'deepseek-v4-flash',
          content: generatedMarkdown(),
          finishReason: 'length',
          usage: { inputTokens: 900, outputTokens: 300, totalTokens: 1_200 },
        },
        error: null,
      };
    },
  });
  const createService = () => createTaskLibraryService({
    getUserDataPath: () => userData,
    now: () => new Date('2026-08-11T05:00:00.000Z'),
    createId: () => 'task-one',
    generateDocument: input => generator.generate(input),
    onChange: task => updates.push(task),
    resolveSessionFiles: (_projectRoot, conversationIds) => ({
      status: 'ready',
      source: 'codex-rollout',
      data: { sessionFiles: [sessionFile], conversationIds },
      error: null,
    }),
    readTaskEvidence: () => ({
      conversationId: 'conversation-one',
      projectRoot,
      sessionFile,
      requestedTurnIds: ['turn-one'],
      missingTurnIds: [],
      turns: [{
        id: 'turn-one',
        conversationId: 'conversation-one',
        cwd: projectRoot,
        userInput: 'Implement the history task',
        startedAt: '2026-08-11T04:00:00.000Z',
        updatedAt: '2026-08-11T04:00:06.000Z',
        status: 'completed',
        metrics: {
          durationMs: 6_000,
          timeToFirstTokenMs: 400,
          tokens: {
            input: 100, cachedInput: 25, cacheWriteInput: 0,
            output: 20, reasoningOutput: 5, total: 120,
          },
        },
        events: [{
          kind: 'tool-call',
          timestamp: '2026-08-11T04:00:02.000Z',
          name: 'exec_command',
          detail: '{"cmd":"pnpm test"}',
          callId: 'call-one',
          success: null,
          source: { sessionFile, line: 12 },
        }, {
          kind: 'tool-result',
          timestamp: '2026-08-11T04:00:03.000Z',
          name: 'Tool result',
          detail: `OUTPUT-START\n${'unrelated output\n'.repeat(20_000)}OUTPUT-END`,
          callId: 'call-one',
          success: true,
          source: { sessionFile, line: 13 },
        }],
      }],
    }),
  });

  const service = createService();
  const created = service.createTask({
    projectRoot,
    conversationId: 'conversation-one',
    turnIds: ['turn-one'],
  });

  assert.equal(created.status, 'ready');
  assert.equal(created.data.status, 'generating');
  assert.equal(created.data.document, null);
  await new Promise(resolve => setImmediate(resolve));
  const completed = service.readTask('task-one').data;
  assert.equal(completed.status, 'ready', completed.error);
  assert.match(completed.document.markdown, /Implement the history task/);
  assert.match(completed.document.markdown, /Human review decides whether this document is useful/);
  assert.doesNotMatch(completed.document.markdown, /unselected/);
  assert.equal(completed.document.generator.callId, 'model-call-one');
  assert.equal(completed.document.projectFile, 'docs/task-flows/2026-08-11-implement-the-history-task.md');
  assert.equal(
    fs.readFileSync(path.join(projectRoot, ...completed.document.projectFile.split('/')), 'utf8'),
    completed.document.markdown,
  );
  assert.equal(completed.document.generator.skill.name, 'generate-task-flow-document');
  assert.deepEqual(updates.map(change => change.reason), ['generation-queued', 'generation-started', 'generation-ready']);
  assert.deepEqual(updates.map(change => change.task.status), ['queued', 'generating', 'ready']);
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].context.purpose, 'task-flow-document');
  assert.equal(modelCalls[0].context.taskId, 'task-one');
  assert.match(modelCalls[0].input.messages[0].content, /closed world/i);
  assert.match(modelCalls[0].input.messages[0].content, /do not print source locations/i);
  assert.match(modelCalls[0].input.messages[0].content, /at most 12/i);
  assert.match(modelCalls[0].input.messages[1].content, /exec_command/);
  assert.match(modelCalls[0].input.messages[1].content, /OUTPUT-START/);
  assert.match(modelCalls[0].input.messages[1].content, /OUTPUT-END/);
  assert.match(modelCalls[0].input.messages[1].content, /omittedChars/);
  assert.ok(modelCalls[0].input.messages[1].content.length < 20_000);
  assert.equal(modelCalls[0].input.thinking, false);
  assert.equal(modelCalls[0].input.maxTokens, 12_000);
  assert.equal(modelCalls[0].context.timeoutMs, 300_000);

  const scripted = service.saveScript('task-one', {
    title: 'Verify generated document',
    language: 'shell',
    content: 'pnpm test',
  });
  assert.equal(scripted.status, 'ready');
  assert.deepEqual(scripted.data.scripts.map(script => ({
    title: script.title,
    language: script.language,
    content: script.content,
    status: script.status,
  })), [{
    title: 'Verify generated document',
    language: 'shell',
    content: 'pnpm test',
    status: 'draft',
  }]);

  const restarted = createService();
  assert.deepEqual(restarted.listTasks(projectRoot).data.map(task => task.id), ['task-one']);
  assert.equal(restarted.readTask('task-one').data.document.markdown, completed.document.markdown);
  assert.equal(restarted.readTask('task-one').data.scripts[0].title, 'Verify generated document');
});

test('uses a short meaningful local title when the prompt starts with a link', () => {
  assert.equal(suggestTaskTitle([{ userInput: '[https://api-docs.deepseek.com/](https://api-docs.deepseek.com/)\n我们接入 DeepSeek 的 API Key 来调用模型。' }]), '接入 DeepSeek 的 API Key 来调用模型');
});

function generatedMarkdown() {
  return `# Implement the history task

Human review decides whether this document is useful.
`;
}
