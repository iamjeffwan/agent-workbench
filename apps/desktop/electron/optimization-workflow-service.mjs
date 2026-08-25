import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { adaptCodexSession } from '@agent-workbench/codex-adapter';
import { createCodexCliReviewModelAdapter } from '@agent-workbench/review';
import {
  OPTIMIZATION_CLASSIFICATION_SCHEMA,
  assertClassificationOutput,
  classificationPrompt,
  createSqliteOptimizationStore,
  emptyMetrics,
} from '@agent-workbench/optimization';
import { openElectronReviewDatabase, resolveDefaultReviewDatabasePath } from './local-review-database.mjs';
import { cleanString, createServiceResultHelpers, errorMessage } from './service-result-helpers.mjs';

const SOURCE = 'workbench-optimization';
const MODEL = 'gpt-5.6-sol';
const { ready, failed } = createServiceResultHelpers(SOURCE);

export function createOptimizationWorkflowService({
  reviewWorkflow, projectObservation, sessionHistory, getUserDataPath,
  openDatabase = openElectronReviewDatabase, createStore = createSqliteOptimizationStore,
  createAdapter = createCodexCliReviewModelAdapter, adaptSession = adaptCodexSession,
  readFile = fs.readFile, now = () => new Date(), createId = () => randomUUID(),
  databasePath = () => resolveDefaultReviewDatabasePath(),
} = {}) {
  if (!reviewWorkflow?.listCompletedDailyReviews || !projectObservation?.read || !sessionHistory?.resolveSessionFiles || typeof getUserDataPath !== 'function') throw new Error('Optimization workflow dependencies are required.');
  let database = null; let store = null; let queue = Promise.resolve();
  async function readyStore() { if (!database) database = await openDatabase({ filePath: databasePath() }); if (!store) store = createStore({ database }); return store; }
  function enqueue(operation) { const result = queue.then(operation); queue = result.catch(() => {}); return result; }

  async function projectContext(projectRoot) {
    const root = cleanString(projectRoot);
    if (!root) return null;
    const result = await projectObservation.read(root);
    const projectId = result?.status === 'ready' ? cleanString(result.data?.projectId) : null;
    return projectId ? { projectId, projectRoot: path.resolve(root) } : null;
  }

  return {
    processProject(projectRoot) { return enqueue(() => processProject(projectRoot)); },
    async list(projectRoot) { const context = await projectContext(projectRoot); if (!context) return failed([], 'The project observation is unavailable.'); return ready(await (await readyStore()).listIssues(context.projectId)); },
    async get(projectRoot, issueId) { const context = await projectContext(projectRoot); if (!context) return failed(null, 'The project observation is unavailable.'); return ready((await (await readyStore()).getIssue(context.projectId, cleanString(issueId))) ?? null); },
    async reassign(projectRoot, dailyIssueId, targetIssueId) { const context = await projectContext(projectRoot); if (!context) return failed(null, 'The project observation is unavailable.'); try { return ready(await (await readyStore()).reassignDailyIssue(context.projectId, cleanString(dailyIssueId), cleanString(targetIssueId) ?? undefined)); } catch (error) { return failed(null, errorMessage(error, 'Unable to reclassify the daily issue.')); } },
    async merge(projectRoot, sourceIssueId, targetIssueId) { const context = await projectContext(projectRoot); if (!context) return failed(null, 'The project observation is unavailable.'); try { return ready(await (await readyStore()).mergeIssues(context.projectId, cleanString(sourceIssueId), cleanString(targetIssueId))); } catch (error) { return failed(null, errorMessage(error, 'Unable to merge optimization issues.')); } },
    async retry(projectRoot) { return enqueue(() => processProject(projectRoot)); },
    close() { database?.close(); database = null; store = null; },
  };

  async function processProject(projectRoot) {
    const context = await projectContext(projectRoot);
    if (!context) return failed(null, 'The project observation is unavailable.');
    const source = await reviewWorkflow.listCompletedDailyReviews(projectRoot);
    if (source.status !== 'ready' || !source.data) return failed(null, source.error ?? 'Daily review history is unavailable.');
    const target = await readyStore();
    const records = [...source.data.records].sort((a, b) => a.batch.localDate.localeCompare(b.batch.localDate));
    let processed = 0;
    for (const record of records) {
      if (await target.hasProcessedBatch(record.batch.batchId)) continue;
      const dailySources = await buildDailySources(projectRoot, record, source.data.cases);
      if (!dailySources.length) { await recordEmpty(target, context.projectId, record.batch.batchId); processed += 1; continue; }
      await classifyBatch(target, projectRoot, context.projectId, record.batch.batchId, dailySources);
      processed += 1;
    }
    return ready({ processed });
  }

  async function classifyBatch(target, projectRoot, projectId, batchId, sources) {
    const existing = await target.listIssues(projectId);
    const startedAt = now();
    const adapter = createAdapter({ artifactDirectory: path.join(getUserDataPath(), 'optimization-runs'), workingDirectory: projectRoot, model: MODEL });
    const runId = `optimization_run_${createId()}`;
    try {
      const response = await adapter.review({ runId, reviewCase: { caseId: batchId, projectId, sourceType: 'daily_auto', turns: [], createdAt: startedAt.toISOString() }, evidencePackage: { optimizationClassification: { sources, existing } }, systemPrompt: classificationPrompt(sources, existing), outputSchema: OPTIMIZATION_CLASSIFICATION_SCHEMA });
      const decisions = assertClassificationOutput(response.output, sources, existing);
      const completedAt = now();
      await persistDecisions(target, sources, existing, decisions, { runId, projectId, batchId, status: 'completed', provider: adapter.descriptor.provider, model: adapter.descriptor.model, ...(adapter.descriptor.modelVersion ? { modelVersion: adapter.descriptor.modelVersion } : {}), startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), latencyMs: Math.max(0, completedAt-startedAt), ...(response.usage ? { usage: response.usage } : {}) }, 'classified');
    } catch (error) {
      const completedAt = now();
      const decisions = fallbackDecisions(sources, existing);
      await persistDecisions(target, sources, existing, decisions, { runId, projectId, batchId, status: 'failed', provider: adapter.descriptor.provider, model: adapter.descriptor.model, ...(adapter.descriptor.modelVersion ? { modelVersion: adapter.descriptor.modelVersion } : {}), startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), latencyMs: Math.max(0, completedAt-startedAt), failureReason: errorMessage(error, 'Optimization classification failed.') }, 'pending_retry');
    }
  }

  async function persistDecisions(target, sources, existing, decisions, run, status) {
    const existingById = new Map(existing.map(item => [item.issueId, item]));
    const fingerprintOwner = new Map(existing.flatMap(item => item.fingerprints.map(value => [value, item.issueId])));
    const groupIds = new Map(); const fingerprintOwners = new Map(fingerprintOwner); const newIssues = []; const assignedAt = now().toISOString();
    const orderedDecisions = sources.map(source => decisions.find(decision => decision.dailyIssueId === source.dailyIssueId));
    const assignments = orderedDecisions.map(decision => {
      const source = sources.find(item => item.dailyIssueId === decision.dailyIssueId);
      const exactOwner = fingerprintOwners.get(source.fingerprint);
      let issueId = exactOwner ?? (decision.targetType === 'existing' && existingById.has(decision.targetId) ? decision.targetId : null);
      if (!issueId) { if (!groupIds.has(decision.targetId)) groupIds.set(decision.targetId, `optimization_issue_${createId()}`); issueId = groupIds.get(decision.targetId); }
      fingerprintOwners.set(source.fingerprint, issueId);
      const assignment = { dailyIssueId: source.dailyIssueId, issueId, source, status, confidence: exactOwner ? 1 : decision.confidence, rationale: exactOwner ? 'Matched an existing fingerprint.' : decision.rationale, signals: decision.signals, assignedAt, ...(run.failureReason ? { classificationError: run.failureReason } : {}) };
      if (!existingById.has(issueId) && !newIssues.some(item => item.issueId === issueId)) newIssues.push({ issueId, projectId: source.projectId, title: source.title, summary: source.summary, category: source.category, fingerprints: [source.fingerprint], createdAt: assignedAt, updatedAt: assignedAt, classificationStatus: status, metrics: emptyMetrics(), highestSeverity: source.severity, severityCounts: { low:0, medium:0, high:0, critical:0 }, firstSeenAt: source.localDate, lastSeenAt: source.localDate, signals: [] });
      return assignment;
    });
    await target.recordBatch({ run, assignments, newIssues });
  }

  async function buildDailySources(projectRoot, daily, cases) {
    const sessionIds = [...new Set(daily.chunks.flatMap(chunk => chunk.turns.map(turn => turn.sessionId)))];
    const resolved = sessionIds.length ? await sessionHistory.resolveSessionFiles(projectRoot, sessionIds) : null;
    const sessions = new Map();
    for (const file of resolved?.data?.sessionFiles ?? []) { try { const adapted = adaptSession(await readFile(file, 'utf8'), { projectId: daily.batch.projectId }); sessions.set(adapted.session.sessionId, adapted.session); } catch {} }
    return daily.issues.map(issue => {
      const judgements = issue.sourceJudgementIds.flatMap(id => Object.values(cases).flatMap(record => record.judgements.filter(item => item.judgementId === id).map(item => ({ ...item, evidence: record.evidence.filter(value => value.judgementId === id) }))));
      const sourceChunks = daily.chunks.filter(chunk => chunk.reviewCaseId && judgements.some(judgement => cases[chunk.reviewCaseId]?.judgements.some(item => item.judgementId === judgement.judgementId)));
      const relatedGroups = new Set(sourceChunks.map(chunk => chunk.groupKey));
      const chunks = daily.chunks.filter(chunk => relatedGroups.has(chunk.groupKey));
      const groupedChunks = new Map();
      chunks.forEach(chunk => {
        const key = `${daily.batch.localDate}\0${chunk.groupKey}`;
        groupedChunks.set(key, [...(groupedChunks.get(key) ?? []), chunk]);
      });
      const episodes = [...groupedChunks.values()].map(group => {
        const chunk = group[0];
        const turns = [...new Map(group.flatMap(item => item.turns).map(turn => [`${turn.sessionId}\0${turn.turnId}`, turn])).values()];
        return { episodeKey: `${daily.batch.localDate}:${chunk.groupKey}`, groupKey: chunk.groupKey, localDate: daily.batch.localDate, turns, metrics: metricsForTurns(turns, sessions) };
      });
      return { dailyIssueId: issue.issueId, batchId: daily.batch.batchId, projectId: daily.batch.projectId, localDate: daily.batch.localDate, fingerprint: issue.issueFingerprint, category: issue.category, title: issue.title, summary: issue.summary, severity: issue.severity, impact: issue.impact, recommendation: issue.recommendation, judgements: judgements.map(item => ({ judgementId:item.judgementId,title:item.title,summary:item.summary,impact:item.impact,recommendation:item.recommendation,evidence:item.evidence.map(value=>({evidenceId:value.evidenceId,description:value.description,...(value.cachedExcerpt?{excerpt:value.cachedExcerpt}: {})})) })), episodes };
    });
  }
}

function metricsForTurns(refs, sessions) {
  const turns = refs.map(ref => sessions.get(ref.sessionId)?.turns.find(turn => turn.turnId === ref.turnId)).filter(Boolean);
  const calls = turns.flatMap(turn => turn.events.filter(event => event.type === 'tool_call'));
  const results = turns.flatMap(turn => turn.events.filter(event => event.type === 'tool_result'));
  const signatures = new Set(); let repeatedToolCallCount = 0;
  calls.forEach(call => { const signature = `${call.sourceToolName ?? call.category ?? ''}\0${JSON.stringify(call.data ?? null)}`; if (signatures.has(signature)) repeatedToolCallCount += 1; else signatures.add(signature); });
  const failedCallIds = new Set(calls.filter(call => call.status === 'failed' && call.callId).map(call => call.callId));
  let failedWithoutId = calls.filter(call => call.status === 'failed' && !call.callId).length;
  results.filter(isFailedToolResult).forEach(result => { if (result.callId) failedCallIds.add(result.callId); else failedWithoutId += 1; });
  return { turnCount: turns.length, inputTokens: sum(turns, turn => turn.usage?.inputTokens), outputTokens: sum(turns, turn => turn.usage?.outputTokens), totalTokens: sum(turns, turn => turn.usage?.totalTokens ?? ((turn.usage?.inputTokens ?? 0)+(turn.usage?.outputTokens ?? 0))), durationMs: sum(turns, turn => turn.durationMs), toolCallCount: calls.length, failedToolCallCount: failedCallIds.size + failedWithoutId, repeatedToolCallCount, metricsComplete: turns.length === refs.length && turns.every(turn => turn.usage?.totalTokens !== undefined && turn.durationMs !== undefined) };
}
function isFailedToolResult(result) { const value = typeof result.data === 'string' ? parseJson(result.data) : result.data; return result.status === 'failed' || value?.isError === true || value?.exit_code > 0 || value?.exitCode > 0 || value?.status === 'failed'; }
function parseJson(value) { try { return JSON.parse(value); } catch { return null; } }
function fallbackDecisions(sources, existing) { const owners = new Map(existing.flatMap(item => item.fingerprints.map(value => [value,item.issueId]))); return sources.map(source => ({ dailyIssueId:source.dailyIssueId,targetType:owners.has(source.fingerprint)?'existing':'new',targetId:owners.get(source.fingerprint)??source.fingerprint,confidence:owners.has(source.fingerprint)?1:0,rationale:owners.has(source.fingerprint)?'Matched an existing fingerprint.':'Stored by exact fingerprint until semantic classification can be retried.',signals:[] })); }
async function recordEmpty(store, projectId, batchId) { const timestamp=new Date().toISOString(); await store.recordBatch({ run:{runId:`optimization_empty_${batchId}`,projectId,batchId,status:'completed',provider:'none',model:'none',startedAt:timestamp,completedAt:timestamp,latencyMs:0}, assignments:[], newIssues:[] }); }
function sum(values, read) { return values.reduce((total,value)=>total+(Number(read(value))||0),0); }
