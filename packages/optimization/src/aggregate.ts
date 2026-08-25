import type { DailyIssueAssignment, ObjectiveMetrics, OptimizationIssue, OptimizationIssueDetail } from './types.js';

const severityOrder = ['low', 'medium', 'high', 'critical'] as const;

export function aggregateIssue(base: Omit<OptimizationIssue, 'metrics' | 'highestSeverity' | 'severityCounts' | 'firstSeenAt' | 'lastSeenAt' | 'signals' | 'fingerprints' | 'classificationStatus'>, assignments: DailyIssueAssignment[]): OptimizationIssueDetail {
  if (assignments.length === 0) throw new Error(`Optimization issue has no daily issues: ${base.issueId}`);
  const judgementIds = new Set(assignments.flatMap(item => item.source.judgements.map(j => j.judgementId)));
  const evidenceIds = new Set(assignments.flatMap(item => item.source.judgements.flatMap(j => j.evidence.map(e => e.evidenceId))));
  const episodes = unique(assignments.flatMap(item => item.source.episodes), item => item.episodeKey);
  const turns = new Set(episodes.flatMap(item => item.turns.map(turn => `${turn.sessionId}\0${turn.turnId}`)));
  const days = new Set(assignments.map(item => item.source.localDate));
  const metrics: ObjectiveMetrics = {
    judgementCount: judgementIds.size, episodeCount: episodes.length, activeDayCount: days.size,
    dailyIssueCount: assignments.length, evidenceCount: evidenceIds.size, turnCount: turns.size,
    inputTokens: sum(episodes, item => item.metrics.inputTokens), outputTokens: sum(episodes, item => item.metrics.outputTokens),
    totalTokens: sum(episodes, item => item.metrics.totalTokens), durationMs: sum(episodes, item => item.metrics.durationMs),
    toolCallCount: sum(episodes, item => item.metrics.toolCallCount), failedToolCallCount: sum(episodes, item => item.metrics.failedToolCallCount),
    repeatedToolCallCount: sum(episodes, item => item.metrics.repeatedToolCallCount),
    metricsComplete: episodes.every(item => item.metrics.metricsComplete),
  };
  const severityCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  assignments.forEach(item => { severityCounts[item.source.severity] += 1; });
  const highestSeverity = [...severityOrder].reverse().find(level => severityCounts[level] > 0) ?? 'low';
  const signalGroups = new Map<string, DailyIssueAssignment['signals']>();
  assignments.flatMap(item => item.signals).forEach(signal => { const name = signal.label.trim().toLocaleLowerCase(); signalGroups.set(name, [...(signalGroups.get(name) ?? []), signal]); });
  const signals = [...signalGroups.values()].map(values => ({
    ...values.sort((a, b) => b.confidence - a.confidence)[0], occurrenceCount: values.length,
    sourceJudgementIds: [...new Set(values.flatMap(item => item.sourceJudgementIds))],
  })).sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.key.localeCompare(b.key));
  const ordered = [...assignments].sort((a, b) => a.source.localDate.localeCompare(b.source.localDate) || a.dailyIssueId.localeCompare(b.dailyIssueId));
  return {
    ...base, updatedAt: assignments.map(item => item.assignedAt).sort().at(-1) ?? base.updatedAt,
    fingerprints: [...new Set(assignments.map(item => item.source.fingerprint))],
    classificationStatus: assignments.some(item => item.status === 'pending_retry') ? 'pending_retry' : 'classified',
    ...(assignments.find(item => item.classificationError)?.classificationError ? { classificationError: assignments.find(item => item.classificationError)!.classificationError } : {}),
    metrics, highestSeverity, severityCounts, firstSeenAt: ordered[0].source.localDate,
    lastSeenAt: ordered.at(-1)!.source.localDate, signals, assignments: ordered,
  };
}

function unique<T>(values: T[], key: (value: T) => string): T[] { const map = new Map<string, T>(); values.forEach(value => map.set(key(value), value)); return [...map.values()]; }
function sum<T>(values: T[], read: (value: T) => number): number { return values.reduce((total, value) => total + read(value), 0); }
