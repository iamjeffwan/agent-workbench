import fs from 'node:fs/promises';
import path from 'node:path';

import { readCodexCliModelConfig } from '../packages/codex-cli-model/dist/index.js';

import {
  createCodexCliReviewModelAdapter,
  createInMemoryReviewStore,
  createReviewExecutor,
  enrichReviewEvidencePackageFromProject,
} from '../packages/review/dist/index.js';

const options = parseArgs(process.argv.slice(2).filter(argument => argument !== '--'));
if (!options.case || !options.evidence) {
  throw new Error('Usage: pnpm review:test:codex -- --case <case.json> --evidence <evidence.json> [--model-config <file>] [--project-root <directory>] [--raw-session-file <session.jsonl>]');
}
const modelConfig = await readCodexCliModelConfig(path.resolve(options.modelConfig ?? 'config/review-model.json'));
if (options.serviceTier && !['fast', 'flex'].includes(options.serviceTier)) {
  throw new Error('The service tier must be fast or flex.');
}

const reviewCase = JSON.parse(await fs.readFile(path.resolve(options.case), 'utf8'));
let evidencePackage = JSON.parse(await fs.readFile(path.resolve(options.evidence), 'utf8'));
if (options.projectRoot) {
  evidencePackage = await enrichReviewEvidencePackageFromProject({
    evidencePackage,
    repositoryRoot: path.resolve(options.projectRoot),
    ...(options.revision ? { revision: options.revision } : {}),
  });
}
const customProvider = customProviderFrom(options);
const store = createInMemoryReviewStore();
await store.createCase(reviewCase);
const adapter = createCodexCliReviewModelAdapter({
  artifactDirectory: path.resolve(options.artifacts ?? '.review-runs'),
  workingDirectory: process.cwd(),
  model: options.model ?? modelConfig.model,
  ...(options.modelVersion ? { modelVersion: options.modelVersion } : modelConfig.modelVersion ? { modelVersion: modelConfig.modelVersion } : {}),
  ...(options.executable ? { executable: path.resolve(options.executable) } : {}),
  ...(options.serviceTier ? { serviceTier: options.serviceTier } : modelConfig.serviceTier ? { serviceTier: modelConfig.serviceTier } : {}),
  ...(customProvider ? { customProvider } : modelConfig.provider ? { customProvider: modelConfig.provider } : {}),
});
const executor = createReviewExecutor({
  store,
  adapter,
  ...(options.rawSessionFile
    ? { readRawReference: createRawReferenceReader(options.rawSessionFile) }
    : {}),
});
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

function createRawReferenceReader(inputPath) {
  const sessionFile = path.resolve(inputPath);
  let linesPromise;
  return async rawRef => {
    const sourceFile = path.resolve(rawRef.sourceFile);
    if (sourceFile !== sessionFile || !Number.isInteger(rawRef.line) || rawRef.line < 1) return undefined;
    linesPromise ??= fs.readFile(sessionFile, 'utf8').then(content => content.split(/\r?\n/));
    const lines = await linesPromise;
    return lines[rawRef.line - 1];
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
