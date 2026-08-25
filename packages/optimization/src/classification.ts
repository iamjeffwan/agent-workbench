import type { DailyIssueSource, ImpactSignal, OptimizationIssue } from './types.js';

export type ClassificationDecision = {
  dailyIssueId: string;
  targetType: 'existing' | 'new';
  targetId: string;
  confidence: number;
  rationale: string;
  signals: ImpactSignal[];
};

export const OPTIMIZATION_CLASSIFICATION_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['decisions'], properties: {
    decisions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['dailyIssueId', 'targetType', 'targetId', 'confidence', 'rationale', 'signals'],
      properties: {
        dailyIssueId: { type: 'string', minLength: 1 }, targetType: { type: 'string', enum: ['existing', 'new'] },
        targetId: { type: 'string', minLength: 1 }, confidence: { type: 'number', minimum: 0, maximum: 1 },
        rationale: { type: 'string', minLength: 1 }, signals: { type: 'array', items: { type: 'object', additionalProperties: false,
          required: ['key', 'label', 'level', 'confidence', 'rationale', 'sourceJudgementIds'], properties: {
            key: { type: 'string', pattern: '^[a-z][a-z0-9_:-]{1,63}$' }, label: { type: 'string', minLength: 1 },
            level: { type: 'string', enum: ['none', 'low', 'medium', 'high'] }, confidence: { type: 'number', minimum: 0, maximum: 1 },
            rationale: { type: 'string', minLength: 1 }, sourceJudgementIds: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
          } } },
      } } },
  },
};

export function classificationPrompt(sources: DailyIssueSource[], issues: OptimizationIssue[]): string {
  return [
    'Classify every new daily issue into the existing project issue pool or a new group.',
    'Match by root cause, not wording, category, tool name, or symptom alone. Existing issue IDs must come from the supplied pool.',
    'New issues with the same root cause must share the same new targetId. Exact known fingerprints should remain together.',
    'Also emit open impact signals grounded in the supplied judgements and evidence. Do not estimate exact wasted token counts.',
    'Return only the requested structured output.',
    `Existing issues:\n${JSON.stringify(issues)}`,
    `New daily issues:\n${JSON.stringify(sources)}`,
  ].join('\n\n');
}

export function assertClassificationOutput(value: unknown, sources: DailyIssueSource[], issues: OptimizationIssue[]): ClassificationDecision[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { decisions?: unknown }).decisions)) throw new TypeError('Classification decisions are missing.');
  const sourceIds = new Set(sources.map(item => item.dailyIssueId));
  const existingIds = new Set(issues.map(item => item.issueId));
  const seen = new Set<string>();
  const decisions = (value as { decisions: ClassificationDecision[] }).decisions;
  for (const item of decisions) {
    if (!sourceIds.has(item.dailyIssueId) || seen.has(item.dailyIssueId)) throw new TypeError('Classification contains an unavailable or duplicate daily issue.');
    if (!['existing', 'new'].includes(item.targetType) || typeof item.targetId !== 'string' || !item.targetId.trim()) throw new TypeError('Classification target is invalid.');
    if (item.targetType === 'existing' && !existingIds.has(item.targetId)) throw new TypeError('Classification references an unavailable existing issue.');
    if (typeof item.confidence !== 'number' || item.confidence < 0 || item.confidence > 1 || !item.rationale?.trim()) throw new TypeError('Classification explanation is invalid.');
    const judgementIds = new Set(sources.find(source => source.dailyIssueId === item.dailyIssueId)!.judgements.map(j => j.judgementId));
    if (!Array.isArray(item.signals) || item.signals.some(signal => !/^[a-z][a-z0-9_:-]{1,63}$/.test(signal.key)
      || !['none', 'low', 'medium', 'high'].includes(signal.level) || signal.confidence < 0 || signal.confidence > 1
      || signal.sourceJudgementIds.some(id => !judgementIds.has(id)))) throw new TypeError('Classification impact signal is invalid.');
    seen.add(item.dailyIssueId);
  }
  if (seen.size !== sourceIds.size) throw new TypeError('Classification must cover every daily issue.');
  return structuredClone(decisions);
}
