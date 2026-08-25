import type { LocalDatabase, LocalDatabaseMigration } from '@agent-workbench/local-database';

import type {
  DailyIssue,
  DailyReviewBatch,
  DailyReviewChunk,
  DailyReviewRecord,
  DailyReviewStore,
  Evidence,
  HumanAnnotation,
  ModelJudgement,
  ReusableReviewRun,
  ReusableReviewRunQuery,
  ReviewCase,
  ReviewCaseRecord,
  ReviewRun,
  ReviewRunArtifact,
  ReviewRunResult,
  ReviewStore,
  TemporaryPrompt,
} from './types.js';
import { assertDailyReviewRecord } from './daily-review.js';
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
}, {
  version: 110,
  name: 'daily-review-records-v1',
  statements: [
    `CREATE TABLE daily_review_batches (
      batch_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      local_date TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'partial', 'completed', 'failed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      synthesis_status TEXT NOT NULL CHECK(synthesis_status IN ('queued', 'running', 'completed', 'failed')),
      synthesis_invocation_json TEXT CHECK(synthesis_invocation_json IS NULL OR json_valid(synthesis_invocation_json)),
      synthesis_started_at TEXT,
      synthesis_completed_at TEXT,
      synthesis_usage_json TEXT CHECK(synthesis_usage_json IS NULL OR json_valid(synthesis_usage_json)),
      synthesis_actual_cost REAL CHECK(synthesis_actual_cost IS NULL OR synthesis_actual_cost >= 0),
      synthesis_latency_ms REAL CHECK(synthesis_latency_ms IS NULL OR synthesis_latency_ms >= 0),
      synthesis_failure_reason TEXT,
      synthesis_artifacts_json TEXT CHECK(synthesis_artifacts_json IS NULL OR json_valid(synthesis_artifacts_json)),
      UNIQUE(project_id, local_date)
    ) STRICT`,
    `CREATE TABLE daily_review_chunks (
      chunk_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES daily_review_batches(batch_id) ON DELETE RESTRICT,
      sequence INTEGER NOT NULL CHECK(sequence >= 0),
      group_key TEXT NOT NULL,
      character_count INTEGER NOT NULL CHECK(character_count >= 0),
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed')),
      review_case_id TEXT REFERENCES review_cases(case_id) ON DELETE RESTRICT,
      reused_run_id TEXT REFERENCES review_runs(run_id) ON DELETE RESTRICT,
      started_at TEXT,
      completed_at TEXT,
      failure_reason TEXT,
      UNIQUE(batch_id, sequence)
    ) STRICT`,
    `CREATE TABLE daily_review_chunk_turns (
      chunk_id TEXT NOT NULL REFERENCES daily_review_chunks(chunk_id) ON DELETE RESTRICT,
      sequence INTEGER NOT NULL CHECK(sequence >= 0),
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      PRIMARY KEY(chunk_id, sequence),
      UNIQUE(chunk_id, session_id, turn_id)
    ) STRICT`,
    `CREATE TABLE daily_issues (
      issue_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES daily_review_batches(batch_id) ON DELETE RESTRICT,
      issue_fingerprint TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('process_efficiency', 'tool_usage', 'repeated_failure', 'architecture', 'maintainability', 'performance', 'security', 'testability')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high', 'critical')),
      impact TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(batch_id, issue_fingerprint)
    ) STRICT`,
    `CREATE TABLE daily_issue_judgements (
      issue_id TEXT NOT NULL REFERENCES daily_issues(issue_id) ON DELETE RESTRICT,
      judgement_id TEXT NOT NULL REFERENCES review_judgements(judgement_id) ON DELETE RESTRICT,
      PRIMARY KEY(issue_id, judgement_id)
    ) STRICT`,
    'CREATE INDEX daily_review_batches_project_date ON daily_review_batches(project_id, local_date DESC)',
    'CREATE INDEX daily_review_chunks_batch ON daily_review_chunks(batch_id, sequence)',
    'CREATE INDEX daily_review_chunk_turns_source ON daily_review_chunk_turns(session_id, turn_id)',
    'CREATE INDEX daily_issues_batch ON daily_issues(batch_id, created_at)',
    'CREATE INDEX daily_issue_judgements_judgement ON daily_issue_judgements(judgement_id)',
  ],
}, {
  version: 111,
  name: 'review-annotations-verdicts-v2',
  statements: [
    'DROP INDEX IF EXISTS review_annotations_judgement_created',
    'ALTER TABLE review_annotations RENAME TO review_annotations_legacy',
    `CREATE TABLE review_annotations (
      annotation_id TEXT PRIMARY KEY,
      judgement_id TEXT NOT NULL REFERENCES review_judgements(judgement_id) ON DELETE RESTRICT,
      annotator_id TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK(verdict IN ('correct', 'incorrect')),
      reason TEXT,
      missing_issue TEXT,
      created_at TEXT NOT NULL
    ) STRICT`,
    `INSERT INTO review_annotations(
      annotation_id, judgement_id, annotator_id, verdict, reason, missing_issue, created_at
    )
    SELECT annotation_id, judgement_id, annotator_id,
      CASE WHEN verdict = 'partially_correct' THEN 'incorrect' ELSE verdict END,
      CASE WHEN verdict = 'partially_correct'
        THEN trim(
          CASE WHEN reason IS NULL OR reason = ''
            THEN 'Legacy partially_correct annotation; correction fields were removed.'
            ELSE 'Legacy partially_correct annotation; correction fields were removed. ' || reason
          END
        )
        ELSE reason
      END,
      missing_issue, created_at
    FROM review_annotations_legacy`,
    'DROP TABLE review_annotations_legacy',
    'CREATE INDEX review_annotations_judgement_created ON review_annotations(judgement_id, created_at)',
  ],
}, {
  version: 112,
  name: 'temporary-prompts-v1',
  statements: [
    `CREATE TABLE temporary_prompts (
      prompt_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_name TEXT NOT NULL,
      case_id TEXT NOT NULL REFERENCES review_cases(case_id) ON DELETE RESTRICT,
      run_id TEXT NOT NULL REFERENCES review_runs(run_id) ON DELETE RESTRICT,
      judgement_id TEXT NOT NULL REFERENCES review_judgements(judgement_id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('visible', 'hidden'))
    ) STRICT`,
    'CREATE INDEX temporary_prompts_project_created ON temporary_prompts(project_id, created_at DESC)',
    'CREATE INDEX temporary_prompts_day ON temporary_prompts(project_id, created_at)',
  ],
}];

export function createSqliteReviewStore(options: { database: LocalDatabase }): ReviewStore & DailyReviewStore {
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
            annotation_id, judgement_id, annotator_id, verdict, reason, missing_issue, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          annotation.annotationId,
          annotation.judgementId,
          annotation.annotatorId,
          annotation.verdict,
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

    async findReusableRun(query: ReusableReviewRunQuery): Promise<ReusableReviewRun | undefined> {
      const sourceTypes = query.sourceTypes.filter(value => (
        value === 'task' || value === 'manual_turn_selection' || value === 'daily_auto' || value === 're_review'
      ));
      if (sourceTypes.length === 0) return undefined;
      const placeholders = sourceTypes.map(() => '?').join(', ');
      const rows = database.prepare(`
        SELECT case_id AS caseId FROM review_cases
        WHERE project_id = ? AND source_type IN (${placeholders})
        ORDER BY created_at DESC, case_id DESC LIMIT 1000
      `).all(query.projectId, ...sourceTypes) as Array<{ caseId: string }>;
      const requestedTurns = new Set(query.turns.map(turnKey));
      for (const row of rows) {
        const record = readCase(database, row.caseId);
        if (!record || !sameTurnSet(record.reviewCase.turns, requestedTurns)) continue;
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
      return database.transaction(() => {
        database.prepare(`INSERT INTO temporary_prompts(
          prompt_id, project_id, project_name, case_id, run_id, judgement_id, title, content, created_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(prompt.promptId, prompt.projectId, prompt.projectName, prompt.caseId, prompt.runId,
            prompt.judgementId, prompt.title, prompt.content, prompt.createdAt, prompt.status);
        return structuredClone(prompt);
      });
    },

    async listTemporaryPrompts(options) {
      const clauses = ['project_id = ?'];
      const params: string[] = [options.projectId];
      if (!options.includeHidden) clauses.push("status = 'visible'");
      if (options.createdOn) { clauses.push('created_at >= ? AND created_at < ?'); params.push(`${options.createdOn}T00:00:00.000Z`, `${options.createdOn}T23:59:59.999Z`); }
      const rows = database.prepare(`SELECT
        prompt_id AS promptId, project_id AS projectId, project_name AS projectName,
        case_id AS caseId, run_id AS runId, judgement_id AS judgementId,
        title, content, created_at AS createdAt, status
        FROM temporary_prompts WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, prompt_id DESC`).all(...params) as TemporaryPrompt[];
      return rows.map(row => structuredClone(row));
    },

    async hideTemporaryPrompt(projectId, promptId) {
      const result = database.prepare(`UPDATE temporary_prompts SET status = 'hidden' WHERE prompt_id = ? AND project_id = ?`).run(promptId, projectId);
      if (result.changes === 0) throw new Error(`Temporary prompt does not exist: ${promptId}`);
      const row = database.prepare(`SELECT
        prompt_id AS promptId, project_id AS projectId, project_name AS projectName,
        case_id AS caseId, run_id AS runId, judgement_id AS judgementId,
        title, content, created_at AS createdAt, status
        FROM temporary_prompts WHERE prompt_id = ?`).get(promptId) as TemporaryPrompt;
      return structuredClone(row);
    },

    async createDailyBatch(batch, chunks) {
      return database.transaction(() => {
        if (readDailyBatch(database, batch.batchId)) {
          throw new Error(`Daily review batch already exists: ${batch.batchId}`);
        }
        const duplicate = database.prepare(
          'SELECT batch_id AS batchId FROM daily_review_batches WHERE project_id = ? AND local_date = ?',
        ).get(batch.projectId, batch.localDate) as { batchId: string } | undefined;
        if (duplicate) throw new Error(`Daily review batch already exists for ${batch.projectId}:${batch.localDate}`);
        const record: DailyReviewRecord = { batch, chunks, issues: [] };
        assertDailyReviewRecord(record);
        insertDailyBatch(database, batch);
        chunks.forEach(chunk => insertDailyChunk(database, chunk));
        return structuredClone(record);
      });
    },

    async findDailyBatch(projectId, localDate) {
      const row = database.prepare(
        'SELECT batch_id AS batchId FROM daily_review_batches WHERE project_id = ? AND local_date = ?',
      ).get(projectId, localDate) as { batchId: string } | undefined;
      const record = row ? readDailyBatch(database, row.batchId) : undefined;
      return record ? structuredClone(record) : undefined;
    },

    async getDailyBatch(batchId) {
      const record = readDailyBatch(database, batchId);
      return record ? structuredClone(record) : undefined;
    },

    async appendDailyChunks(batchId, chunks) {
      return database.transaction(() => {
        const record = requiredDailyBatch(database, batchId);
        const next: DailyReviewRecord = { ...record, chunks: [...record.chunks, ...chunks] };
        assertDailyReviewRecord(next);
        chunks.forEach(chunk => insertDailyChunk(database, chunk));
        return structuredClone(next);
      });
    },

    async updateDailyBatch(batch) {
      return database.transaction(() => {
        const record = requiredDailyBatch(database, batch.batchId);
        const next: DailyReviewRecord = { ...record, batch };
        assertDailyReviewRecord(next);
        updateDailyBatchRow(database, batch);
        return structuredClone(next);
      });
    },

    async updateDailyChunk(chunk) {
      return database.transaction(() => {
        const record = requiredDailyBatch(database, chunk.batchId);
        if (!record.chunks.some(item => item.chunkId === chunk.chunkId)) {
          throw new Error(`Daily review chunk does not exist: ${chunk.chunkId}`);
        }
        const next: DailyReviewRecord = {
          ...record,
          chunks: record.chunks.map(item => item.chunkId === chunk.chunkId ? chunk : item),
        };
        assertDailyReviewRecord(next);
        updateDailyChunkRow(database, chunk);
        return structuredClone(next);
      });
    },

    async replaceDailyIssues(batchId, issues) {
      return database.transaction(() => {
        const record = requiredDailyBatch(database, batchId);
        const next: DailyReviewRecord = { ...record, issues };
        assertDailyReviewRecord(next);
        database.prepare('DELETE FROM daily_issue_judgements WHERE issue_id IN (SELECT issue_id FROM daily_issues WHERE batch_id = ?)').run(batchId);
        database.prepare('DELETE FROM daily_issues WHERE batch_id = ?').run(batchId);
        issues.forEach(issue => insertDailyIssue(database, issue));
        return structuredClone(next);
      });
    },

    async listDailyBatches(options) {
      const limit = options.limit === undefined ? null : Math.max(0, options.limit);
      const rows = options.status
        ? limit === null
          ? database.prepare('SELECT batch_id AS batchId FROM daily_review_batches WHERE project_id = ? AND status = ? ORDER BY local_date, batch_id').all(options.projectId, options.status)
          : database.prepare('SELECT batch_id AS batchId FROM daily_review_batches WHERE project_id = ? AND status = ? ORDER BY local_date, batch_id LIMIT ?').all(options.projectId, options.status, limit)
        : limit === null
          ? database.prepare('SELECT batch_id AS batchId FROM daily_review_batches WHERE project_id = ? ORDER BY local_date, batch_id').all(options.projectId)
          : database.prepare('SELECT batch_id AS batchId FROM daily_review_batches WHERE project_id = ? ORDER BY local_date, batch_id LIMIT ?').all(options.projectId, limit);
      return (rows as Array<{batchId:string}>).map(row => structuredClone(requiredDailyBatch(database, row.batchId)));
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
      annotator_id AS annotatorId, verdict, reason, missing_issue AS missingIssue,
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

function readDailyBatch(database: LocalDatabase, batchId: string): DailyReviewRecord | undefined {
  const row = database.prepare(`
    SELECT batch_id AS batchId, project_id AS projectId, local_date AS localDate, time_zone AS timeZone,
      status, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt,
      synthesis_status AS synthesisStatus, synthesis_invocation_json AS synthesisInvocationJson,
      synthesis_started_at AS synthesisStartedAt, synthesis_completed_at AS synthesisCompletedAt,
      synthesis_usage_json AS synthesisUsageJson, synthesis_actual_cost AS synthesisActualCost,
      synthesis_latency_ms AS synthesisLatencyMs, synthesis_failure_reason AS synthesisFailureReason,
      synthesis_artifacts_json AS synthesisArtifactsJson
    FROM daily_review_batches WHERE batch_id = ?
  `).get(batchId) as DailyBatchRow | undefined;
  if (!row) return undefined;
  const chunks = (database.prepare(`
    SELECT chunk_id AS chunkId, batch_id AS batchId, sequence, group_key AS groupKey,
      character_count AS characterCount, status, review_case_id AS reviewCaseId,
      reused_run_id AS reusedRunId, started_at AS startedAt, completed_at AS completedAt,
      failure_reason AS failureReason
    FROM daily_review_chunks WHERE batch_id = ? ORDER BY sequence
  `).all(batchId) as DailyChunkRow[]).map(chunk => ({
    ...compact(chunk),
    turns: database.prepare(`
      SELECT session_id AS sessionId, turn_id AS turnId
      FROM daily_review_chunk_turns WHERE chunk_id = ? ORDER BY sequence
    `).all(chunk.chunkId) as DailyReviewChunk['turns'],
  }));
  const issues = (database.prepare(`
    SELECT issue_id AS issueId, batch_id AS batchId, issue_fingerprint AS issueFingerprint,
      category, title, summary, severity, impact, recommendation, created_at AS createdAt
    FROM daily_issues WHERE batch_id = ? ORDER BY created_at, issue_id
  `).all(batchId) as DailyIssueRow[]).map(issue => ({
    ...issue,
    sourceJudgementIds: (database.prepare(`
      SELECT judgement_id AS judgementId FROM daily_issue_judgements
      WHERE issue_id = ? ORDER BY judgement_id
    `).all(issue.issueId) as Array<{ judgementId: string }>).map(item => item.judgementId),
  }));
  const batch: DailyReviewBatch = {
    batchId: row.batchId,
    projectId: row.projectId,
    localDate: row.localDate,
    timeZone: row.timeZone,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    synthesis: {
      status: row.synthesisStatus,
      ...(row.synthesisInvocationJson ? { invocation: JSON.parse(row.synthesisInvocationJson) } : {}),
      ...(row.synthesisStartedAt ? { startedAt: row.synthesisStartedAt } : {}),
      ...(row.synthesisCompletedAt ? { completedAt: row.synthesisCompletedAt } : {}),
      ...(row.synthesisUsageJson ? { usage: JSON.parse(row.synthesisUsageJson) } : {}),
      ...(row.synthesisActualCost !== null ? { actualCost: row.synthesisActualCost } : {}),
      ...(row.synthesisLatencyMs !== null ? { latencyMs: row.synthesisLatencyMs } : {}),
      ...(row.synthesisFailureReason ? { failureReason: row.synthesisFailureReason } : {}),
      ...(row.synthesisArtifactsJson ? { artifacts: JSON.parse(row.synthesisArtifactsJson) } : {}),
    },
  };
  const record: DailyReviewRecord = { batch, chunks, issues };
  assertDailyReviewRecord(record);
  return record;
}

function requiredDailyBatch(database: LocalDatabase, batchId: string): DailyReviewRecord {
  const record = readDailyBatch(database, batchId);
  if (!record) throw new Error(`Daily review batch does not exist: ${batchId}`);
  return record;
}

function insertDailyBatch(database: LocalDatabase, batch: DailyReviewBatch): void {
  database.prepare(`
    INSERT INTO daily_review_batches(
      batch_id, project_id, local_date, time_zone, status, created_at, updated_at, completed_at,
      synthesis_status, synthesis_invocation_json, synthesis_started_at, synthesis_completed_at,
      synthesis_usage_json, synthesis_actual_cost, synthesis_latency_ms, synthesis_failure_reason,
      synthesis_artifacts_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...dailyBatchValues(batch));
}

function updateDailyBatchRow(database: LocalDatabase, batch: DailyReviewBatch): void {
  database.prepare(`
    UPDATE daily_review_batches SET
      project_id = ?, local_date = ?, time_zone = ?, status = ?, created_at = ?, updated_at = ?,
      completed_at = ?, synthesis_status = ?, synthesis_invocation_json = ?, synthesis_started_at = ?,
      synthesis_completed_at = ?, synthesis_usage_json = ?, synthesis_actual_cost = ?,
      synthesis_latency_ms = ?, synthesis_failure_reason = ?, synthesis_artifacts_json = ?
    WHERE batch_id = ?
  `).run(...dailyBatchValues(batch).slice(1), batch.batchId);
}

function dailyBatchValues(batch: DailyReviewBatch): Array<string | number | null> {
  return [
    batch.batchId, batch.projectId, batch.localDate, batch.timeZone, batch.status, batch.createdAt,
    batch.updatedAt, batch.completedAt ?? null, batch.synthesis.status,
    batch.synthesis.invocation ? JSON.stringify(batch.synthesis.invocation) : null,
    batch.synthesis.startedAt ?? null, batch.synthesis.completedAt ?? null,
    batch.synthesis.usage ? JSON.stringify(batch.synthesis.usage) : null,
    batch.synthesis.actualCost ?? null, batch.synthesis.latencyMs ?? null,
    batch.synthesis.failureReason ?? null,
    batch.synthesis.artifacts ? JSON.stringify(batch.synthesis.artifacts) : null,
  ];
}

function insertDailyChunk(database: LocalDatabase, chunk: DailyReviewChunk): void {
  database.prepare(`
    INSERT INTO daily_review_chunks(
      chunk_id, batch_id, sequence, group_key, character_count, status, review_case_id,
      reused_run_id, started_at, completed_at, failure_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...dailyChunkValues(chunk));
  const insertTurn = database.prepare(`
    INSERT INTO daily_review_chunk_turns(chunk_id, sequence, session_id, turn_id) VALUES (?, ?, ?, ?)
  `);
  chunk.turns.forEach((turn, sequence) => insertTurn.run(chunk.chunkId, sequence, turn.sessionId, turn.turnId));
}

function updateDailyChunkRow(database: LocalDatabase, chunk: DailyReviewChunk): void {
  database.prepare(`
    UPDATE daily_review_chunks SET
      batch_id = ?, sequence = ?, group_key = ?, character_count = ?, status = ?, review_case_id = ?,
      reused_run_id = ?, started_at = ?, completed_at = ?, failure_reason = ?
    WHERE chunk_id = ?
  `).run(...dailyChunkValues(chunk).slice(1), chunk.chunkId);
}

function dailyChunkValues(chunk: DailyReviewChunk): Array<string | number | null> {
  return [
    chunk.chunkId, chunk.batchId, chunk.sequence, chunk.groupKey, chunk.characterCount, chunk.status,
    chunk.reviewCaseId ?? null, chunk.reusedRunId ?? null, chunk.startedAt ?? null,
    chunk.completedAt ?? null, chunk.failureReason ?? null,
  ];
}

function insertDailyIssue(database: LocalDatabase, issue: DailyIssue): void {
  database.prepare(`
    INSERT INTO daily_issues(
      issue_id, batch_id, issue_fingerprint, category, title, summary, severity, impact,
      recommendation, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    issue.issueId, issue.batchId, issue.issueFingerprint, issue.category, issue.title, issue.summary,
    issue.severity, issue.impact, issue.recommendation, issue.createdAt,
  );
  const insertSource = database.prepare(
    'INSERT INTO daily_issue_judgements(issue_id, judgement_id) VALUES (?, ?)',
  );
  issue.sourceJudgementIds.forEach(judgementId => insertSource.run(issue.issueId, judgementId));
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

type DailyBatchRow = {
  batchId: string;
  projectId: string;
  localDate: string;
  timeZone: string;
  status: DailyReviewBatch['status'];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  synthesisStatus: DailyReviewBatch['synthesis']['status'];
  synthesisInvocationJson: string | null;
  synthesisStartedAt: string | null;
  synthesisCompletedAt: string | null;
  synthesisUsageJson: string | null;
  synthesisActualCost: number | null;
  synthesisLatencyMs: number | null;
  synthesisFailureReason: string | null;
  synthesisArtifactsJson: string | null;
};

type DailyChunkRow = Omit<DailyReviewChunk, 'turns'> & {
  reviewCaseId: string | null;
  reusedRunId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
};

type DailyIssueRow = Omit<DailyIssue, 'sourceJudgementIds'>;
