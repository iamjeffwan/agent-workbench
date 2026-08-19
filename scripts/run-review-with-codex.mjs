import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createCodexCliReviewModelAdapter,
  createInMemoryReviewStore,
  createReviewExecutor,
} from '../packages/review/dist/index.js';

const options = parseArgs(process.argv.slice(2).filter(argument => argument !== '--'));
if (!options.case || !options.evidence) {
  throw new Error('Usage: pnpm review:test:codex -- --case <case.json> --evidence <evidence.json> [--artifacts <directory>]');
}
if (options.serviceTier && !['fast', 'flex'].includes(options.serviceTier)) {
  throw new Error('The service tier must be fast or flex.');
}

const reviewCase = JSON.parse(await fs.readFile(path.resolve(options.case), 'utf8'));
const evidencePackage = JSON.parse(await fs.readFile(path.resolve(options.evidence), 'utf8'));
const store = createInMemoryReviewStore();
store.createCase(reviewCase);
const adapter = createCodexCliReviewModelAdapter({
  artifactDirectory: path.resolve(options.artifacts ?? '.review-runs'),
  workingDirectory: process.cwd(),
  model: options.model ?? 'gpt-5.6-sol',
  ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
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
