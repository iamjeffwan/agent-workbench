import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createCodexCliReviewModelAdapter,
  createReviewExecutor,
  createSqliteReviewStore,
} from '@agent-workbench/review';
import {
  openElectronReviewDatabase,
  resolveDefaultReviewDatabasePath,
} from './local-review-database.mjs';
import { createDailyReviewService } from './daily-review-service.mjs';
import {
  cleanString,
  createServiceResultHelpers,
  errorMessage,
  samePath,
} from './service-result-helpers.mjs';

const SOURCE = 'workbench-review';
const REVIEW_MODEL = 'gpt-5.6-sol';
const PROMPT_VERSION = 'review-prompt-1';
const POLICY_VERSION = 'review-policy-1';
const { ready, failed } = createServiceResultHelpers(SOURCE);

/**
 * Owns the desktop review workflow. Its small interface deliberately hides
 * session parsing, persistent storage, model execution and evidence rebuilding
 * from renderer callers.
 */
export function createReviewWorkflowService({
  reviewObservation,
  projectObservation,
  getUserDataPath,
  openDatabase = openElectronReviewDatabase,
  createStore = createSqliteReviewStore,
  createAdapter = createCodexCliReviewModelAdapter,
  createExecutor = createReviewExecutor,
  dailySessionHistory = null,
  dailyTaskLibrary = null,
  readFile = fs.readFile,
  now = () => new Date(),
  createId = () => randomUUID(),
  databasePath = () => resolveDefaultReviewDatabasePath(),
} = {}) {
  if (!reviewObservation || typeof reviewObservation.prepareFromTask !== 'function'
    || typeof reviewObservation.prepareFromTurns !== 'function') {
    throw new Error('reviewObservation is required');
  }
  if (!projectObservation || typeof projectObservation.read !== 'function') {
    throw new Error('projectObservation is required');
  }
  if (typeof getUserDataPath !== 'function') throw new Error('getUserDataPath is required');

  let database = null;
  let store = null;
  let recovered = false;
  let closed = false;
  let operationQueue = Promise.resolve();
  /** @type {Set<string>} */
  const activeCases = new Set();
  /** @type {Set<(change: Record<string, unknown>) => void>} */
  const listeners = new Set();
  const dailyReview = dailySessionHistory && dailyTaskLibrary
    ? createDailyReviewService({
        getStore: async () => (await readyStore()).store,
        getUserDataPath,
        projectObservation,
        sessionHistory: dailySessionHistory,
        taskLibrary: dailyTaskLibrary,
        createAdapter,
        createExecutor,
        now,
        createId,
      })
    : null;

  return {
    async start(input) {
      const dependencies = await readyStore();
      if (activeCases.size > 0) {
        return failed(null, 'Another review is already running. Wait for it to finish before starting a new one.');
      }

      const prepared = await prepare(input);
      if (prepared.status !== 'ready' || !prepared.data) {
        return failed(null, prepared.error ?? 'Unable to prepare review evidence.');
      }

      const { reviewCase, evidencePackage, selection } = prepared.data;
      try {
        await dependencies.store.createCase(reviewCase);
      } catch (error) {
        return failed(null, errorMessage(error, 'Unable to create the review record.'));
      }

      activeCases.add(reviewCase.caseId);
      publish({ caseId: reviewCase.caseId, projectId: reviewCase.projectId, state: 'created' });
      void enqueue(() => execute(reviewCase, evidencePackage, selection, dependencies.store))
        .finally(() => activeCases.delete(reviewCase.caseId));
      return ready({ caseId: reviewCase.caseId });
    },

    async list(projectRoot) {
      const dependencies = await readyStore();
      const project = projectFor(projectRoot);
      if (project.status !== 'ready') return failed([], project.error);
      try {
        const cases = await dependencies.store.listCases({ projectId: project.data.projectId, limit: 200 });
        const summaries = await Promise.all(cases.map(async reviewCase => summaryOf(
          await dependencies.store.getCase(reviewCase.caseId),
        )));
        return ready(summaries.filter(Boolean));
      } catch (error) {
        return failed([], errorMessage(error, 'Unable to list review records.'));
      }
    },

    async get(projectRoot, caseId) {
      const dependencies = await readyStore();
      const owned = await ownedRecord(dependencies.store, projectRoot, caseId);
      return owned.status === 'ready'
        ? ready(owned.data)
        : failed(null, owned.error);
    },

    async resolveEvidence(projectRoot, caseId, evidenceId) {
      const dependencies = await readyStore();
      const owned = await ownedRecord(dependencies.store, projectRoot, caseId);
      if (owned.status !== 'ready') return failed(null, owned.error);
      const evidence = owned.data.evidence.find(item => item.evidenceId === cleanString(evidenceId));
      if (!evidence) return failed(null, 'The selected evidence does not exist in this review.');

      const prepared = await reviewObservation.prepareFromTurns(selectionFor(owned.data, projectRoot));
      if (prepared.status !== 'ready' || !prepared.data) {
        return ready(unavailableEvidence(evidence, prepared.error ?? 'The original evidence can no longer be prepared.'));
      }
      const target = await findEvidenceTarget(prepared.data, evidence, readFile);
      if (!target) return ready(unavailableEvidence(evidence, 'The cited evidence is no longer available.'));
      const currentHash = hash(target.content);
      return ready({
        evidence,
        availability: evidence.contentHash && evidence.contentHash !== currentHash ? 'changed' : 'available',
        content: target.content,
        location: target.location,
        ...(evidence.contentHash ? { currentContentHash: currentHash } : {}),
      });
    },

    async appendAnnotation(projectRoot, input) {
      const dependencies = await readyStore();
      const caseId = cleanString(input?.caseId);
      const judgementId = cleanString(input?.judgementId);
      const verdict = annotationVerdict(input?.verdict);
      if (!caseId || !judgementId || !verdict) {
        return failed(null, 'A review, judgement and verdict are required.');
      }
      const owned = await ownedRecord(dependencies.store, projectRoot, caseId);
      if (owned.status !== 'ready') return failed(null, owned.error);
      if (!owned.data.judgements.some(item => item.judgementId === judgementId)) {
        return failed(null, 'The selected judgement does not belong to this review.');
      }
      try {
        const judgement = owned.data.judgements.find(item => item.judgementId === judgementId);
        const record = await dependencies.store.appendAnnotation({
          annotationId: `annotation_${createId()}`,
          judgementId,
          annotatorId: 'local-user',
          verdict,
          ...(cleanString(input?.reason) ? { reason: cleanString(input.reason) } : {}),
          ...(cleanString(input?.missingIssue) ? { missingIssue: cleanString(input.missingIssue) } : {}),
          createdAt: now().toISOString(),
        });
        if (input?.immediateOptimize === true && verdict === 'correct' && judgement) {
          const run = record.runs.find(item => item.runId === judgement.runId);
          await dependencies.store.createTemporaryPrompt({
            promptId: `temporary_prompt_${createId()}`,
            projectId: record.reviewCase.projectId,
            projectName: path.basename(path.resolve(projectRoot)),
            caseId,
            runId: judgement.runId,
            judgementId,
            title: judgement.title,
            content: buildTemporaryPrompt({
              projectName: path.basename(path.resolve(projectRoot)),
              summary: judgement.summary,
              recommendation: judgement.recommendation,
            }),
            createdAt: now().toISOString(),
            status: 'visible',
          });
        }
        publish({ caseId, projectId: record.reviewCase.projectId, state: 'annotated' });
        return ready(record);
      } catch (error) {
        return failed(null, errorMessage(error, 'Unable to save the human review.'));
      }
    },

    async listTemporaryPrompts(projectRoot, options = {}) {
      const dependencies = await readyStore();
      const project = projectFor(projectRoot);
      if (project.status !== 'ready') return failed([], project.error);
      try {
        return ready(await dependencies.store.listTemporaryPrompts({
          projectId: project.data.projectId,
          ...(options.includeHidden ? { includeHidden: true } : {}),
        }));
      } catch (error) {
        return failed([], errorMessage(error, 'Unable to list temporary prompts.'));
      }
    },

    async hideTemporaryPrompt(projectRoot, promptId) {
      const dependencies = await readyStore();
      const project = projectFor(projectRoot);
      if (project.status !== 'ready') return failed(null, project.error);
      try {
        return ready(await dependencies.store.hideTemporaryPrompt(project.data.projectId, cleanString(promptId)));
      } catch (error) {
        return failed(null, errorMessage(error, 'Unable to hide temporary prompt.'));
      }
    },

    async runDaily(projectRoot, options = {}) {
      if (!dailyReview) return failed(null, 'Daily review is not configured.');
      return enqueue(() => dailyReview.run(projectRoot, options));
    },

    async listCompletedDailyReviews(projectRoot) {
      const dependencies = await readyStore();
      const project = projectFor(projectRoot);
      if (project.status !== 'ready') return failed([], project.error);
      try {
        const records = await dependencies.store.listDailyBatches({ projectId: project.data.projectId, status: 'completed' });
        const cases = new Map();
        for (const caseId of new Set(records.flatMap(record => record.chunks.map(chunk => chunk.reviewCaseId).filter(Boolean)))) {
          const record = await dependencies.store.getCase(caseId);
          if (record) cases.set(caseId, record);
        }
        return ready({ records, cases: Object.fromEntries(cases) });
      } catch (error) {
        return failed([], errorMessage(error, 'Unable to list completed daily reviews.'));
      }
    },

    onChange(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    close() {
      if (closed) return;
      closed = true;
      database?.close();
      database = null;
      store = null;
    },
  };

  async function readyStore() {
    if (closed) throw new Error('Review workflow is closed.');
    if (!database) database = await openDatabase({ filePath: databasePath() });
    if (!store) store = createStore({ database });
    if (!recovered) {
      recovered = true;
      await recoverInterruptedRuns(store);
    }
    return { store };
  }

  function enqueue(operation) {
    const result = operationQueue.then(operation);
    operationQueue = result.catch(() => {});
    return result;
  }

  async function prepare(input) {
    if (input?.source === 'task') {
      const taskId = cleanString(input.taskId);
      return taskId ? reviewObservation.prepareFromTask(taskId) : failed(null, 'A task is required.');
    }
    if (input?.source === 'turns') {
      const projectRoot = cleanString(input.projectRoot);
      const sessionId = cleanString(input.sessionId);
      const turnIds = uniqueStrings(input.turnIds);
      if (!projectRoot || !sessionId || turnIds.length === 0) {
        return failed(null, 'Project, session and one or more turns are required.');
      }
      return reviewObservation.prepareFromTurns({ projectRoot, sessionId, turnIds });
    }
    return failed(null, 'Choose a task or selected turns to start a review.');
  }

  async function execute(reviewCase, evidencePackage, selection, currentStore) {
    try {
      publish({ caseId: reviewCase.caseId, projectId: reviewCase.projectId, state: 'running' });
      const adapter = createAdapter({
        artifactDirectory: path.join(getUserDataPath(), 'review-runs'),
        workingDirectory: selection.projectRoot,
        model: REVIEW_MODEL,
      });
      const executor = createExecutor({
        store: currentStore,
        adapter,
        readRawReference: createRawReferenceReader(selection.sessionFile, readFile),
      });
      const result = await executor.execute({
        reviewCase,
        evidencePackage,
        promptVersion: PROMPT_VERSION,
        reviewPolicyVersion: POLICY_VERSION,
      });
      publish({
        caseId: reviewCase.caseId,
        projectId: reviewCase.projectId,
        state: result.run.status === 'completed' ? 'completed' : 'failed',
      });
    } catch (error) {
      publish({
        caseId: reviewCase.caseId,
        projectId: reviewCase.projectId,
        state: 'failed',
        error: errorMessage(error, 'The review did not complete.'),
      });
    }
  }

  function projectFor(projectRoot) {
    const root = cleanString(projectRoot);
    if (!root) return failed(null, 'Open a project before using reviews.');
    const result = projectObservation.read(root);
    const projectId = result?.status === 'ready' ? cleanString(result.data?.projectId) : null;
    return projectId
      ? ready({ projectRoot: path.resolve(root), projectId })
      : failed(null, result?.error ?? 'The project observation is unavailable.');
  }

  async function ownedRecord(currentStore, projectRoot, caseId) {
    const project = projectFor(projectRoot);
    if (project.status !== 'ready') return failed(null, project.error);
    const normalizedCaseId = cleanString(caseId);
    if (!normalizedCaseId) return failed(null, 'A review is required.');
    const record = await currentStore.getCase(normalizedCaseId);
    if (!record) return failed(null, 'The review does not exist.');
    if (record.reviewCase.projectId !== project.data.projectId) {
      return failed(null, 'The review does not belong to the current project.');
    }
    return ready(record);
  }

  function publish(change) {
    for (const listener of listeners) listener(structuredClone(change));
  }
}

function buildTemporaryPrompt({ projectName, summary, recommendation }) {
  return [
    `在项目“${projectName}”中，请注意以下问题：`,
    summary,
    '',
    '执行建议：',
    recommendation,
    '',
    '请在后续工作中主动检查并避免再次出现这个问题。',
  ].join('\n');
}

async function recoverInterruptedRuns(store) {
  const cases = await store.listCases({ limit: 1000 });
  for (const reviewCase of cases) {
    const record = await store.getCase(reviewCase.caseId);
    for (const run of record?.runs.filter(item => item.status === 'running') ?? []) {
      await store.recordRun({
        run: {
          ...run,
          status: 'failed',
          completedAt: new Date().toISOString(),
          failureReason: 'The desktop application stopped before this review completed.',
        },
        judgements: [],
        evidence: [],
      });
    }
  }
}

function selectionFor(record, projectRoot) {
  const sessions = [...new Set(record.reviewCase.turns.map(item => item.sessionId))];
  if (sessions.length !== 1) throw new Error('A desktop review must contain turns from one session.');
  return {
    projectRoot,
    sessionId: sessions[0],
    turnIds: record.reviewCase.turns.map(item => item.turnId),
  };
}

async function findEvidenceTarget(prepared, evidence, readFile) {
  const packageData = prepared.evidencePackage;
  for (const turn of packageData.turns) {
    for (const event of turn.events) {
      if (evidence.targetType === 'event' && event.eventId === evidence.targetId) {
        return {
          content: typeof event.content === 'string' ? event.content : JSON.stringify(event),
          location: { kind: 'activity', sessionId: turn.sessionId, turnId: turn.turnId, eventId: event.eventId },
        };
      }
      if (evidence.targetType === 'raw_ref') {
        for (const rawRef of [event.rawRef, ...(event.relatedRawRefs ?? [])]) {
          if (!rawRef || `${rawRef.sourceFile}:${rawRef.line}` !== evidence.targetId) continue;
          const content = await createRawReferenceReader(prepared.selection.sessionFile, readFile)(rawRef);
          if (content !== undefined) {
            return {
              content,
              location: { kind: 'activity', sessionId: turn.sessionId, turnId: turn.turnId, eventId: event.eventId },
            };
          }
        }
      }
    }
    const context = turn.projectContext;
    if (!context) continue;
    const targets = [
      ['turn_diff', context.turnDiff.diffId, context.turnDiff.unifiedDiff],
      ['project_profile', context.projectProfile.profileId, JSON.stringify(context.projectProfile)],
      ['environment_snapshot', context.environmentSnapshot.snapshotId, JSON.stringify(context.environmentSnapshot)],
      ...(context.environmentDelta ? [['environment_delta', context.environmentDelta.deltaId, JSON.stringify(context.environmentDelta)]] : []),
    ];
    const match = targets.find(([type, targetId]) => type === evidence.targetType && targetId === evidence.targetId);
    if (match) return { content: match[2], location: { kind: 'inline' } };
  }
  const projectContext = packageData.projectContext;
  if (evidence.targetType === 'project_diff' && projectContext?.diff?.targetId === evidence.targetId) {
    return { content: projectContext.diff.content, location: { kind: 'inline' } };
  }
  const projectFile = projectContext?.files.find(file => file.path === evidence.targetId);
  if (evidence.targetType === 'project_file' && projectFile) {
    return {
      content: projectFile.content,
      location: { kind: 'project_file', relativePath: projectFile.path },
    };
  }
  return null;
}

function createRawReferenceReader(inputPath, readFile) {
  const sessionFile = path.resolve(inputPath);
  let linesPromise;
  return async rawRef => {
    if (!rawRef || !Number.isInteger(rawRef.line) || rawRef.line < 1 || !sameSource(rawRef.sourceFile, sessionFile)) {
      return undefined;
    }
    linesPromise ??= readFile(sessionFile, 'utf8').then(content => content.split(/\r?\n/));
    const lines = await linesPromise;
    return lines[rawRef.line - 1];
  };
}

function sameSource(sourceFile, sessionFile) {
  if (typeof sourceFile !== 'string' || !sourceFile.trim()) return false;
  if (path.isAbsolute(sourceFile)) return samePath(sourceFile, sessionFile);
  return path.basename(sourceFile) === path.basename(sessionFile);
}

function summaryOf(record) {
  if (!record) return null;
  const latestRun = [...record.runs].sort((left, right) => (
    right.startedAt.localeCompare(left.startedAt) || right.runId.localeCompare(left.runId)
  ))[0] ?? null;
  const latestJudgements = latestRun
    ? record.judgements.filter(item => item.runId === latestRun.runId)
    : [];
  const reviewed = new Set(record.annotations.map(item => item.judgementId));
  return {
    caseId: record.reviewCase.caseId,
    sourceType: record.reviewCase.sourceType,
    sourceTaskId: record.reviewCase.sourceTaskId ?? null,
    turnCount: record.reviewCase.turns.length,
    createdAt: record.reviewCase.createdAt,
    runStatus: latestRun?.status ?? 'queued',
    completedAt: latestRun?.completedAt ?? null,
    failureReason: latestRun?.failureReason ?? null,
    judgementCount: latestJudgements.length,
    reviewedCount: latestJudgements.filter(item => reviewed.has(item.judgementId)).length,
    highestSeverity: highestSeverity(latestJudgements.map(item => item.severity)),
  };
}

function unavailableEvidence(evidence, message) {
  return {
    evidence,
    availability: 'unavailable',
    content: evidence.cachedExcerpt ?? '',
    location: { kind: 'inline' },
    message,
  };
}

function highestSeverity(values) {
  const order = ['critical', 'high', 'medium', 'low'];
  return order.find(value => values.includes(value)) ?? null;
}

function annotationVerdict(value) {
  return ['correct', 'incorrect'].includes(value) ? value : null;
}

function uniqueStrings(value) {
  return Array.isArray(value) ? [...new Set(value.map(cleanString).filter(Boolean))] : [];
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}
