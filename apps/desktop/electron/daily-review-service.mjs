import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { adaptCodexSession } from '@agent-workbench/codex-adapter';
import {
  DAILY_SYNTHESIS_OUTPUT_SCHEMA,
  REVIEW_EVIDENCE_SCHEMA_VERSION,
  assertDailySynthesisOutput,
  buildReviewEvidencePackage,
  createCodexCliReviewModelAdapter,
  createReviewExecutor,
  enrichReviewEvidencePackageFromProject,
} from '@agent-workbench/review';
import {
  cleanString,
  createServiceResultHelpers,
  errorMessage,
  samePath,
} from './service-result-helpers.mjs';
import {
  isCovered,
  isTerminalTurn,
  localDate,
  localDateFromTimestamp,
  planDailyChunks,
} from './daily-review-planning.mjs';

const SOURCE = 'daily-review';
const REVIEW_MODEL = 'gpt-5.6-sol';
const PROMPT_VERSION = 'review-prompt-1';
const POLICY_VERSION = 'review-policy-1';
const { ready, failed } = createServiceResultHelpers(SOURCE);

/**
 * Runs the non-interactive daily review workflow. It is intentionally a main
 * process service: the following scheduler branch can call it without adding
 * an IPC or renderer entry point.
 */
export function createDailyReviewService({
  getStore,
  getUserDataPath,
  projectObservation,
  sessionHistory,
  taskLibrary,
  createAdapter = createCodexCliReviewModelAdapter,
  createExecutor = createReviewExecutor,
  adaptSession = adaptCodexSession,
  buildEvidence = buildReviewEvidencePackage,
  enrichEvidence = enrichReviewEvidencePackageFromProject,
  readFile = fs.readFile,
  now = () => new Date(),
  timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  createId = () => randomUUID(),
} = {}) {
  if (typeof getStore !== 'function') throw new Error('getStore is required');
  if (typeof getUserDataPath !== 'function') throw new Error('getUserDataPath is required');
  if (!projectObservation || typeof projectObservation.read !== 'function') throw new Error('projectObservation is required');
  if (!sessionHistory || typeof sessionHistory.listSessions !== 'function'
    || typeof sessionHistory.readSession !== 'function'
    || typeof sessionHistory.resolveSessionFiles !== 'function') {
    throw new Error('sessionHistory is required');
  }
  if (!taskLibrary || typeof taskLibrary.listTasks !== 'function') throw new Error('taskLibrary is required');

  const activeBatches = new Set();

  return {
    async run(projectRoot, options = {}) {
      const root = cleanString(projectRoot);
      if (!root) return failed(null, 'Open a project before running daily review.');
      const zone = cleanString(options.timeZone) ?? timeZone();
      const date = cleanString(options.localDate) ?? localDate(now(), zone);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return failed(null, 'Daily review requires a valid local date.');
      const key = `${path.resolve(root)}\0${date}`;
      if (activeBatches.has(key)) return failed(null, 'This daily review is already running.');
      activeBatches.add(key);
      try {
        return await runDaily(path.resolve(root), date, zone);
      } catch (error) {
        return failed(null, errorMessage(error, 'Unable to run daily review.'));
      } finally {
        activeBatches.delete(key);
      }
    },
  };

  async function runDaily(projectRoot, date, zone) {
    const project = projectObservation.read(projectRoot);
    const projectId = project?.status === 'ready' ? cleanString(project.data?.projectId) : null;
    if (!projectId) return failed(null, project?.error ?? 'The project observation is unavailable.');
    const store = await getStore();
    let record = await store.findDailyBatch(projectId, date);
    if (record?.batch.status === 'completed') return ready(record);

    const collected = await collectDailyTurns({ projectRoot, projectId, date, zone });
    if (collected.status !== 'ready') return collected;

    if (!record) {
      const timestamp = now().toISOString();
      const chunks = plansToChunks(collected.data.plans, {
        batchId: `daily_batch_${createId()}`,
        startSequence: 0,
      });
      const batch = chunks.length === 0
        ? completedEmptyBatch(chunks[0]?.batchId ?? `daily_batch_${createId()}`, projectId, date, zone, timestamp)
        : {
            batchId: chunks[0].batchId,
            projectId,
            localDate: date,
            timeZone: zone,
            status: 'queued',
            createdAt: timestamp,
            updatedAt: timestamp,
            synthesis: { status: 'queued' },
          };
      record = await store.createDailyBatch(batch, chunks);
      if (record.batch.status === 'completed') return ready(record);
    } else {
      record = await recoverInterruptedWork(store, record, now());
      const uncovered = collected.data.plans.filter(plan => !isCovered(record.chunks, plan.turns));
      if (uncovered.length > 0) {
        record = await store.appendDailyChunks(record.batch.batchId, plansToChunks(uncovered, {
          batchId: record.batch.batchId,
          startSequence: record.chunks.length,
        }));
      }
    }

    record = await updateBatch(store, record, { status: 'running', completedAt: null }, now());
    for (const chunk of record.chunks.filter(item => item.status !== 'completed')) {
      record = await executeChunk({ store, chunk, projectRoot, projectId });
    }

    const failedChunks = record.chunks.filter(chunk => chunk.status === 'failed');
    if (failedChunks.length > 0) {
      const completedChunks = record.chunks.length - failedChunks.length;
      record = await updateBatch(store, record, {
        status: completedChunks > 0 ? 'partial' : 'failed',
      }, now());
      return ready(record);
    }

    record = await synthesize({ store, record, projectRoot, projectId });
    return ready(record);
  }

  async function collectDailyTurns({ projectRoot, projectId, date, zone }) {
    const listed = sessionHistory.listSessions(projectRoot);
    if (listed?.status !== 'ready' || !Array.isArray(listed.data)) {
      return failed(null, listed?.error ?? 'Unable to list project sessions.');
    }
    const projectState = projectObservation.read(projectRoot);
    const tasksResult = taskLibrary.listTasks(projectRoot);
    if (tasksResult?.status !== 'ready' || !Array.isArray(tasksResult.data)) {
      return failed(null, tasksResult?.error ?? 'Unable to read saved task records.');
    }
    const candidates = [];
    const observations = new Map();
    const sessions = new Map();
    const sessionFiles = new Map();
    for (const summary of listed.data) {
      const sessionId = cleanString(summary?.id);
      if (!sessionId) continue;
      const detail = sessionHistory.readSession(projectRoot, sessionId);
      if (detail?.status !== 'ready' || !Array.isArray(detail.data?.turns)) {
        return failed(null, detail?.error ?? `Unable to read daily review session: ${sessionId}`);
      }
      const resolution = sessionHistory.resolveSessionFiles(projectRoot, [sessionId]);
      if (resolution?.status !== 'ready' || resolution.data?.sessionFiles?.length !== 1) {
        return failed(null, resolution?.error ?? `Unable to resolve daily review session: ${sessionId}`);
      }
      const [sessionFile] = resolution.data.sessionFiles;
      let adapted;
      try {
        adapted = adaptSession(sessionFile, { projectId });
      } catch (error) {
        return failed(null, errorMessage(error, `Unable to adapt daily review session: ${sessionId}`));
      }
      if (adapted.session.sessionId !== sessionId) {
        return failed(null, `The daily review session source does not match: ${sessionId}`);
      }
      sessions.set(sessionId, adapted);
      sessionFiles.set(sessionId, path.resolve(sessionFile));
      for (const turn of detail.data.turns) {
        if (!isTerminalTurn(turn?.status) || localDateFromTimestamp(turn.updatedAt, zone) !== date) continue;
        const turnId = cleanString(turn.id);
        const normalized = adapted.turns.find(item => item.turnId === turnId);
        if (!turnId || !normalized) continue;
        candidates.push({
          sessionId,
          turnId,
          sequence: normalized.sequence,
          endedAt: cleanString(turn.updatedAt) ?? normalized.endedAt ?? normalized.startedAt ?? '',
          characterCount: JSON.stringify(normalized).length,
        });
        observations.set(turnKey(sessionId, turnId), projectObservationFor(
          projectState?.status === 'ready' ? projectState.data : null,
          projectId,
          sessionId,
          turnId,
        ));
      }
    }
    const plans = planDailyChunks(candidates, tasksResult.data);
    return ready({ plans, sessions, sessionFiles, observations });
  }

  function plansToChunks(plans, { batchId, startSequence }) {
    return plans.map((plan, index) => ({
      chunkId: `daily_chunk_${createId()}`,
      batchId,
      sequence: startSequence + index,
      groupKey: plan.groupKey,
      turns: plan.turns.map(turn => ({ sessionId: turn.sessionId, turnId: turn.turnId })),
      characterCount: plan.characterCount,
      status: 'queued',
    }));
  }

  async function executeChunk({ store, chunk, projectRoot, projectId }) {
    const timestamp = now().toISOString();
    const plannedCaseId = chunk.reviewCaseId ?? `case_daily_${createId()}`;
    let current = await store.updateDailyChunk({
      ...chunk,
      status: 'running',
      reviewCaseId: plannedCaseId,
      startedAt: chunk.startedAt ?? timestamp,
      completedAt: undefined,
      failureReason: undefined,
    });
    const activeChunk = current.chunks.find(item => item.chunkId === chunk.chunkId);
    const adapter = createAdapter({
      artifactDirectory: path.join(getUserDataPath(), 'review-runs'),
      workingDirectory: projectRoot,
      model: REVIEW_MODEL,
    });
    const reused = await findReusableRun(store, projectId, activeChunk, adapter.descriptor);
    if (reused) {
      return await store.updateDailyChunk({
        ...activeChunk,
        status: 'completed',
        reviewCaseId: reused.caseId,
        reusedRunId: reused.runId,
        completedAt: now().toISOString(),
        failureReason: undefined,
      });
    }
    try {
      const existing = activeChunk.reviewCaseId
        ? await store.getCase(activeChunk.reviewCaseId)
        : undefined;
      const reviewCase = existing?.reviewCase ?? {
        caseId: activeChunk.reviewCaseId,
        projectId,
        sourceType: 'daily_auto',
        turns: activeChunk.turns,
        createdAt: now().toISOString(),
      };
      const prepared = await prepareChunk({ activeChunk, reviewCase, projectRoot, projectId });
      if (prepared.status !== 'ready') throw new Error(prepared.error ?? 'Unable to prepare daily review evidence.');
      if (!existing) await store.createCase(reviewCase);
      const executor = createExecutor({
        store,
        adapter,
        readRawReference: createRawReferenceReader(prepared.data.sessionFiles, readFile),
      });
      const result = await executor.execute({
        reviewCase,
        evidencePackage: prepared.data.evidencePackage,
        promptVersion: PROMPT_VERSION,
        reviewPolicyVersion: POLICY_VERSION,
      });
      return await store.updateDailyChunk({
        ...activeChunk,
        status: result.run.status === 'completed' ? 'completed' : 'failed',
        reviewCaseId: reviewCase.caseId,
        completedAt: now().toISOString(),
        ...(result.run.status === 'completed' ? {} : { failureReason: result.run.failureReason ?? 'Daily chunk review failed.' }),
      });
    } catch (error) {
      return await store.updateDailyChunk({
        ...activeChunk,
        status: 'failed',
        completedAt: now().toISOString(),
        failureReason: errorMessage(error, 'Daily chunk review failed.'),
      });
    }
  }

  async function prepareChunk({ activeChunk, reviewCase, projectRoot, projectId }) {
    const sessionIds = [...new Set(activeChunk.turns.map(turn => turn.sessionId))];
    const resolution = sessionHistory.resolveSessionFiles(projectRoot, sessionIds);
    if (resolution?.status !== 'ready' || resolution.data?.sessionFiles?.length !== sessionIds.length) {
      return failed(null, resolution?.error ?? 'Unable to resolve daily review session sources.');
    }
    const sessionFiles = new Map();
    const sessions = [];
    for (const sessionId of sessionIds) {
      const file = resolution.data.sessionFiles.find(candidate => {
        try { return adaptSession(candidate, { projectId }).session.sessionId === sessionId; } catch { return false; }
      });
      if (!file) return failed(null, 'A daily review session source cannot be resolved exactly.');
      const session = adaptSession(file, { projectId });
      sessions.push(session);
      sessionFiles.set(sessionId, path.resolve(file));
    }
    const projectState = projectObservation.read(projectRoot);
    const evidencePackage = buildEvidence({
      reviewCase,
      sessions,
      projectObservations: activeChunk.turns.map(turn => projectObservationFor(
        projectState?.status === 'ready' ? projectState.data : null,
        projectId,
        turn.sessionId,
        turn.turnId,
      )),
    });
    const enriched = await enrichEvidence({ evidencePackage, repositoryRoot: projectRoot });
    return ready({ evidencePackage: enriched, sessionFiles });
  }

  async function synthesize({ store, record, projectRoot, projectId }) {
    const judgements = await chunkJudgements(store, record.chunks);
    const startedAt = now();
    const adapter = createAdapter({
      artifactDirectory: path.join(getUserDataPath(), 'review-runs'),
      workingDirectory: projectRoot,
      model: REVIEW_MODEL,
    });
    const invocation = {
      provider: adapter.descriptor.provider,
      model: adapter.descriptor.model,
      ...(adapter.descriptor.modelVersion ? { modelVersion: adapter.descriptor.modelVersion } : {}),
      promptVersion: PROMPT_VERSION,
      reviewPolicyVersion: POLICY_VERSION,
      evidenceSchemaVersion: REVIEW_EVIDENCE_SCHEMA_VERSION,
    };
    record = await updateBatch(store, record, {
      status: 'running',
      synthesis: { status: 'running', invocation, startedAt: startedAt.toISOString() },
    }, startedAt);
    try {
      const response = await adapter.review({
        runId: `daily_synthesis_${record.batch.batchId}`,
        reviewCase: {
          caseId: record.batch.batchId,
          projectId,
          sourceType: 'daily_auto',
          turns: record.chunks.flatMap(chunk => chunk.turns),
          createdAt: record.batch.createdAt,
        },
        evidencePackage: {
          schemaVersion: '1.0-draft',
          evidenceSchemaVersion: REVIEW_EVIDENCE_SCHEMA_VERSION,
          caseId: record.batch.batchId,
          projectId,
          builtAt: startedAt.toISOString(),
          reviewability: 'sufficient',
          gaps: [],
          turns: [],
          dailySynthesis: {
            batchId: record.batch.batchId,
            localDate: record.batch.localDate,
            judgements,
          },
        },
        systemPrompt: 'You are an evidence-bound daily review synthesizer. Use only the supplied chunk judgements. Merge duplicate findings when they have the same root cause. Each issue must reference one or more supplied judgement IDs. Do not invent evidence, facts, or source IDs. issueFingerprint must start with the issue category and use lowercase colon-separated stable segments. Return only the requested structured output.',
        outputSchema: DAILY_SYNTHESIS_OUTPUT_SCHEMA,
      });
      const output = assertDailySynthesisOutput(response.output, judgements);
      const completedAt = now();
      const createdAt = completedAt.toISOString();
      const issues = output.issues.map(issue => ({
        issueId: `daily_issue_${createId()}`,
        batchId: record.batch.batchId,
        ...issue,
        createdAt,
      }));
      await store.replaceDailyIssues(record.batch.batchId, issues);
      return await updateBatch(store, record, {
        status: 'completed',
        completedAt: createdAt,
        synthesis: {
          status: 'completed', invocation, startedAt: startedAt.toISOString(), completedAt: createdAt,
          ...(response.usage ? { usage: response.usage } : {}),
          ...(response.actualCost !== undefined ? { actualCost: response.actualCost } : {}),
          ...(response.artifacts ? { artifacts: response.artifacts } : {}),
          latencyMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        },
      }, completedAt);
    } catch (error) {
      const completedAt = now();
      return await updateBatch(store, record, {
        status: 'partial',
        synthesis: {
          status: 'failed', invocation, startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(),
          latencyMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
          failureReason: errorMessage(error, 'Daily synthesis failed.'),
        },
      }, completedAt);
    }
  }
}

async function findReusableRun(store, projectId, chunk, descriptor) {
  return store.findReusableRun({
    projectId,
    turns: chunk.turns,
    sourceTypes: ['task', 'manual_turn_selection'],
    invocation: {
      provider: descriptor.provider,
      model: descriptor.model,
      modelVersion: descriptor.modelVersion,
      promptVersion: PROMPT_VERSION,
      reviewPolicyVersion: POLICY_VERSION,
      evidenceSchemaVersion: REVIEW_EVIDENCE_SCHEMA_VERSION,
    },
  });
}

async function chunkJudgements(store, chunks) {
  const result = [];
  for (const chunk of chunks) {
    if (!chunk.reviewCaseId) throw new Error(`Completed daily chunk has no review case: ${chunk.chunkId}`);
    const record = await store.getCase(chunk.reviewCaseId);
    const run = chunk.reusedRunId
      ? record?.runs.find(item => item.runId === chunk.reusedRunId)
      : [...(record?.runs ?? [])].reverse().find(item => item.status === 'completed');
    if (!run || run.status !== 'completed') throw new Error(`Completed daily chunk has no completed review run: ${chunk.chunkId}`);
    result.push(...record.judgements
      .filter(item => item.runId === run.runId)
      .filter(judgement => latestAnnotation(record, judgement.judgementId)?.verdict !== 'incorrect'));
  }
  return result;
}

function latestAnnotation(record, judgementId) {
  return record.annotations
    .filter(annotation => annotation.judgementId === judgementId)
    .sort((left, right) => (
      left.createdAt.localeCompare(right.createdAt) || left.annotationId.localeCompare(right.annotationId)
    ))
    .at(-1);
}

async function recoverInterruptedWork(store, record, timestamp) {
  for (const chunk of record.chunks.filter(item => item.status === 'running')) {
    record = await store.updateDailyChunk({
      ...chunk,
      status: 'failed',
      completedAt: timestamp.toISOString(),
      failureReason: 'The desktop application stopped before this daily chunk completed.',
    });
  }
  if (record.batch.synthesis.status === 'running') {
    record = await updateBatch(store, record, {
      status: 'partial',
      synthesis: {
        ...record.batch.synthesis,
        status: 'failed',
        completedAt: timestamp.toISOString(),
        failureReason: 'The desktop application stopped before daily synthesis completed.',
      },
    }, timestamp);
  }
  return record;
}

async function updateBatch(store, record, changes, timestamp = new Date()) {
  const batch = {
    ...record.batch,
    ...changes,
    synthesis: changes.synthesis ?? record.batch.synthesis,
    updatedAt: timestamp.toISOString(),
  };
  return store.updateDailyBatch(batch);
}

function completedEmptyBatch(batchId, projectId, localDate, timeZone, timestamp) {
  return {
    batchId, projectId, localDate, timeZone,
    status: 'completed', createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp,
    synthesis: { status: 'completed', completedAt: timestamp },
  };
}

function projectObservationFor(store, projectId, sessionId, turnId) {
  const turn = store?.turns?.[turnKey(sessionId, turnId)];
  if (turn?.status === 'completed' && turn.facts?.turnDiff && turn.facts?.environmentDelta && turn.after?.profile && turn.after?.snapshot) {
    return {
      sessionId, turnId, status: 'available', turnDiff: turn.facts.turnDiff,
      projectProfile: turn.after.profile, environmentSnapshot: turn.after.snapshot,
      environmentDelta: turn.facts.environmentDelta,
    };
  }
  return {
    sessionId, turnId, status: 'unavailable',
    unavailableReason: turn?.reason ?? 'No complete persisted project observation exists for this daily review turn.',
  };
}

function createRawReferenceReader(sessionFiles, readFile) {
  const lines = new Map();
  return async rawRef => {
    if (!rawRef || !Number.isInteger(rawRef.line) || rawRef.line < 1) return undefined;
    const source = [...sessionFiles.values()].find(file => samePath(file, rawRef.sourceFile));
    if (!source) return undefined;
    if (!lines.has(source)) lines.set(source, readFile(source, 'utf8').then(content => content.split(/\r?\n/)));
    return (await lines.get(source))[rawRef.line - 1];
  };
}

function turnKey(sessionId, turnId) { return `${sessionId}\0${turnId}`; }
