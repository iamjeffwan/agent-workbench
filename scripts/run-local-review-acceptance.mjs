import fs from 'node:fs/promises';
import path from 'node:path';

import { createRunOwnership } from './local-operation-safety.mjs';

import { openLocalDatabase } from '../packages/local-database/dist/index.js';
import { readCodexSessionMetadata } from '../packages/codex-adapter/dist/index.js';
import {
  captureProjectState,
  deriveProjectTurnFacts,
} from '../packages/project-observation/dist/index.js';
import {
  createInMemoryReviewModelAdapter,
  createReviewExecutor,
  createSqliteReviewStore,
} from '../packages/review/dist/index.js';
import { createProjectObservationService } from '../apps/desktop/electron/project-observation-service.mjs';
import { createReviewObservationService } from '../apps/desktop/electron/review-observation-service.mjs';

const options = parseArgs(process.argv.slice(2).filter(argument => argument !== '--'));
const projectRoot = requiredPath(options.projectRoot, '--project-root');
const sessionFile = requiredPath(options.sessionFile, '--session-file');
const sessionId = requiredText(options.sessionId, '--session-id');
const turnId = requiredText(options.turnId, '--turn-id');
const databasePath = requiredPath(options.database, '--database');
const acceptanceStatePath = path.join(projectRoot, '.agent-workbench-local-acceptance');
const ownership = createRunOwnership();
if (!await pathExists(acceptanceStatePath)) {
  await fs.mkdir(acceptanceStatePath, { recursive: true });
  ownership.registerCreatedPath(acceptanceStatePath);
}

const metadata = readCodexSessionMetadata(sessionFile);
if (metadata?.sessionId !== sessionId || !samePath(metadata.cwd, projectRoot)) {
  throw new Error('The supplied session file does not match the project and session identifiers.');
}

const projectObservation = createProjectObservationService({
  getUserDataPath: () => acceptanceStatePath,
  captureState: captureProjectState,
  deriveFacts: deriveProjectTurnFacts,
});
const reviewObservation = createReviewObservationService({
  resolveSessionFiles: (root, sessionIds) => {
    if (sessionIds.length !== 1 || !samePath(root, projectRoot) || sessionIds[0] !== sessionId) {
      return { status: 'error', data: null, error: 'The acceptance session selection is not exact.' };
    }
    return { status: 'ready', data: { sessionFiles: [sessionFile] }, error: null };
  },
  readProjectObservation: root => projectObservation.read(root),
});
const prepared = await reviewObservation.prepareFromTurns({
  projectRoot,
  sessionId,
  turnIds: [turnId],
});
if (prepared.status !== 'ready') throw new Error(prepared.error ?? 'Unable to prepare acceptance evidence.');

const firstEvent = prepared.data.evidencePackage.turns[0]?.events[0];
if (!firstEvent) throw new Error('The selected real observation has no event to cite.');

const database = openLocalDatabase({ filePath: databasePath });
try {
  const store = createSqliteReviewStore({ database });
  await store.createCase(prepared.data.reviewCase);
  const adapter = createInMemoryReviewModelAdapter({
    descriptor: {
      provider: 'local-acceptance',
      model: 'deterministic-fixture-v1',
      transport: 'local',
    },
    response: {
      output: {
        judgements: [{
          category: 'testability',
          title: '本地验收判断',
          summary: '使用真实观测证据完成本地数据库验收。',
          severity: 'low',
          confidence: 1,
          impact: '用于验证判断、证据和人工确认的持久化链路。',
          alternativeExplanation: '这是确定性验收结果，不代表外部模型结论。',
          recommendation: '完成数据库闭环后再进入下一阶段功能开发。',
          reviewability: 'sufficient',
          issueFingerprint: 'local-acceptance:database-flow',
          evidence: [{
            evidenceType: 'observed_turn',
            targetType: 'event',
            targetId: firstEvent.eventId,
            description: '引用真实观测回合中的首条事件。',
            cachedExcerpt: firstEvent.content ?? firstEvent.type,
            contentHash: '',
          }],
        }],
      },
    },
  });
  const executor = createReviewExecutor({
    store,
    adapter,
    readRawReference: createRawReferenceReader(sessionFile),
  });
  const result = await executor.execute({
    reviewCase: prepared.data.reviewCase,
    evidencePackage: prepared.data.evidencePackage,
    promptVersion: 'local-acceptance-prompt-1',
    reviewPolicyVersion: 'local-acceptance-policy-1',
  });
  process.stdout.write(`${JSON.stringify({
    databasePath,
    caseId: prepared.data.reviewCase.caseId,
    sessionId,
    turnId,
    reviewability: prepared.data.evidencePackage.reviewability,
    run: result.run,
    judgementIds: result.judgements.map(item => item.judgementId),
    evidenceIds: result.evidence.map(item => item.evidenceId),
    ownedPaths: ownership.records(),
  }, null, 2)}\n`);
  if (result.run.status !== 'completed') process.exitCode = 1;
} finally {
  database.close();
}

function createRawReferenceReader(inputPath) {
  const exactPath = path.resolve(inputPath);
  let linesPromise;
  return async rawRef => {
    if (!samePath(rawRef.sourceFile, exactPath) || !Number.isInteger(rawRef.line) || rawRef.line < 1) return undefined;
    linesPromise ??= fs.readFile(exactPath, 'utf8').then(content => content.split(/\r?\n/));
    return (await linesPromise)[rawRef.line - 1];
  };
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

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function requiredPath(value, name) {
  return path.resolve(requiredText(value, name));
}

function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const normalize = value => path.resolve(value).toLowerCase();
  return normalize(left) === normalize(right);
}

async function pathExists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}
