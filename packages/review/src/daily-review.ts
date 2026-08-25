import type {
  DailyIssue,
  DailyReviewBatch,
  DailyReviewRecord,
  DailyReviewSynthesis,
  ModelJudgement,
  ReviewCategory,
  ReviewSeverity,
} from './types.js';

const CATEGORIES: ReviewCategory[] = [
  'process_efficiency', 'tool_usage', 'repeated_failure', 'architecture',
  'maintainability', 'performance', 'security', 'testability',
];
const SEVERITIES: ReviewSeverity[] = ['low', 'medium', 'high', 'critical'];

export type DailySynthesisModelIssue = Omit<DailyIssue, 'issueId' | 'batchId' | 'createdAt'>;
export type DailySynthesisModelOutput = { issues: DailySynthesisModelIssue[] };

export const DAILY_SYNTHESIS_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'issueFingerprint', 'category', 'title', 'summary', 'severity',
          'impact', 'recommendation', 'sourceJudgementIds',
        ],
        properties: {
          issueFingerprint: { type: 'string', minLength: 3, maxLength: 256 },
          category: { type: 'string', enum: CATEGORIES },
          title: { type: 'string', minLength: 1 },
          summary: { type: 'string', minLength: 1 },
          severity: { type: 'string', enum: SEVERITIES },
          impact: { type: 'string', minLength: 1 },
          recommendation: { type: 'string', minLength: 1 },
          sourceJudgementIds: {
            type: 'array', minItems: 1, uniqueItems: true,
            items: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  },
};

export function assertDailyReviewRecord(value: DailyReviewRecord): void {
  assertBatch(value.batch);
  const chunkIds = new Set<string>();
  const turns = new Set<string>();
  for (const chunk of value.chunks) {
    if (chunk.batchId !== value.batch.batchId) invalid('Chunk belongs to a different batch.');
    if (chunkIds.has(chunk.chunkId)) invalid('Duplicate daily review chunk ID.');
    chunkIds.add(chunk.chunkId);
    if (!Number.isInteger(chunk.sequence) || chunk.sequence < 0) invalid('Chunk sequence is invalid.');
    if (!Number.isSafeInteger(chunk.characterCount) || chunk.characterCount < 0) invalid('Chunk character count is invalid.');
    if (!['queued', 'running', 'completed', 'failed'].includes(chunk.status)) invalid('Chunk status is invalid.');
    if (chunk.turns.length === 0) invalid('Daily review chunk must contain turns.');
    for (const turn of chunk.turns) {
      if (!text(turn.sessionId) || !text(turn.turnId)) invalid('Chunk turn reference is invalid.');
      const key = `${turn.sessionId}\0${turn.turnId}`;
      if (turns.has(key)) invalid('A daily review turn can belong to only one chunk.');
      turns.add(key);
    }
  }
  const issueIds = new Set<string>();
  for (const issue of value.issues) {
    if (issue.batchId !== value.batch.batchId) invalid('Daily issue belongs to a different batch.');
    if (issueIds.has(issue.issueId)) invalid('Duplicate daily issue ID.');
    issueIds.add(issue.issueId);
    assertDailyIssue(issue);
  }
  if (value.batch.status === 'completed' && value.batch.synthesis.status !== 'completed') {
    invalid('Completed daily batch requires a completed synthesis.');
  }
}

export function assertDailySynthesisOutput(
  value: unknown,
  sourceJudgements: readonly ModelJudgement[],
): DailySynthesisModelOutput {
  if (!record(value) || !Array.isArray(value.issues)) invalid('Daily synthesis issues must be an array.');
  const sourceIds = new Set(sourceJudgements.map(item => item.judgementId));
  const fingerprints = new Set<string>();
  const issues = value.issues.map((issue, index) => {
    if (!record(issue)) invalid(`Daily synthesis issue ${index} is invalid.`);
    const item = issue as Record<string, unknown>;
    const expected = ['issueFingerprint', 'category', 'title', 'summary', 'severity', 'impact', 'recommendation', 'sourceJudgementIds'];
    if (Object.keys(item).length !== expected.length || Object.keys(item).some(key => !expected.includes(key))) {
      invalid(`Daily synthesis issue ${index} has unsupported fields.`);
    }
    const issueFingerprint = requiredText(item.issueFingerprint, `Daily synthesis issue ${index} fingerprint`);
    if (!validFingerprint(issueFingerprint)) invalid(`Daily synthesis issue ${index} fingerprint is invalid.`);
    if (!CATEGORIES.includes(item.category as ReviewCategory)) invalid(`Daily synthesis issue ${index} category is invalid.`);
    if (!SEVERITIES.includes(item.severity as ReviewSeverity)) invalid(`Daily synthesis issue ${index} severity is invalid.`);
    for (const key of ['title', 'summary', 'impact', 'recommendation']) requiredText(item[key], `Daily synthesis issue ${index} ${key}`);
    if (!Array.isArray(item.sourceJudgementIds) || item.sourceJudgementIds.length === 0) {
      invalid(`Daily synthesis issue ${index} must reference source judgements.`);
    }
    const refs = item.sourceJudgementIds.map((id, referenceIndex) => requiredText(id, `Daily synthesis issue ${index} source judgement ${referenceIndex}`));
    if (new Set(refs).size !== refs.length || refs.some(id => !sourceIds.has(id))) {
      invalid(`Daily synthesis issue ${index} references an unavailable judgement.`);
    }
    if (fingerprints.has(issueFingerprint)) invalid('Daily synthesis produced duplicate fingerprints.');
    fingerprints.add(issueFingerprint);
    return {
      issueFingerprint,
      category: item.category as ReviewCategory,
      title: item.title as string,
      summary: item.summary as string,
      severity: item.severity as ReviewSeverity,
      impact: item.impact as string,
      recommendation: item.recommendation as string,
      sourceJudgementIds: refs,
    };
  });
  return { issues };
}

function assertBatch(batch: DailyReviewBatch): void {
  if (!text(batch.batchId) || !text(batch.projectId) || !/^\d{4}-\d{2}-\d{2}$/.test(batch.localDate) || !text(batch.timeZone)) {
    invalid('Daily review batch identity is invalid.');
  }
  if (!['queued', 'running', 'partial', 'completed', 'failed'].includes(batch.status)) invalid('Daily batch status is invalid.');
  if (!text(batch.createdAt) || !text(batch.updatedAt)) invalid('Daily review batch timestamps are invalid.');
  assertSynthesis(batch.synthesis);
}

function assertSynthesis(value: DailyReviewSynthesis): void {
  if (!['queued', 'running', 'completed', 'failed'].includes(value.status)) invalid('Daily synthesis status is invalid.');
  if (value.status === 'completed' && !text(value.completedAt)) invalid('Completed daily synthesis requires a completion time.');
  if (value.status === 'failed' && !text(value.failureReason)) invalid('Failed daily synthesis requires a failure reason.');
}

function assertDailyIssue(issue: DailyIssue): void {
  if (!text(issue.issueId) || !validFingerprint(issue.issueFingerprint)) invalid('Daily issue fingerprint is invalid.');
  if (!CATEGORIES.includes(issue.category) || !SEVERITIES.includes(issue.severity)) invalid('Daily issue category or severity is invalid.');
  for (const value of [issue.title, issue.summary, issue.impact, issue.recommendation, issue.createdAt]) {
    if (!text(value)) invalid('Daily issue is incomplete.');
  }
  if (issue.sourceJudgementIds.length === 0 || new Set(issue.sourceJudgementIds).size !== issue.sourceJudgementIds.length) {
    invalid('Daily issue source judgements are invalid.');
  }
}

function validFingerprint(value: string): boolean {
  return /^[a-z][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*){1,4}$/.test(value);
}

function requiredText(value: unknown, label: string): string {
  if (!text(value)) invalid(`${label} is invalid.`);
  return value.trim();
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new TypeError(message);
}
