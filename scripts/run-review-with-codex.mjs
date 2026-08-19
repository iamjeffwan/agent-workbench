import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createCodexCliReviewModelAdapter,
  createInMemoryReviewStore,
  createReviewExecutor,
} from '../packages/review/dist/index.js';

const options = parseArgs(process.argv.slice(2).filter(argument => argument !== '--'));
if (!options.case || !options.evidence) {
  throw new Error('Usage: pnpm review:test:codex -- --case <case.json> --evidence <evidence.json> [--provider <id> --base-url <url> --api-key-env <name>]');
}
if (options.serviceTier && !['fast', 'flex'].includes(options.serviceTier)) {
  throw new Error('The service tier must be fast or flex.');
}

const reviewCase = JSON.parse(await fs.readFile(path.resolve(options.case), 'utf8'));
const evidencePackage = JSON.parse(await fs.readFile(path.resolve(options.evidence), 'utf8'));
const customProvider = customProviderFrom(options);
const store = createInMemoryReviewStore();
store.createCase(reviewCase);
const adapter = createCodexCliReviewModelAdapter({
  artifactDirectory: path.resolve(options.artifacts ?? '.review-runs'),
  workingDirectory: process.cwd(),
  model: options.model ?? 'gpt-5.6-sol',
  ...(options.executable ? { executable: path.resolve(options.executable) } : {}),
  ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
  ...(customProvider ? { customProvider } : {}),
});
const executor = createReviewExecutor({ store, adapter });
const result = await executor.execute({
  reviewCase,
  evidencePackage,
  promptVersion: options.promptVersion ?? 'review-prompt-1',
  reviewPolicyVersion: options.policyVersion ?? 'review-policy-1',
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.run.status !== 'completed') process.exitCode = 1;

function customProviderFrom(values) {
  const supplied = [values.provider, values.baseUrl, values.apiKeyEnv].filter(Boolean).length;
  if (supplied === 0) return undefined;
  if (supplied !== 3) {
    throw new Error('Custom provider requires --provider, --base-url, and --api-key-env together.');
  }
  return {
    id: values.provider,
    ...(values.providerName ? { name: values.providerName } : {}),
    baseUrl: values.baseUrl,
    apiKeyEnv: values.apiKeyEnv,
    ...(values.supportsWebSockets !== undefined
      ? { supportsWebSockets: parseBoolean(values.supportsWebSockets, '--supports-web-sockets') }
      : {}),
  };
}

function parseBoolean(value, option) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${option} must be true or false.`);
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = args[index + 1];
    if (!key || value === undefined) throw new Error(`Invalid argument: ${args[index] ?? ''}`);
    result[key] = value;
  }
  return result;
}
