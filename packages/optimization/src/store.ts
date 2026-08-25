import type { DailyIssueAssignment, OptimizationIssue, OptimizationStore } from './types.js';
import { aggregateIssue } from './aggregate.js';

export function createInMemoryOptimizationStore(): OptimizationStore {
  const issues = new Map<string, OptimizationIssue>();
  const assignments = new Map<string, DailyIssueAssignment>();
  const processed = new Map<string, 'completed'|'failed'>();
  return {
    async hasProcessedBatch(batchId) { return processed.get(batchId) === 'completed'; },
    async recordBatch({ assignments: incoming, newIssues, run }) {
      if (processed.get(run.batchId) === 'completed') return;
      for (const [id, item] of assignments) if (item.source.batchId === run.batchId) assignments.delete(id);
      newIssues.forEach(issue => issues.set(issue.issueId, structuredClone(issue)));
      incoming.forEach(item => assignments.set(item.dailyIssueId, structuredClone(item)));
      processed.set(run.batchId, run.status === 'completed' ? 'completed' : 'failed');
    },
    async recordFailedRun() {},
    async listIssues(projectId) { return details(projectId).map(({ assignments: _a, ...issue }) => issue); },
    async getIssue(projectId, issueId) { return details(projectId).find(item => item.issueId === issueId); },
    async listAssignments(projectId) { return [...assignments.values()].filter(item => item.source.projectId === projectId).map(item => structuredClone(item)); },
    async reassignDailyIssue(projectId, dailyIssueId, targetIssueId) {
      const assignment = assignments.get(dailyIssueId);
      if (!assignment || assignment.source.projectId !== projectId) throw new Error('Daily issue assignment does not exist.');
      let target = targetIssueId && issues.get(targetIssueId);
      if (!target) { target = issueFrom(assignment, `optimization_issue_manual_${dailyIssueId}`); issues.set(target.issueId, target); }
      const { classificationError: _error, ...current } = assignment;
      assignments.set(dailyIssueId, { ...current, issueId: target.issueId, status: 'classified', confidence: 1, rationale: 'Manually reclassified by the local user.', assignedAt: new Date().toISOString() });
      return details(projectId).find(item => item.issueId === target!.issueId)!;
    },
    async mergeIssues(projectId, sourceIssueId, targetIssueId) {
      if (sourceIssueId === targetIssueId || !issues.has(sourceIssueId) || !issues.has(targetIssueId)) throw new Error('Optimization issue merge is invalid.');
      assignments.forEach((item, key) => { if (item.source.projectId === projectId && item.issueId === sourceIssueId) { const { classificationError: _error, ...current } = item; assignments.set(key, { ...current, issueId: targetIssueId, status: 'classified', confidence: 1, rationale: 'Manually merged by the local user.' }); } });
      issues.delete(sourceIssueId);
      return details(projectId).find(item => item.issueId === targetIssueId)!;
    },
  };
  function details(projectId: string) {
    return [...issues.values()].filter(issue => issue.projectId === projectId).flatMap(issue => {
      const owned = [...assignments.values()].filter(item => item.issueId === issue.issueId);
      if (!owned.length) return [];
      const { metrics: _m, highestSeverity: _h, severityCounts: _s, firstSeenAt: _f, lastSeenAt: _l, signals: _g, fingerprints: _p, classificationStatus: _c, ...base } = issue;
      return [aggregateIssue(base, owned)];
    }).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }
}

export function emptyMetrics(): OptimizationIssue['metrics'] { return { judgementCount: 0, episodeCount: 0, activeDayCount: 0, dailyIssueCount: 0, evidenceCount: 0, turnCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: 0, toolCallCount: 0, failedToolCallCount: 0, repeatedToolCallCount: 0, metricsComplete: false }; }
export function issueFrom(assignment: DailyIssueAssignment, issueId: string): OptimizationIssue { const source = assignment.source; return { issueId, projectId: source.projectId, title: source.title, summary: source.summary, category: source.category, fingerprints: [source.fingerprint], createdAt: assignment.assignedAt, updatedAt: assignment.assignedAt, classificationStatus: assignment.status, metrics: emptyMetrics(), highestSeverity: source.severity, severityCounts: { low: 0, medium: 0, high: 0, critical: 0 }, firstSeenAt: source.localDate, lastSeenAt: source.localDate, signals: [] }; }
