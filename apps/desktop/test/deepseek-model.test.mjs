import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDeepSeekModelService } from '../electron/deepseek-model.mjs';

test('stores credentials separately and captures complete DeepSeek call lifecycles', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-deepseek-'));
  const legacyDirectory = path.join(userData, 'model-calls');
  fs.mkdirSync(legacyDirectory, { recursive: true });
  fs.writeFileSync(path.join(legacyDirectory, 'model-calls.jsonl'), [
    JSON.stringify({
      version: 1, event: 'request.started', callId: 'legacy-call',
      timestamp: '2026-08-10T00:00:00.000Z', context: { purpose: 'legacy' },
      model: 'deepseek-v4-flash', request: { body: '{"legacy":true}' },
    }),
    JSON.stringify({
      version: 1, event: 'response.completed', callId: 'legacy-call',
      timestamp: '2026-08-10T00:00:01.000Z', response: { body: '{"ok":true}' },
      summary: { durationMs: 1_000, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }),
  ].join('\n') + '\n', 'utf8');
  const requests = [];
  const service = createDeepSeekModelService({
    getUserDataPath: () => userData,
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: value => value.toString('utf8').replace(/^encrypted:/, ''),
    env: {},
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (requests.length > 1) {
        return new Response(JSON.stringify({
          error: { message: 'Account balance is insufficient.' },
        }), { status: 402, statusText: 'Payment Required', headers: { 'x-request-id': 'failed-one' } });
      }
      return new Response(JSON.stringify({
        id: 'completion-one',
        model: 'deepseek-v4-flash',
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const saved = service.saveApiKey('sk-test-secret');
  assert.equal(saved.status, 'ready');
  assert.equal(saved.data.configured, true);
  assert.equal(saved.data.credentialSource, 'saved');

  const credentialFile = fs.readFileSync(path.join(userData, 'model-credentials.json'), 'utf8');
  assert.doesNotMatch(credentialFile, /sk-test-secret/);

  const result = await service.complete({
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    maxTokens: 8,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.data.content, 'OK');
  assert.equal(result.data.usage.totalTokens, 9);
  assert.equal(typeof result.data.callId, 'string');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer sk-test-secret');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    stream: false,
    thinking: { type: 'disabled' },
    max_tokens: 8,
  });

  const history = service.listCalls();
  assert.equal(history.status, 'ready');
  assert.equal(history.data.length, 2);
  const completedSummary = history.data.find(call => call.callId === result.data.callId);
  assert.equal(completedSummary.purpose, 'model-call');
  assert.equal(completedSummary.status, 'completed');
  assert.equal(completedSummary.totalTokens, 9);
  assert.equal(service.readCall('legacy-call').data[0].request.body, '{"legacy":true}');

  const details = service.readCall(result.data.callId);
  assert.equal(details.status, 'ready');
  assert.deepEqual(details.data.map(event => event.event), [
    'request.started',
    'response.completed',
  ]);
  assert.equal(details.data[0].request.headers.Authorization, 'Bearer sk-test-secret');
  assert.equal(details.data[0].request.body, JSON.stringify({
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    stream: false,
    thinking: { type: 'disabled' },
    max_tokens: 8,
  }));
  assert.match(details.data[1].response.body, /"content":"OK"/);
  assert.equal(details.data[1].summary.totalTokens, 9);

  const callDirectory = path.join(userData, 'model-calls', 'calls', result.data.callId);
  const eventLog = fs.readFileSync(path.join(userData, 'model-calls', 'calls.jsonl'), 'utf8');
  assert.doesNotMatch(eventLog, /Reply with OK\.|sk-test-secret|"content":"OK"/);
  assert.equal(
    fs.readFileSync(path.join(callDirectory, 'request-body.json'), 'utf8'),
    requests[0].init.body,
  );
  assert.match(
    fs.readFileSync(path.join(callDirectory, 'response-body.json'), 'utf8'),
    /"content":"OK"/,
  );

  const failed = await service.complete({
    messages: [{ role: 'user', content: 'Create a task document.' }],
  }, { purpose: 'task-document', projectRoot: 'F:\\project', taskId: 'task-one' });
  assert.equal(failed.status, 'error');
  assert.match(failed.error, /balance is insufficient/);

  const failedSummary = service.listCalls().data.find(call => call.status === 'failed');
  assert.equal(failedSummary.purpose, 'task-document');
  assert.equal(failedSummary.projectRoot, 'F:\\project');
  assert.equal(failedSummary.taskId, 'task-one');
  const failedDetails = service.readCall(failedSummary.callId).data;
  assert.deepEqual(failedDetails.map(event => event.event), [
    'request.started',
    'response.failed',
  ]);
  assert.equal(failedDetails[1].response.status, 402);
  assert.match(failedDetails[1].response.body, /Account balance is insufficient/);
  assert.match(failedDetails[1].error.message, /Account balance is insufficient/);
});
