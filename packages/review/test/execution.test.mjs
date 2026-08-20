import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import test from 'node:test';

import {
  createCodexCliReviewModelAdapter,
  createInMemoryReviewModelAdapter,
  createInMemoryReviewStore,
  createReviewExecutor,
} from '../dist/index.js';

test('executes a review through a replaceable adapter and records evidence-backed results', async () => {
  const store = createInMemoryReviewStore();
  const reviewCase = selectedCase();
  store.createCase(reviewCase);
  const adapter = createInMemoryReviewModelAdapter({
    descriptor: { provider: 'test-provider', model: 'test-model', transport: 'test' },
    response: { output: modelOutput(), usage: { totalTokens: 42 }, actualCost: 0.01 },
  });
  const executor = deterministicExecutor(store, adapter);

  const result = await executor.execute(executionInput(reviewCase));

  assert.equal(result.run.status, 'completed');
  assert.equal(result.run.invocation.model, 'test-model');
  assert.equal(result.run.usage.totalTokens, 42);
  assert.equal(result.judgements[0].runId, result.run.runId);
  assert.equal(result.evidence[0].judgementId, result.judgements[0].judgementId);
  assert.equal(adapter.requests.length, 1);
  assert.equal(store.getCase(reviewCase.caseId).runs.length, 1);
});

test('switches providers without changing the executor contract', async () => {
  const first = await runWithDescriptor({ provider: 'anthropic', model: 'claude-review', transport: 'api' });
  const second = await runWithDescriptor({ provider: 'deepseek', model: 'deepseek-review', transport: 'api' });

  assert.deepEqual(
    [first.run.invocation.provider, second.run.invocation.provider],
    ['anthropic', 'deepseek'],
  );
});

test('records model failures and rejects fabricated evidence targets', async () => {
  const reviewCase = selectedCase();
  const store = createInMemoryReviewStore();
  store.createCase(reviewCase);
  const output = modelOutput();
  output.judgements[0].evidence[0].targetId = 'event-not-in-package';
  const adapter = createInMemoryReviewModelAdapter({ response: { output } });

  const result = await deterministicExecutor(store, adapter).execute(executionInput(reviewCase));

  assert.equal(result.run.status, 'failed');
  assert.match(result.run.failureReason, /target does not exist/);
  assert.equal(store.getCase(reviewCase.caseId).judgements.length, 0);
});

test('does not call a model when canonical evidence is insufficient', async () => {
  const reviewCase = selectedCase();
  const store = createInMemoryReviewStore();
  store.createCase(reviewCase);
  const adapter = createInMemoryReviewModelAdapter({ response: { output: modelOutput() } });
  const input = executionInput(reviewCase);
  input.evidencePackage.reviewability = 'insufficient';
  input.evidencePackage.gaps = [{
    code: 'missing_turn',
    sessionId: 'session-1',
    turnId: 'turn-1',
    description: 'Turn unavailable.',
  }];

  const result = await deterministicExecutor(store, adapter).execute(input);

  assert.equal(result.run.status, 'failed');
  assert.equal(adapter.requests.length, 0);
});

test('builds an isolated read-only Codex CLI invocation and preserves run artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-codex-adapter-'));
  const commands = [];
  const adapter = createCodexCliReviewModelAdapter({
    artifactDirectory: root,
    workingDirectory: process.cwd(),
    executable: path.join(root, 'codex.ps1'),
    serviceTier: 'fast',
    runCommand: async command => {
      commands.push(command);
      const outputPath = command.args[command.args.indexOf('--output-last-message') + 1];
      await writeFile(outputPath, JSON.stringify(modelOutput()), 'utf8');
    },
  });

  const response = await adapter.review(codexRequest('run-codex-1'));

  assert.equal(adapter.descriptor.model, 'gpt-5.6-sol');
  assert.deepEqual(response.output, modelOutput());
  assert.equal(commands[0].executable, path.join(root, 'codex.ps1'));
  assert.ok(commands[0].args.includes('read-only'));
  assert.ok(commands[0].args.includes('--skip-git-repo-check'));
  assert.ok(commands[0].args.includes(path.join(root, 'run-codex-1')));
  assert.ok(commands[0].args.includes('service_tier="fast"'));
  assert.ok(commands[0].args.includes('--ephemeral'));
  assert.ok(commands[0].input.includes('Evidence package'));
});

test('configures a custom Codex provider using only an API key environment variable name', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-custom-provider-'));
  const commands = [];
  const adapter = createCodexCliReviewModelAdapter({
    artifactDirectory: root,
    workingDirectory: process.cwd(),
    customProvider: {
      id: 'third_party',
      name: 'Review gateway',
      baseUrl: 'https://gateway.example.test/v1/',
      apiKeyEnv: 'REVIEW_GATEWAY_API_KEY',
    },
    runCommand: async command => {
      commands.push(command);
      const outputPath = command.args[command.args.indexOf('--output-last-message') + 1];
      await writeFile(outputPath, JSON.stringify(modelOutput()), 'utf8');
    },
  });

  await adapter.review(codexRequest('run-provider-1'));

  const args = commands[0].args.join(' ');
  assert.equal(adapter.descriptor.provider, 'third_party');
  assert.equal(commands[0].requiredEnvironmentVariable, 'REVIEW_GATEWAY_API_KEY');
  assert.match(args, /model_provider="third_party"/);
  assert.match(args, /base_url="https:\/\/gateway\.example\.test\/v1"/);
  assert.match(args, /env_key="REVIEW_GATEWAY_API_KEY"/);
  assert.match(args, /supports_websockets=false/);
  assert.doesNotMatch(args, /secret-value/);
});

test('rejects unsafe custom Codex provider configuration before execution', () => {
  const common = { artifactDirectory: '.', workingDirectory: '.' };
  assert.throws(() => createCodexCliReviewModelAdapter({
    ...common,
    customProvider: { id: 'openai', baseUrl: 'https://example.test', apiKeyEnv: 'KEY' },
  }), /reserved/);
  assert.throws(() => createCodexCliReviewModelAdapter({
    ...common,
    customProvider: { id: 'third_party', baseUrl: 'http://remote.example.test', apiKeyEnv: 'KEY' },
  }), /HTTPS/);
  assert.throws(() => createCodexCliReviewModelAdapter({
    ...common,
    customProvider: { id: 'third_party', baseUrl: 'https://example.test', apiKeyEnv: 'actual-key-value' },
  }), /variable name is invalid/);
});

test('accepts model evidence that cites collected project diff and file targets', async () => {
  const reviewCase = selectedCase();
  const store = createInMemoryReviewStore();
  store.createCase(reviewCase);
  const input = executionInput(reviewCase);
  input.evidencePackage.projectContext = {
    contextSchemaVersion: 'review-project-context-1',
    scope: 'working_tree',
    diff: {
      targetId: 'working-tree-diff', content: 'diff content', contentHash: 'diff-hash', truncated: false,
    },
    files: [{
      path: 'src/parser.ts', roles: ['changed'], content: 'source', contentHash: 'file-hash', truncated: false,
    }],
    omissions: [],
    limits: { maxFiles: 1, maxFileChars: 100, maxTotalFileChars: 100, maxDiffChars: 100 },
  };
  const output = modelOutput();
  output.judgements[0].evidence = [
    { ...output.judgements[0].evidence[0], targetType: 'project_diff', targetId: 'working-tree-diff' },
    { ...output.judgements[0].evidence[0], targetType: 'project_file', targetId: 'src/parser.ts' },
  ];
  const adapter = createInMemoryReviewModelAdapter({ response: { output } });

  const result = await deterministicExecutor(store, adapter).execute(input);

  assert.equal(result.run.status, 'completed');
  assert.deepEqual(result.evidence.map(item => item.targetType), ['project_diff', 'project_file']);
});

async function runWithDescriptor(descriptor) {
  const reviewCase = selectedCase();
  const store = createInMemoryReviewStore();
  store.createCase(reviewCase);
  const adapter = createInMemoryReviewModelAdapter({ descriptor, response: { output: modelOutput() } });
  return deterministicExecutor(store, adapter).execute(executionInput(reviewCase));
}

function deterministicExecutor(store, adapter) {
  let time = 0;
  let id = 0;
  return createReviewExecutor({
    store,
    adapter,
    now: () => new Date(`2026-08-19T05:00:0${time++}.000Z`),
    createId: kind => `${kind}-${++id}`,
  });
}

function executionInput(reviewCase) {
  return {
    reviewCase,
    evidencePackage: evidencePackage(),
    promptVersion: 'review-prompt-1',
    reviewPolicyVersion: 'review-policy-1',
  };
}

function codexRequest(runId) {
  return {
    runId,
    reviewCase: selectedCase(),
    evidencePackage: evidencePackage(),
    systemPrompt: 'Review only supplied evidence.',
    outputSchema: { type: 'object' },
  };
}

function selectedCase() {
  return {
    caseId: 'case-execution',
    projectId: 'project-1',
    sourceType: 'manual_turn_selection',
    turns: [{ sessionId: 'session-1', turnId: 'turn-1' }],
    createdAt: '2026-08-19T04:59:00.000Z',
  };
}

function evidencePackage() {
  return {
    schemaVersion: '1.0-draft',
    evidenceSchemaVersion: 'review-evidence-1',
    caseId: 'case-execution',
    projectId: 'project-1',
    builtAt: '2026-08-19T05:00:00.000Z',
    reviewability: 'sufficient',
    gaps: [],
    turns: [{
      sessionId: 'session-1',
      turnId: 'turn-1',
      sequence: 0,
      status: 'completed',
      userInput: 'Review this change.',
      events: [{
        eventId: 'event-1',
        turnId: 'turn-1',
        sequence: 0,
        type: 'message',
        sourceAgent: 'codex',
        sourceVersion: '1.0.0',
        sourceEventType: 'message',
        adapterVersion: '0.1.0',
        provenance: 'direct',
        fidelity: 'full',
        rawRef: { sourceFile: 'session.jsonl', line: 1, sourceType: 'message' },
        actor: 'user',
        content: 'Review this change.',
      }],
      source: {
        agent: 'codex',
        sourceVersion: '1.0.0',
        adapterVersion: '0.1.0',
        capabilityManifest: { agent: 'codex', capabilities: {} },
      },
    }],
  };
}

function modelOutput() {
  return {
    judgements: [{
      category: 'testability',
      title: 'Missing failure-path test',
      summary: 'The failure path is not covered.',
      severity: 'medium',
      confidence: 0.9,
      impact: 'A regression could be missed.',
      alternativeExplanation: 'An external suite may cover the path.',
      recommendation: 'Add a focused failure-path test.',
      reviewability: 'sufficient',
      issueFingerprint: 'testability:failure-path',
      evidence: [{
        evidenceType: 'missing_test',
        targetType: 'event',
        targetId: 'event-1',
        description: 'The observed turn contains no failure-path test action.',
        cachedExcerpt: 'Review this change.',
        contentHash: '',
      }],
    }],
  };
}
