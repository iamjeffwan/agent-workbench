import type {
  HumanAnnotation,
  ReviewCase,
  ReviewCaseRecord,
  ReviewRunResult,
  ReviewStore,
} from './types.js';
import { assertReviewCaseRecord } from './validate.js';

export function createInMemoryReviewStore(): ReviewStore {
  const records = new Map<string, ReviewCaseRecord>();

  return {
    createCase(reviewCase) {
      if (records.has(reviewCase.caseId)) throw new Error(`Review case already exists: ${reviewCase.caseId}`);
      const record = emptyRecord(reviewCase);
      assertReviewCaseRecord(record);
      records.set(reviewCase.caseId, clone(record));
      return clone(record);
    },

    recordRun(result) {
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

    appendAnnotation(annotation) {
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

    getCase(caseId) {
      const record = records.get(caseId);
      return record ? clone(record) : undefined;
    },
  };
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

function clone<T>(value: T): T {
  return structuredClone(value);
}
