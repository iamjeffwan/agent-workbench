import fs from 'node:fs/promises';
import path from 'node:path';

import { readCodexCliModelConfig } from '../packages/codex-cli-model/dist/index.js';

import {
  openLocalDatabase,
  resolveDefaultDatabasePath,
} from '../packages/local-database/dist/index.js';
import {
  findCodexSessions,
  readCodexSessionMetadata,
} from '../packages/codex-adapter/dist/index.js';
import {
  captureProjectState,
  deriveProjectTurnFacts,
} from '../packages/project-observation/dist/index.js';
import {
  createCodexCliReviewModelAdapter,
  createReviewExecutor,
  createSqliteReviewStore,
} from '../packages/review/dist/index.js';
import { createProjectObservationService } from '../apps/desktop/electron/project-observation-service.mjs';
import { createReviewObservationService } from '../apps/desktop/electron/review-observation-service.mjs';

const options = parseArgs(process.argv.slice(2).filter(argument => argument !== '--'));
const modelConfig = await readCodexCliModelConfig(path.resolve(options.modelConfig ?? 'config/review-model.json'));
const selection = await resolveSelection(options);
const projectObservation = createProjectObservationService({
  getUserDataPath: () => path.resolve(options.userData ?? path.join(selection.projectRoot, '.agent-workbench-local')),
  captureState: captureProjectState,
  deriveFacts: deriveProjectTurnFacts,
});
const reviewObservation = createReviewObservationService({
  resolveSessionFiles: (projectRoot, sessionIds) => resolveSessionFile(projectRoot, sessionIds, selection.sessionFile),
  readTask: selection.task ? () => ready(selection.task) : undefined,
  readProjectObservation: projectRoot => projectObservation.read(projectRoot),
});
const prepared = selection.task
  ? await reviewObservation.prepareFromTask(selection.task.id, { revision: options.revision })
  : await reviewObservation.prepareFromTurns({
      projectRoot: selection.projectRoot,
      sessionId: selection.sessionId,
      turnIds: selection.turnIds,
      ...(options.revision ? { revision: options.revision } : {}),
    });
if (prepared.status !== 'ready') throw new Error(prepared.error ?? 'Unable to prepare review inputs.');

if (options.prepareOnly === 'true') {
  process.stdout.write(`${JSON.stringify(prepared.data, null, 2)}\n`);
  process.exit(0);
}

const customProvider = customProviderFrom(options);
const databasePath = resolveDatabasePath(options);
const database = openLocalDatabase({ filePath: databasePath });
try {
  const store = createSqliteReviewStore({ database });
  await store.createCase(prepared.data.reviewCase);
  const adapter = createCodexCliReviewModelAdapter({
    artifactDirectory: path.resolve(options.artifacts ?? '.review-runs'),
    workingDirectory: selection.projectRoot,
    model: options.model ?? modelConfig.model,
    ...(options.modelVersion ? { modelVersion: options.modelVersion } : modelConfig.modelVersion ? { modelVersion: modelConfig.modelVersion } : {}),
    ...(options.executable ? { executable: path.resolve(options.executable) } : {}),
    ...(options.serviceTier ? { serviceTier: options.serviceTier } : modelConfig.serviceTier ? { serviceTier: modelConfig.serviceTier } : {}),
    ...(customProvider ? { customProvider } : modelConfig.provider ? { customProvider: modelConfig.provider } : {}),
  });
  const executor = createReviewExecutor({
    store,
    adapter,
    readRawReference: createRawReferenceReader(prepared.data.selection.sessionFile),
  });
  const result = await executor.execute({
    reviewCase: prepared.data.reviewCase,
    evidencePackage: prepared.data.evidencePackage,
    promptVersion: options.promptVersion ?? 'review-prompt-1',
    reviewPolicyVersion: options.policyVersion ?? 'review-policy-1',
  });

  process.stdout.write(`${JSON.stringify({
    preparation: {
      projectId: prepared.data.reviewCase.projectId,
      sourceType: prepared.data.reviewCase.sourceType,
      turnCount: prepared.data.reviewCase.turns.length,
      reviewability: prepared.data.evidencePackage.reviewability,
      evidenceGapCount: prepared.data.evidencePackage.gaps.length,
      projectContext: prepared.data.evidencePackage.projectContext
        ? {
            scope: prepared.data.evidencePackage.projectContext.scope,
            fileCount: prepared.data.evidencePackage.projectContext.files.length,
            hasDiff: Boolean(prepared.data.evidencePackage.projectContext.diff),
          }
        : null,
    },
    databasePath,
    result,
  }, null, 2)}\n`);
  if (result.run.status !== 'completed') process.exitCode = 1;
} finally {
  database.close();
}

function resolveDatabasePath(values) {
  if (values.database && values.dataDir) {
    throw new Error('Use either --database or --data-dir, not both.');
  }
  if (values.database) return path.resolve(values.database);
  if (values.dataDir) return path.join(path.resolve(values.dataDir), 'agent-workbench.db');
  return resolveDefaultDatabasePath();
}

function createRawReferenceReader(inputPath) {
  const sessionFile = path.resolve(inputPath);
  let linesPromise;
  return async rawRef => {
    const sourceFile = path.resolve(rawRef.sourceFile);
    if (!samePath(sourceFile, sessionFile) || !Number.isInteger(rawRef.line) || rawRef.line < 1) {
      return undefined;
    }
    linesPromise ??= fs.readFile(sessionFile, 'utf8').then(content => content.split(/\r?\n/));
    const lines = await linesPromise;
    return lines[rawRef.line - 1];
  };
}

async function resolveSelection(values) {
  if (values.taskFile) {
    const task = JSON.parse(await fs.readFile(path.resolve(values.taskFile), 'utf8'));
    if (!isTask(task)) throw new Error('The task file does not contain a valid task selection.');
    const sessionFile = await resolveSessionSource({
      projectRoot: task.projectRoot,
      sessionId: task.sessionId,
      explicitFile: task.evidence?.sessionFile,
    });
    return {
      task,
      projectRoot: path.resolve(task.projectRoot),
      sessionId: task.sessionId,
      turnIds: task.turnIds,
      sessionFile,
    };
  }

  const projectRoot = required(values.projectRoot, '--project-root');
  const sessionId = required(values.sessionId, '--session-id');
  const turnIds = values.turnId ?? [];
  if (turnIds.length === 0) throw new Error('Supply one or more --turn-id values, or use --task-file.');
  return {
    projectRoot: path.resolve(projectRoot),
    sessionId,
    turnIds: [...new Set(turnIds)],
    sessionFile: await resolveSessionSource({ projectRoot, sessionId, explicitFile: values.sessionFile }),
  };
}

async function resolveSessionSource({ projectRoot, sessionId, explicitFile }) {
  const candidates = explicitFile
    ? [path.resolve(explicitFile)]
    : findCodexSessions().filter(file => readCodexSessionMetadata(file)?.sessionId === sessionId);
  const matches = candidates.filter(file => {
    const metadata = readCodexSessionMetadata(file);
    return metadata?.sessionId === sessionId && samePath(metadata.cwd, projectRoot);
  });
  if (matches.length !== 1) {
    throw new Error('The selected Codex session cannot be resolved exactly for this project.');
  }
  return matches[0];
}

function resolveSessionFile(projectRoot, sessionIds, sessionFile) {
  if (!Array.isArray(sessionIds) || sessionIds.length !== 1) {
    return failed(null, 'Exactly one selected Codex session is required.');
  }
  const metadata = readCodexSessionMetadata(sessionFile);
  if (metadata?.sessionId !== sessionIds[0] || !samePath(metadata.cwd, projectRoot)) {
    return failed(null, 'The resolved Codex session does not match the selected project.');
  }
  return ready({ sessionFiles: [sessionFile] });
}

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

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = args[index + 1];
    if (!key || value === undefined) throw new Error(`Invalid argument: ${args[index] ?? ''}`);
    if (key === 'turnId') {
      result.turnId = [...(result.turnId ?? []), value];
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isTask(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.id === 'string'
    && typeof value.projectRoot === 'string'
    && typeof value.sessionId === 'string'
    && Array.isArray(value.turnIds)
    && value.turnIds.every(item => typeof item === 'string' && item.trim());
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const normalize = value => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function parseBoolean(value, option) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${option} must be true or false.`);
}

function ready(data) {
  return { status: 'ready', data, error: null };
}

function failed(data, error) {
  return { status: 'error', data, error };
}
