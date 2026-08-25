import type {
  DailyReviewRecord,
  HumanAnnotation,
  ReusableReviewRun,
  ReusableReviewRunQuery,
  ReviewCase,
  ReviewCaseRecord,
  ReviewRunResult,
  ReviewStore,
  TemporaryPrompt,
} from './types.js';
import { assertDailyReviewRecord } from './daily-review.js';
import { assertReviewCaseRecord } from './validate.js';

export function createInMemoryReviewStore(): ReviewStore & import('./types.js').DailyReviewStore {
  const records = new Map<string, ReviewCaseRecord>();
  const dailyRecords = new Map<string, DailyReviewRecord>();
  const temporaryPrompts = new Map<string, TemporaryPrompt>();

  return {
    async createCase(reviewCase) {
      if (records.has(reviewCase.caseId)) throw new Error(`Review case already exists: ${reviewCase.caseId}`);
      const record = emptyRecord(reviewCase);
      assertReviewCaseRecord(record);
      records.set(reviewCase.caseId, clone(record));
      return clone(record);
    },

    async recordRun(result) {
      const record = requiredRecord(records, result.run.caseId);
      const existing = record.runs.find(run => run.runId === result.run.runId);
      if (existing) assertRunTransition(existing, result.run);
      assertUniqueResultIds(records, result, existing !== undefined);
      const next = {
        ...record,
        runs: existing
          ? record.runs.map(run => run.runId === result.run.runId ? result.run : run)
          : [...record.runs, result.run],
        judgements: [...record.judgements, ...result.judgements],
        evidence: [...record.evidence, ...result.evidence],
      };
      assertReviewCaseRecord(next);
      records.set(result.run.caseId, clone(next));
      return clone(next);
    },

    async appendAnnotation(annotation) {
      const entry = findRecordForJudgement(records, annotation);
      if ([...records.values()].some(record => (
        record.annotations.some(item => item.annotationId === annotation.annotationId)
      ))) {
        throw new Error(`Human annotation already exists: ${annotation.annotationId}`);
      }
      const next = { ...entry.record, annotations: [...entry.record.annotations, annotation] };
      assertReviewCaseRecord(next);
      records.set(entry.caseId, clone(next));
      return clone(next);
    },

    async getCase(caseId) {
      const record = records.get(caseId);
      return record ? clone(record) : undefined;
    },

    async listCases(options = {}) {
      const limit = normalizeLimit(options.limit);
      return [...records.values()]
        .map(record => record.reviewCase)
        .filter(reviewCase => !options.projectId || reviewCase.projectId === options.projectId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
        .map(clone);
    },

    async findReusableRun(query: ReusableReviewRunQuery): Promise<ReusableReviewRun | undefined> {
      const sourceTypes = new Set(query.sourceTypes);
      const requestedTurns = new Set(query.turns.map(turnKey));
      for (const record of records.values()) {
        if (record.reviewCase.projectId !== query.projectId
          || !sourceTypes.has(record.reviewCase.sourceType)
          || !sameTurnSet(record.reviewCase.turns, requestedTurns)) continue;
        const run = [...record.runs].reverse().find(item => (
          item.status === 'completed'
          && item.invocation.provider === query.invocation.provider
          && item.invocation.model === query.invocation.model
          && (item.invocation.modelVersion ?? null) === (query.invocation.modelVersion ?? null)
          && item.invocation.promptVersion === query.invocation.promptVersion
          && item.invocation.reviewPolicyVersion === query.invocation.reviewPolicyVersion
          && item.invocation.evidenceSchemaVersion === query.invocation.evidenceSchemaVersion
          && completeStoredEvidence(record, item.runId)
        ));
        if (run) return { caseId: record.reviewCase.caseId, runId: run.runId };
      }
      return undefined;
    },

    async createTemporaryPrompt(prompt) {
      if (temporaryPrompts.has(prompt.promptId)) throw new Error(`Temporary prompt already exists: ${prompt.promptId}`);
      const next = clone(prompt);
      temporaryPrompts.set(prompt.promptId, next);
      return clone(next);
    },

    async listTemporaryPrompts(options) {
      return [...temporaryPrompts.values()]
        .filter(item => item.projectId === options.projectId)
        .filter(item => options.includeHidden || item.status === 'visible')
        .filter(item => !options.createdOn || item.createdAt.startsWith(options.createdOn))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.promptId.localeCompare(left.promptId))
        .map(clone);
    },

    async hideTemporaryPrompt(projectId, promptId) {
      const existing = temporaryPrompts.get(promptId);
      if (!existing || existing.projectId !== projectId) throw new Error(`Temporary prompt does not exist: ${promptId}`);
      const next = { ...existing, status: 'hidden' as const };
      temporaryPrompts.set(promptId, next);
      return clone(next);
    },

    async createDailyBatch(batch, chunks) {
      if (dailyRecords.has(batch.batchId)) throw new Error(`Daily review batch already exists: ${batch.batchId}`);
      if ([...dailyRecords.values()].some(record => (
        record.batch.projectId === batch.projectId && record.batch.localDate === batch.localDate
      ))) throw new Error(`Daily review batch already exists for ${batch.projectId}:${batch.localDate}`);
      const record: DailyReviewRecord = { batch, chunks, issues: [] };
      assertDailyReviewRecord(record);
      dailyRecords.set(batch.batchId, clone(record));
      return clone(record);
    },

    async findDailyBatch(projectId, localDate) {
      const record = [...dailyRecords.values()].find(item => (
        item.batch.projectId === projectId && item.batch.localDate === localDate
      ));
      return record ? clone(record) : undefined;
    },

    async getDailyBatch(batchId) {
      const record = dailyRecords.get(batchId);
      return record ? clone(record) : undefined;
    },

    async appendDailyChunks(batchId, chunks) {
      const record = requiredDailyRecord(dailyRecords, batchId);
      const next: DailyReviewRecord = { ...record, chunks: [...record.chunks, ...chunks] };
      assertDailyReviewRecord(next);
      dailyRecords.set(batchId, clone(next));
      return clone(next);
    },

    async updateDailyBatch(batch) {
      const record = requiredDailyRecord(dailyRecords, batch.batchId);
      const next: DailyReviewRecord = { ...record, batch };
      assertDailyReviewRecord(next);
      dailyRecords.set(batch.batchId, clone(next));
      return clone(next);
    },

    async updateDailyChunk(chunk) {
      const record = requiredDailyRecord(dailyRecords, chunk.batchId);
      if (!record.chunks.some(item => item.chunkId === chunk.chunkId)) {
        throw new Error(`Daily review chunk does not exist: ${chunk.chunkId}`);
      }
      const next: DailyReviewRecord = {
        ...record,
        chunks: record.chunks.map(item => item.chunkId === chunk.chunkId ? chunk : item),
      };
      assertDailyReviewRecord(next);
      dailyRecords.set(chunk.batchId, clone(next));
      return clone(next);
    },

    async replaceDailyIssues(batchId, issues) {
      const record = requiredDailyRecord(dailyRecords, batchId);
      const next: DailyReviewRecord = { ...record, issues };
      assertDailyReviewRecord(next);
      dailyRecords.set(batchId, clone(next));
      return clone(next);
    },
  };
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new TypeError('Review case list limit must be an integer between 1 and 1000.');
  }
  return value;
}

function assertUniqueResultIds(
  records: Map<string, ReviewCaseRecord>,
  result: ReviewRunResult,
  advancingExistingRun: boolean,
): void {
  const all = [...records.values()];
  if (!advancingExistingRun && all.some(record => record.runs.some(run => run.runId === result.run.runId))) {
    throw new Error(`Review run already exists: ${result.run.runId}`);
  }
  for (const judgement of result.judgements) {
    if (all.some(record => record.judgements.some(item => item.judgementId === judgement.judgementId))) {
      throw new Error(`Model judgement already exists: ${judgement.judgementId}`);
    }
  }
  for (const evidence of result.evidence) {
    if (all.some(record => record.evidence.some(item => item.evidenceId === evidence.evidenceId))) {
      throw new Error(`Evidence already exists: ${evidence.evidenceId}`);
    }
  }
}

function assertRunTransition(previous: ReviewRunResult['run'], next: ReviewRunResult['run']): void {
  if (previous.status === 'completed' || previous.status === 'failed' || previous.status === 'cancelled') {
    throw new Error(`Review run is already terminal: ${previous.runId}`);
  }
  if (previous.caseId !== next.caseId
    || previous.startedAt !== next.startedAt
    || JSON.stringify(previous.invocation) !== JSON.stringify(next.invocation)) {
    throw new Error(`Review run identity cannot change: ${previous.runId}`);
  }
  const allowed = previous.status === 'queued'
    ? ['running', 'completed', 'failed', 'cancelled']
    : ['completed', 'failed', 'cancelled'];
  if (!allowed.includes(next.status)) {
    throw new Error(`Invalid review run transition: ${previous.status} -> ${next.status}`);
  }
}

function emptyRecord(reviewCase: ReviewCase): ReviewCaseRecord {
  return {
    schemaVersion: '1.0-draft',
    reviewCase,
    runs: [],
    judgements: [],
    evidence: [],
    annotations: [],
  };
}

function requiredRecord(records: Map<string, ReviewCaseRecord>, caseId: string): ReviewCaseRecord {
  const record = records.get(caseId);
  if (!record) throw new Error(`Review case does not exist: ${caseId}`);
  return record;
}

function findRecordForJudgement(
  records: Map<string, ReviewCaseRecord>,
  annotation: HumanAnnotation,
): { caseId: string; record: ReviewCaseRecord } {
  for (const [caseId, record] of records) {
    if (record.judgements.some(item => item.judgementId === annotation.judgementId)) return { caseId, record };
  }
  throw new Error(`Judgement does not exist: ${annotation.judgementId}`);
}

function requiredDailyRecord(
  records: Map<string, DailyReviewRecord>,
  batchId: string,
): DailyReviewRecord {
  const record = records.get(batchId);
  if (!record) throw new Error(`Daily review batch does not exist: ${batchId}`);
  return record;
}

function completeStoredEvidence(record: ReviewCaseRecord, runId: string): boolean {
  const judgements = record.judgements.filter(item => item.runId === runId);
  return judgements.every(judgement => record.evidence.some(item => (
    item.judgementId === judgement.judgementId
      && typeof item.contentHash === 'string'
      && item.contentHash.length > 0
      && typeof item.cachedExcerpt === 'string'
  )));
}

function sameTurnSet(turns: ReviewCase['turns'], requested: Set<string>): boolean {
  return turns.length === requested.size
    && turns.every(turn => requested.has(turnKey(turn)));
}

function turnKey(turn: ReviewCase['turns'][number]): string {
  return `${turn.sessionId}\0${turn.turnId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
