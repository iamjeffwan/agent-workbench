import type {
  DailyReviewRecord,
  HumanAnnotation,
  ReviewCase,
  ReviewCaseRecord,
  ReviewRunResult,
  ReviewStore,
} from './types.js';
import { assertDailyReviewRecord } from './daily-review.js';
import { assertReviewCaseRecord } from './validate.js';

export function createInMemoryReviewStore(): ReviewStore & import('./types.js').DailyReviewStore {
  const records = new Map<string, ReviewCaseRecord>();
  const dailyRecords = new Map<string, DailyReviewRecord>();

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

function clone<T>(value: T): T {
  return structuredClone(value);
}
