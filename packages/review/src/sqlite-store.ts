import type { LocalDatabase, LocalDatabaseMigration } from '@agent-workbench/local-database';

import type {
  Evidence,
  HumanAnnotation,
  ModelJudgement,
  ReviewCase,
  ReviewCaseRecord,
  ReviewRun,
  ReviewRunArtifact,
  ReviewRunResult,
  ReviewStore,
} from './types.js';
import { assertReviewCaseRecord } from './validate.js';

export const REVIEW_DATABASE_MIGRATIONS: readonly LocalDatabaseMigration[] = [{
  version: 100,
  name: 'review-records-v1',
  statements: [
    `CREATE TABLE review_cases (
      case_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('task', 'manual_turn_selection', 'daily_auto', 're_review')),
      source_task_id TEXT,
      created_at TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE review_case_turns (
      case_id TEXT NOT NULL REFERENCES review_cases(case_id) ON DELETE RESTRICT,
      sequence INTEGER NOT NULL CHECK(sequence >= 0),
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      PRIMARY KEY(case_id, sequence),
      UNIQUE(case_id, session_id, turn_id)
    ) STRICT`,
    `CREATE TABLE review_runs (
      run_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES review_cases(case_id) ON DELETE RESTRICT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      model_version TEXT,
      prompt_version TEXT NOT NULL,
      review_policy_version TEXT NOT NULL,
      evidence_schema_version TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
      usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
      actual_cost REAL CHECK(actual_cost IS NULL OR actual_cost >= 0),
      latency_ms REAL CHECK(latency_ms IS NULL OR latency_ms >= 0),
      failure_reason TEXT,
      artifacts_json TEXT CHECK(artifacts_json IS NULL OR json_valid(artifacts_json))
    ) STRICT`,
    `CREATE TABLE review_judgements (
      judgement_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES review_runs(run_id) ON DELETE RESTRICT,
      category TEXT NOT NULL CHECK(category IN ('process_efficiency', 'tool_usage', 'repeated_failure', 'architecture', 'maintainability', 'performance', 'security', 'testability')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high', 'critical')),
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
      impact TEXT NOT NULL,
      alternative_explanation TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      reviewability TEXT NOT NULL CHECK(reviewability IN ('sufficient', 'insufficient', 'needs_raw', 'needs_project_context')),
      issue_fingerprint TEXT,
      created_at TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE review_evidence (
      evidence_id TEXT PRIMARY KEY,
      judgement_id TEXT NOT NULL REFERENCES review_judgements(judgement_id) ON DELETE RESTRICT,
      evidence_type TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('event', 'turn_diff', 'project_profile', 'environment_snapshot', 'environment_delta', 'project_diff', 'raw_ref', 'project_file')),
      target_id TEXT NOT NULL,
      description TEXT NOT NULL,
      cached_excerpt TEXT,
      cache_expires_at TEXT,
      content_hash TEXT
    ) STRICT`,
    `CREATE TABLE review_annotations (
      annotation_id TEXT PRIMARY KEY,
      judgement_id TEXT NOT NULL REFERENCES review_judgements(judgement_id) ON DELETE RESTRICT,
      annotator_id TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK(verdict IN ('correct', 'partially_correct', 'incorrect')),
      corrected_category TEXT CHECK(corrected_category IS NULL OR corrected_category IN ('process_efficiency', 'tool_usage', 'repeated_failure', 'architecture', 'maintainability', 'performance', 'security', 'testability')),
      corrected_summary TEXT,
      reason TEXT,
      missing_issue TEXT,
      created_at TEXT NOT NULL
    ) STRICT`,
    'CREATE INDEX review_cases_project_created ON review_cases(project_id, created_at DESC)',
    'CREATE INDEX review_case_turns_source ON review_case_turns(session_id, turn_id)',
    'CREATE INDEX review_runs_case_started ON review_runs(case_id, started_at)',
    'CREATE INDEX review_judgements_run_created ON review_judgements(run_id, created_at)',
    'CREATE INDEX review_judgements_fingerprint ON review_judgements(issue_fingerprint)',
    'CREATE INDEX review_evidence_judgement ON review_evidence(judgement_id)',
    'CREATE INDEX review_annotations_judgement_created ON review_annotations(judgement_id, created_at)',
  ],
}];

export function createSqliteReviewStore(options: { database: LocalDatabase }): ReviewStore {
  const database = options.database;
  database.migrate(REVIEW_DATABASE_MIGRATIONS);

  return {
    async createCase(reviewCase) {
      return database.transaction(() => {
        if (readCase(database, reviewCase.caseId)) {
          throw new Error(`Review case already exists: ${reviewCase.caseId}`);
        }
        const record = emptyRecord(reviewCase);
        assertReviewCaseRecord(record);
        database.prepare(`
          INSERT INTO review_cases(case_id, project_id, source_type, source_task_id, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          reviewCase.caseId,
          reviewCase.projectId,
          reviewCase.sourceType,
          reviewCase.sourceTaskId ?? null,
          reviewCase.createdAt,
        );
        const insertTurn = database.prepare(`
          INSERT INTO review_case_turns(case_id, sequence, session_id, turn_id) VALUES (?, ?, ?, ?)
        `);
        reviewCase.turns.forEach((turn, sequence) => {
          insertTurn.run(reviewCase.caseId, sequence, turn.sessionId, turn.turnId);
        });
        return structuredClone(record);
      });
    },

    async recordRun(result) {
      return database.transaction(() => {
        const record = requiredCase(database, result.run.caseId);
        const existing = record.runs.find(run => run.runId === result.run.runId);
        if (existing) assertRunTransition(existing, result.run);
        assertUnusedResultIds(database, result, existing !== undefined);
        const next: ReviewCaseRecord = {
          ...record,
          runs: existing
            ? record.runs.map(run => run.runId === result.run.runId ? result.run : run)
            : [...record.runs, result.run],
          judgements: [...record.judgements, ...result.judgements],
          evidence: [...record.evidence, ...result.evidence],
        };
        assertReviewCaseRecord(next);
        if (existing) updateRun(database, result.run);
        else insertRun(database, result.run);
        result.judgements.forEach(judgement => insertJudgement(database, judgement));
        result.evidence.forEach(evidence => insertEvidence(database, evidence));
        return structuredClone(next);
      });
    },

    async appendAnnotation(annotation) {
      return database.transaction(() => {
        if (database.prepare(
          'SELECT 1 AS found FROM review_annotations WHERE annotation_id = ?',
        ).get(annotation.annotationId)) {
          throw new Error(`Human annotation already exists: ${annotation.annotationId}`);
        }
        const owner = database.prepare(`
          SELECT runs.case_id AS caseId
          FROM review_judgements judgements
          JOIN review_runs runs ON runs.run_id = judgements.run_id
          WHERE judgements.judgement_id = ?
        `).get(annotation.judgementId) as { caseId: string } | undefined;
        if (!owner) throw new Error(`Judgement does not exist: ${annotation.judgementId}`);
        const record = requiredCase(database, owner.caseId);
        const next = { ...record, annotations: [...record.annotations, annotation] };
        assertReviewCaseRecord(next);
        database.prepare(`
          INSERT INTO review_annotations(
            annotation_id, judgement_id, annotator_id, verdict, corrected_category,
            corrected_summary, reason, missing_issue, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          annotation.annotationId,
          annotation.judgementId,
          annotation.annotatorId,
          annotation.verdict,
          annotation.correctedCategory ?? null,
          annotation.correctedSummary ?? null,
          annotation.reason ?? null,
          annotation.missingIssue ?? null,
          annotation.createdAt,
        );
        return structuredClone(next);
      });
    },

    async getCase(caseId) {
      const record = readCase(database, caseId);
      return record ? structuredClone(record) : undefined;
    },

    async listCases(options = {}) {
      const limit = normalizeLimit(options.limit);
      const rows = options.projectId
        ? database.prepare(`
            SELECT case_id AS caseId FROM review_cases
            WHERE project_id = ? ORDER BY created_at DESC, case_id DESC LIMIT ?
          `).all(options.projectId, limit)
        : database.prepare(`
            SELECT case_id AS caseId FROM review_cases
            ORDER BY created_at DESC, case_id DESC LIMIT ?
          `).all(limit);
      return (rows as Array<{ caseId: string }>).map(row => requiredCase(database, row.caseId).reviewCase);
    },
  };
}

function readCase(database: LocalDatabase, caseId: string): ReviewCaseRecord | undefined {
  const caseRow = database.prepare(`
    SELECT case_id AS caseId, project_id AS projectId, source_type AS sourceType,
      source_task_id AS sourceTaskId, created_at AS createdAt
    FROM review_cases WHERE case_id = ?
  `).get(caseId) as CaseRow | undefined;
  if (!caseRow) return undefined;
  const turns = database.prepare(`
    SELECT session_id AS sessionId, turn_id AS turnId
    FROM review_case_turns WHERE case_id = ? ORDER BY sequence
  `).all(caseId) as ReviewCase['turns'];
  const runs = (database.prepare(`
    SELECT run_id AS runId, case_id AS caseId, provider, model, model_version AS modelVersion,
      prompt_version AS promptVersion, review_policy_version AS reviewPolicyVersion,
      evidence_schema_version AS evidenceSchemaVersion, started_at AS startedAt,
      completed_at AS completedAt, status, usage_json AS usageJson, actual_cost AS actualCost,
      latency_ms AS latencyMs, failure_reason AS failureReason, artifacts_json AS artifactsJson
    FROM review_runs WHERE case_id = ? ORDER BY started_at, run_id
  `).all(caseId) as RunRow[]).map(mapRun);
  const judgements = database.prepare(`
    SELECT judgement_id AS judgementId, judgements.run_id AS runId, category, title, summary,
      severity, confidence, impact, alternative_explanation AS alternativeExplanation,
      recommendation, reviewability, issue_fingerprint AS issueFingerprint, created_at AS createdAt
    FROM review_judgements judgements
    JOIN review_runs runs ON runs.run_id = judgements.run_id
    WHERE runs.case_id = ? ORDER BY judgements.created_at, judgements.judgement_id
  `).all(caseId) as ModelJudgement[];
  const evidence = database.prepare(`
    SELECT evidence_id AS evidenceId, evidence.judgement_id AS judgementId,
      evidence_type AS evidenceType, target_type AS targetType, target_id AS targetId,
      description, cached_excerpt AS cachedExcerpt, cache_expires_at AS cacheExpiresAt,
      content_hash AS contentHash
    FROM review_evidence evidence
    JOIN review_judgements judgements ON judgements.judgement_id = evidence.judgement_id
    JOIN review_runs runs ON runs.run_id = judgements.run_id
    WHERE runs.case_id = ? ORDER BY evidence.evidence_id
  `).all(caseId) as Evidence[];
  const annotations = database.prepare(`
    SELECT annotation_id AS annotationId, annotations.judgement_id AS judgementId,
      annotator_id AS annotatorId, verdict, corrected_category AS correctedCategory,
      corrected_summary AS correctedSummary, reason, missing_issue AS missingIssue,
      annotations.created_at AS createdAt
    FROM review_annotations annotations
    JOIN review_judgements judgements ON judgements.judgement_id = annotations.judgement_id
    JOIN review_runs runs ON runs.run_id = judgements.run_id
    WHERE runs.case_id = ? ORDER BY annotations.created_at, annotations.annotation_id
  `).all(caseId) as HumanAnnotation[];
  const reviewCase: ReviewCase = {
    caseId: caseRow.caseId,
    projectId: caseRow.projectId,
    sourceType: caseRow.sourceType,
    ...(caseRow.sourceTaskId ? { sourceTaskId: caseRow.sourceTaskId } : {}),
    turns,
    createdAt: caseRow.createdAt,
  };
  const record: ReviewCaseRecord = {
    schemaVersion: '1.0-draft', reviewCase, runs,
    judgements: judgements.map(compact), evidence: evidence.map(compact), annotations: annotations.map(compact),
  };
  assertReviewCaseRecord(record);
  return record;
}

function requiredCase(database: LocalDatabase, caseId: string): ReviewCaseRecord {
  const record = readCase(database, caseId);
  if (!record) throw new Error(`Review case does not exist: ${caseId}`);
  return record;
}

function insertRun(database: LocalDatabase, run: ReviewRun): void {
  database.prepare(`
    INSERT INTO review_runs(
      run_id, case_id, provider, model, model_version, prompt_version, review_policy_version,
      evidence_schema_version, started_at, completed_at, status, usage_json, actual_cost,
      latency_ms, failure_reason, artifacts_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...runValues(run));
}

function updateRun(database: LocalDatabase, run: ReviewRun): void {
  const values = runValues(run);
  database.prepare(`
    UPDATE review_runs SET
      case_id = ?, provider = ?, model = ?, model_version = ?, prompt_version = ?,
      review_policy_version = ?, evidence_schema_version = ?, started_at = ?, completed_at = ?,
      status = ?, usage_json = ?, actual_cost = ?, latency_ms = ?, failure_reason = ?, artifacts_json = ?
    WHERE run_id = ?
  `).run(...values.slice(1), run.runId);
}

function runValues(run: ReviewRun): Array<string | number | null> {
  return [
    run.runId, run.caseId, run.invocation.provider, run.invocation.model,
    run.invocation.modelVersion ?? null, run.invocation.promptVersion,
    run.invocation.reviewPolicyVersion, run.invocation.evidenceSchemaVersion,
    run.startedAt, run.completedAt ?? null, run.status,
    run.usage ? JSON.stringify(run.usage) : null,
    run.actualCost ?? null, run.latencyMs ?? null, run.failureReason ?? null,
    run.artifacts ? JSON.stringify(run.artifacts) : null,
  ];
}

function insertJudgement(database: LocalDatabase, item: ModelJudgement): void {
  database.prepare(`
    INSERT INTO review_judgements(
      judgement_id, run_id, category, title, summary, severity, confidence, impact,
      alternative_explanation, recommendation, reviewability, issue_fingerprint, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.judgementId, item.runId, item.category, item.title, item.summary, item.severity,
    item.confidence, item.impact, item.alternativeExplanation, item.recommendation,
    item.reviewability, item.issueFingerprint ?? null, item.createdAt,
  );
}

function insertEvidence(database: LocalDatabase, item: Evidence): void {
  database.prepare(`
    INSERT INTO review_evidence(
      evidence_id, judgement_id, evidence_type, target_type, target_id, description,
      cached_excerpt, cache_expires_at, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.evidenceId, item.judgementId, item.evidenceType, item.targetType, item.targetId,
    item.description, item.cachedExcerpt ?? null, item.cacheExpiresAt ?? null, item.contentHash ?? null,
  );
}

function assertUnusedResultIds(database: LocalDatabase, result: ReviewRunResult, advancing: boolean): void {
  if (!advancing && exists(database, 'review_runs', 'run_id', result.run.runId)) {
    throw new Error(`Review run already exists: ${result.run.runId}`);
  }
  for (const item of result.judgements) {
    if (exists(database, 'review_judgements', 'judgement_id', item.judgementId)) {
      throw new Error(`Model judgement already exists: ${item.judgementId}`);
    }
  }
  for (const item of result.evidence) {
    if (exists(database, 'review_evidence', 'evidence_id', item.evidenceId)) {
      throw new Error(`Evidence already exists: ${item.evidenceId}`);
    }
  }
}

function exists(database: LocalDatabase, table: string, column: string, value: string): boolean {
  return Boolean(database.prepare(`SELECT 1 AS found FROM ${table} WHERE ${column} = ?`).get(value));
}

function assertRunTransition(previous: ReviewRun, next: ReviewRun): void {
  if (['completed', 'failed', 'cancelled'].includes(previous.status)) {
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
  return { schemaVersion: '1.0-draft', reviewCase, runs: [], judgements: [], evidence: [], annotations: [] };
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new TypeError('Review case list limit must be an integer between 1 and 1000.');
  }
  return value;
}

function mapRun(row: RunRow): ReviewRun {
  return {
    runId: row.runId,
    caseId: row.caseId,
    invocation: {
      provider: row.provider,
      model: row.model,
      ...(row.modelVersion ? { modelVersion: row.modelVersion } : {}),
      promptVersion: row.promptVersion,
      reviewPolicyVersion: row.reviewPolicyVersion,
      evidenceSchemaVersion: row.evidenceSchemaVersion,
    },
    startedAt: row.startedAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    status: row.status,
    ...(row.usageJson ? { usage: JSON.parse(row.usageJson) } : {}),
    ...(row.actualCost !== null ? { actualCost: row.actualCost } : {}),
    ...(row.latencyMs !== null ? { latencyMs: row.latencyMs } : {}),
    ...(row.failureReason ? { failureReason: row.failureReason } : {}),
    ...(row.artifactsJson ? { artifacts: JSON.parse(row.artifactsJson) as ReviewRunArtifact[] } : {}),
  };
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined)) as T;
}

type CaseRow = {
  caseId: string;
  projectId: string;
  sourceType: ReviewCase['sourceType'];
  sourceTaskId: string | null;
  createdAt: string;
};

type RunRow = {
  runId: string;
  caseId: string;
  provider: string;
  model: string;
  modelVersion: string | null;
  promptVersion: string;
  reviewPolicyVersion: string;
  evidenceSchemaVersion: string;
  startedAt: string;
  completedAt: string | null;
  status: ReviewRun['status'];
  usageJson: string | null;
  actualCost: number | null;
  latencyMs: number | null;
  failureReason: string | null;
  artifactsJson: string | null;
};
