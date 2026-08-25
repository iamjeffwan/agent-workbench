import type { LocalDatabase, LocalDatabaseMigration } from '@agent-workbench/local-database';
import type { ClassificationRun, DailyIssueAssignment, OptimizationIssue, OptimizationStore } from './types.js';
import { aggregateIssue } from './aggregate.js';
import { issueFrom } from './store.js';

export const OPTIMIZATION_DATABASE_MIGRATIONS: readonly LocalDatabaseMigration[] = [{
  version: 200, name: 'optimization-issues-v1', statements: [
    `CREATE TABLE optimization_issues (
      issue_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
      category TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE optimization_daily_assignments (
      daily_issue_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, project_id TEXT NOT NULL,
      issue_id TEXT NOT NULL REFERENCES optimization_issues(issue_id) ON DELETE RESTRICT,
      source_json TEXT NOT NULL CHECK(json_valid(source_json)), status TEXT NOT NULL CHECK(status IN ('classified','pending_retry')),
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1), rationale TEXT NOT NULL,
      classification_error TEXT, signals_json TEXT NOT NULL CHECK(json_valid(signals_json)), assigned_at TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE optimization_classification_runs (
      run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, batch_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running','completed','failed')), provider TEXT NOT NULL, model TEXT NOT NULL, model_version TEXT,
      started_at TEXT NOT NULL, completed_at TEXT, failure_reason TEXT, usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)), latency_ms REAL
    ) STRICT`,
    `CREATE TABLE optimization_reclassifications (
      change_id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, daily_issue_id TEXT,
      source_issue_id TEXT NOT NULL, target_issue_id TEXT NOT NULL, change_type TEXT NOT NULL CHECK(change_type IN ('move','merge')),
      changed_at TEXT NOT NULL
    ) STRICT`,
    'CREATE INDEX optimization_issues_project ON optimization_issues(project_id, updated_at DESC)',
    'CREATE INDEX optimization_assignments_issue ON optimization_daily_assignments(issue_id, assigned_at)',
    'CREATE INDEX optimization_assignments_batch ON optimization_daily_assignments(batch_id)',
    'CREATE INDEX optimization_runs_batch ON optimization_classification_runs(batch_id, started_at)',
  ],
}];

export function createSqliteOptimizationStore({ database }: { database: LocalDatabase }): OptimizationStore {
  database.migrate(OPTIMIZATION_DATABASE_MIGRATIONS);
  return {
    async hasProcessedBatch(batchId) { return Boolean(database.prepare("SELECT 1 AS found FROM optimization_classification_runs WHERE batch_id = ? AND status = 'completed'").get(batchId)); },
    async recordBatch({ run, assignments, newIssues }) {
      database.transaction(() => {
        const completed = database.prepare("SELECT 1 AS found FROM optimization_classification_runs WHERE batch_id = ? AND status = 'completed'").get(run.batchId);
        if (completed) return;
        const previousAssignment = database.prepare('SELECT 1 AS found FROM optimization_daily_assignments WHERE batch_id = ?').get(run.batchId);
        if (previousAssignment) {
          database.prepare('DELETE FROM optimization_daily_assignments WHERE batch_id = ?').run(run.batchId);
          database.prepare('DELETE FROM optimization_issues WHERE issue_id NOT IN (SELECT DISTINCT issue_id FROM optimization_daily_assignments)').run();
        }
        newIssues.forEach(issue => insertIssue(database, issue));
        assignments.forEach(item => {
          if (!database.prepare('SELECT 1 AS found FROM optimization_issues WHERE issue_id = ?').get(item.issueId)) insertIssue(database, issueFrom(item, item.issueId));
          database.prepare(`INSERT INTO optimization_daily_assignments(
            daily_issue_id,batch_id,project_id,issue_id,source_json,status,confidence,rationale,classification_error,signals_json,assigned_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(item.dailyIssueId, item.source.batchId, item.source.projectId, item.issueId,
            JSON.stringify(item.source), item.status, item.confidence, item.rationale, item.classificationError ?? null, JSON.stringify(item.signals), item.assignedAt);
          database.prepare('UPDATE optimization_issues SET updated_at = ? WHERE issue_id = ?').run(item.assignedAt, item.issueId);
        });
        insertRun(database, run);
      });
    },
    async recordFailedRun(run) { if (!database.prepare('SELECT 1 AS found FROM optimization_classification_runs WHERE run_id = ?').get(run.runId)) insertRun(database, run); },
    async listIssues(projectId) { return issueDetails(database, projectId).map(({ assignments: _a, ...issue }) => issue); },
    async getIssue(projectId, issueId) { return issueDetails(database, projectId).find(item => item.issueId === issueId); },
    async listAssignments(projectId) { return readAssignments(database, projectId); },
    async reassignDailyIssue(projectId, dailyIssueId, targetIssueId) {
      return database.transaction(() => {
        const assignment = readAssignments(database, projectId).find(item => item.dailyIssueId === dailyIssueId);
        if (!assignment) throw new Error('Daily issue assignment does not exist.');
        const sourceIssueId = assignment.issueId;
        let target = targetIssueId && readIssue(database, projectId, targetIssueId);
        if (!target) { target = issueFrom(assignment, `optimization_issue_manual_${dailyIssueId}`); insertIssue(database, target); }
        const timestamp = new Date().toISOString();
        database.prepare(`UPDATE optimization_daily_assignments SET issue_id=?, status='classified', confidence=1, rationale=?, classification_error=NULL, assigned_at=? WHERE daily_issue_id=?`).run(target.issueId, 'Manually reclassified by the local user.', timestamp, dailyIssueId);
        recordChange(database, projectId, dailyIssueId, sourceIssueId, target.issueId, 'move', timestamp);
        removeEmptyIssue(database, sourceIssueId);
        return issueDetails(database, projectId).find(item => item.issueId === target!.issueId)!;
      });
    },
    async mergeIssues(projectId, sourceIssueId, targetIssueId) {
      return database.transaction(() => {
        if (sourceIssueId === targetIssueId || !readIssue(database, projectId, sourceIssueId) || !readIssue(database, projectId, targetIssueId)) throw new Error('Optimization issue merge is invalid.');
        const timestamp = new Date().toISOString();
        database.prepare(`UPDATE optimization_daily_assignments SET issue_id=?, status='classified', confidence=1, rationale=?, classification_error=NULL, assigned_at=? WHERE project_id=? AND issue_id=?`).run(targetIssueId, 'Manually merged by the local user.', timestamp, projectId, sourceIssueId);
        recordChange(database, projectId, null, sourceIssueId, targetIssueId, 'merge', timestamp);
        removeEmptyIssue(database, sourceIssueId);
        return issueDetails(database, projectId).find(item => item.issueId === targetIssueId)!;
      });
    },
  };
}

function insertIssue(database: LocalDatabase, issue: Pick<OptimizationIssue, 'issueId'|'projectId'|'title'|'summary'|'category'|'createdAt'|'updatedAt'>) { database.prepare('INSERT INTO optimization_issues(issue_id,project_id,title,summary,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(issue.issueId, issue.projectId, issue.title, issue.summary, issue.category, issue.createdAt, issue.updatedAt); }
function insertRun(database: LocalDatabase, run: ClassificationRun) { database.prepare(`INSERT INTO optimization_classification_runs(run_id,project_id,batch_id,status,provider,model,model_version,started_at,completed_at,failure_reason,usage_json,latency_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(run.runId, run.projectId, run.batchId, run.status, run.provider, run.model, run.modelVersion ?? null, run.startedAt, run.completedAt ?? null, run.failureReason ?? null, run.usage ? JSON.stringify(run.usage) : null, run.latencyMs ?? null); }
function readIssue(database: LocalDatabase, projectId: string, issueId: string) { return database.prepare('SELECT issue_id AS issueId,project_id AS projectId,title,summary,category,created_at AS createdAt,updated_at AS updatedAt FROM optimization_issues WHERE project_id=? AND issue_id=?').get(projectId, issueId) as Omit<OptimizationIssue, 'metrics'|'highestSeverity'|'severityCounts'|'firstSeenAt'|'lastSeenAt'|'signals'|'fingerprints'|'classificationStatus'> | undefined; }
function readAssignments(database: LocalDatabase, projectId: string): DailyIssueAssignment[] { const rows = database.prepare('SELECT daily_issue_id AS dailyIssueId,issue_id AS issueId,source_json AS sourceJson,status,confidence,rationale,classification_error AS classificationError,signals_json AS signalsJson,assigned_at AS assignedAt FROM optimization_daily_assignments WHERE project_id=? ORDER BY assigned_at,daily_issue_id').all(projectId) as Array<Record<string, unknown>>; return rows.map(row => ({ dailyIssueId: row.dailyIssueId as string, issueId: row.issueId as string, source: JSON.parse(row.sourceJson as string), status: row.status as DailyIssueAssignment['status'], confidence: row.confidence as number, rationale: row.rationale as string, ...(row.classificationError ? { classificationError: row.classificationError as string } : {}), signals: JSON.parse(row.signalsJson as string), assignedAt: row.assignedAt as string })); }
function issueDetails(database: LocalDatabase, projectId: string) { const rows = database.prepare('SELECT issue_id AS issueId,project_id AS projectId,title,summary,category,created_at AS createdAt,updated_at AS updatedAt FROM optimization_issues WHERE project_id=?').all(projectId) as Array<Omit<OptimizationIssue, 'metrics'|'highestSeverity'|'severityCounts'|'firstSeenAt'|'lastSeenAt'|'signals'|'fingerprints'|'classificationStatus'>>; const assignments = readAssignments(database, projectId); return rows.flatMap(row => { const owned=assignments.filter(item=>item.issueId===row.issueId); return owned.length?[aggregateIssue(row,owned)]:[]; }).sort((a,b)=>b.lastSeenAt.localeCompare(a.lastSeenAt)); }
function recordChange(database: LocalDatabase, projectId: string, dailyIssueId: string|null, sourceIssueId: string, targetIssueId: string, type: 'move'|'merge', timestamp: string) { database.prepare('INSERT INTO optimization_reclassifications(project_id,daily_issue_id,source_issue_id,target_issue_id,change_type,changed_at) VALUES (?,?,?,?,?,?)').run(projectId,dailyIssueId,sourceIssueId,targetIssueId,type,timestamp); }
function removeEmptyIssue(database: LocalDatabase, issueId: string) { if (!database.prepare('SELECT 1 AS found FROM optimization_daily_assignments WHERE issue_id=? LIMIT 1').get(issueId)) database.prepare('DELETE FROM optimization_issues WHERE issue_id=?').run(issueId); }
