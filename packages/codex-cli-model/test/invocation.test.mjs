import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CodexCliInvocationError,
  createCodexCliStructuredModel,
  readCodexCliModelConfig,
} from '../dist/index.js';

test('invokes Codex CLI with an output schema and returns structured output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-cli-model-'));
  const commands = [];
  const model = createCodexCliStructuredModel({
    artifactDirectory: root,
    workingDirectory: process.cwd(),
    executable: path.join(root, 'codex.ps1'),
    serviceTier: 'fast',
    runCommand: async command => {
      commands.push(command);
      const outputPath = command.args[command.args.indexOf('--output-last-message') + 1];
      await writeFile(outputPath, JSON.stringify({ answer: 'ok' }), 'utf8');
    },
  });

  const response = await model.invoke({
    invocationId: 'invocation-1',
    prompt: 'Return an answer.',
    outputSchema: { type: 'object' },
  });

  assert.deepEqual(response.output, { answer: 'ok' });
  assert.ok(commands[0].args.includes('read-only'));
  assert.ok(commands[0].args.includes('--ephemeral'));
  assert.ok(commands[0].args.includes('service_tier="fast"'));
  assert.equal(commands[0].input, 'Return an answer.');
  assert.deepEqual(response.artifacts.map(item => item.kind), [
    'request',
    'output_schema',
    'model_output',
  ]);
});

test('configures a Responses-compatible third-party provider without passing a secret value', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-cli-provider-'));
  const commands = [];
  const model = createCodexCliStructuredModel({
    artifactDirectory: root,
    workingDirectory: process.cwd(),
    provider: {
      id: 'third_party',
      name: 'Review gateway',
      baseUrl: 'https://gateway.example.test/v1/',
      apiKeyEnv: 'REVIEW_GATEWAY_API_KEY',
    },
    runCommand: async command => {
      commands.push(command);
      const outputPath = command.args[command.args.indexOf('--output-last-message') + 1];
      await writeFile(outputPath, JSON.stringify({ answer: 'ok' }), 'utf8');
    },
  });

  await model.invoke({ invocationId: 'provider-1', prompt: 'Review.', outputSchema: {} });

  const args = commands[0].args.join(' ');
  assert.equal(model.descriptor.provider, 'third_party');
  assert.equal(commands[0].requiredEnvironmentVariable, 'REVIEW_GATEWAY_API_KEY');
  assert.match(args, /model_provider="third_party"/);
  assert.match(args, /wire_api="responses"/);
  assert.match(args, /env_key="REVIEW_GATEWAY_API_KEY"/);
  assert.doesNotMatch(args, /secret-value/);
});

test('preserves artifacts when output is malformed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-cli-malformed-'));
  const model = createCodexCliStructuredModel({
    artifactDirectory: root,
    workingDirectory: process.cwd(),
    runCommand: async command => {
      const outputPath = command.args[command.args.indexOf('--output-last-message') + 1];
      await writeFile(outputPath, 'not-json', 'utf8');
    },
  });

  await assert.rejects(
    model.invoke({ invocationId: 'malformed-1', prompt: 'Review.', outputSchema: {} }),
    error => error instanceof CodexCliInvocationError
      && error.artifacts.some(item => item.kind === 'model_output'),
  );
});

test('rejects unsafe provider configuration before execution', () => {
  const common = { artifactDirectory: '.', workingDirectory: '.' };
  assert.throws(() => createCodexCliStructuredModel({
    ...common,
    provider: { id: 'openai', baseUrl: 'https://example.test', apiKeyEnv: 'KEY' },
  }), /reserved/);
  assert.throws(() => createCodexCliStructuredModel({
    ...common,
    provider: { id: 'third_party', baseUrl: 'http://remote.example.test', apiKeyEnv: 'KEY' },
  }), /HTTPS/);
  assert.throws(() => createCodexCliStructuredModel({
    ...common,
    provider: { id: 'third_party', baseUrl: 'https://example.test', apiKeyEnv: 'actual-key-value' },
  }), /variable name is invalid/);
});

test('reads a secret-free model configuration file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-cli-config-'));
  const file = path.join(root, 'review-model.json');
  await writeFile(file, JSON.stringify({
    schemaVersion: 'codex-cli-model-config-1',
    model: 'gateway-review-model',
    serviceTier: 'flex',
    provider: {
      id: 'company_gateway',
      baseUrl: 'https://gateway.example.test/v1/',
      apiKeyEnv: 'COMPANY_GATEWAY_API_KEY',
    },
  }), 'utf8');

  const config = await readCodexCliModelConfig(file);

  assert.deepEqual(config, {
    schemaVersion: 'codex-cli-model-config-1',
    model: 'gateway-review-model',
    serviceTier: 'flex',
    provider: {
      id: 'company_gateway',
      baseUrl: 'https://gateway.example.test/v1',
      apiKeyEnv: 'COMPANY_GATEWAY_API_KEY',
    },
  });
});

test('rejects model configuration containing a secret field', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-cli-config-secret-'));
  const file = path.join(root, 'review-model.json');
  await writeFile(file, JSON.stringify({
    schemaVersion: 'codex-cli-model-config-1',
    model: 'gateway-review-model',
    provider: {
      id: 'company_gateway',
      baseUrl: 'https://gateway.example.test/v1',
      apiKeyEnv: 'COMPANY_GATEWAY_API_KEY',
      apiKey: 'secret-value',
    },
  }), 'utf8');

  await assert.rejects(readCodexCliModelConfig(file), /unsupported field/i);
});
