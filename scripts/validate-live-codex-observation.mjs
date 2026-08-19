#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  adaptCodexSession,
  findCodexSessions,
  readCodexProjectTimelineEvents,
  readCodexSessionMetadata,
} from '@agent-workbench/codex-adapter';
import {
  captureProjectState,
  deriveProjectTurnFacts,
} from '@agent-workbench/project-observation';
import { createProjectObservationService } from '../apps/desktop/electron/project-observation-service.mjs';

if (process.argv[2] === '--recheck') {
  const previousReport = JSON.parse(fs.readFileSync(path.resolve(process.argv[3]), 'utf8'));
  const canonicalSession = adaptCodexSession(previousReport.sessionFile, {
    projectId: `live-validation:${path.basename(previousReport.runRoot)}`,
  });
  const legacyEvents = readCodexProjectTimelineEvents({
    projectRoot: previousReport.projectRoot,
    sessionFiles: [previousReport.sessionFile],
  });
  const comparison = compareResults({
    sessionFile: previousReport.sessionFile,
    projectRoot: previousReport.projectRoot,
    legacyEvents,
    canonicalSession,
    legacyTurn: previousReport.legacyTurn,
    canonicalTurn: previousReport.canonicalTurn,
  });
  console.log(JSON.stringify(comparison, null, 2));
  process.exitCode = comparison.passed ? 0 : 1;
} else {
  await runLiveValidation();
}

async function runLiveValidation() {
const workspaceRoot = path.resolve(import.meta.dirname, '..');
const runRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(
      workspaceRoot,
      'tmp',
      `codex-live-validation-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`,
    );
const projectRoot = path.join(runRoot, 'project');
const legacyUserDataPath = path.join(runRoot, 'user-data-legacy');
const canonicalUserDataPath = path.join(runRoot, 'user-data-canonical');
const reportFile = path.join(runRoot, 'result.json');
fs.mkdirSync(projectRoot, { recursive: true });
fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Live Codex observation validation\n', 'utf8');
git(projectRoot, ['init']);
git(projectRoot, ['config', 'user.email', 'validation@agent-workbench.local']);
git(projectRoot, ['config', 'user.name', 'Agent Workbench Validation']);
git(projectRoot, ['add', '.']);
git(projectRoot, ['commit', '-m', 'Initial validation fixture']);

const existingSessions = new Set(findCodexSessions().map(file => path.resolve(file)));
const legacyObservation = createProjectObservationService({
  getUserDataPath: () => legacyUserDataPath,
  captureState: captureProjectState,
  deriveFacts: deriveProjectTurnFacts,
});
const canonicalObservation = createProjectObservationService({
  getUserDataPath: () => canonicalUserDataPath,
  captureState: captureProjectState,
  deriveFacts: deriveProjectTurnFacts,
});
let observedSessionFile = null;
let lastLegacyObservation = null;
let lastCanonicalObservation = null;
let lastLegacyEvents = [];
let lastCanonicalSession = null;
let polling = false;

console.log(`LIVE_VALIDATION_READY=${projectRoot}`);
const deadline = Date.now() + 600_000;
while (Date.now() < deadline) {
  await poll();
  const legacyFinished = lastLegacyObservation?.data?.completed > 0 || lastLegacyObservation?.data?.unavailable > 0;
  const canonicalFinished = lastCanonicalObservation?.data?.completed > 0 || lastCanonicalObservation?.data?.unavailable > 0;
  if (legacyFinished && canonicalFinished) break;
  await delay(40);
}

const legacyStore = legacyObservation.read(projectRoot);
const canonicalStore = canonicalObservation.read(projectRoot);
const legacyTurns = legacyStore.status === 'ready' ? Object.values(legacyStore.data.turns) : [];
const canonicalTurns = canonicalStore.status === 'ready' ? Object.values(canonicalStore.data.turns) : [];
const legacyTurn = legacyTurns.at(-1) ?? null;
const canonicalTurn = canonicalTurns.at(-1) ?? null;
const comparison = compareResults({
  sessionFile: observedSessionFile,
  projectRoot,
  legacyEvents: lastLegacyEvents,
  canonicalSession: lastCanonicalSession,
  legacyTurn,
  canonicalTurn,
});
const exitCode = legacyTurn?.status === 'completed'
  && canonicalTurn?.status === 'completed'
  && comparison.passed
  ? 0
  : 1;
const report = {
  runRoot,
  projectRoot,
  exitCode,
  createdFile: fs.existsSync(path.join(projectRoot, 'codex-created.txt'))
    ? fs.readFileSync(path.join(projectRoot, 'codex-created.txt'), 'utf8')
    : null,
  sessionFile: observedSessionFile,
  legacyObservation: lastLegacyObservation,
  canonicalObservation: lastCanonicalObservation,
  legacyTurn,
  canonicalTurn,
  comparison,
};
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`\nLIVE_VALIDATION_REPORT=${reportFile}`);
console.log(JSON.stringify({
  exitCode,
  createdFile: report.createdFile,
  sessionFile: observedSessionFile,
  legacyStatus: legacyTurn?.status ?? null,
  canonicalStatus: canonicalTurn?.status ?? null,
  comparisonPassed: comparison.passed,
  checks: comparison.checks,
  semanticCounts: comparison.semanticCounts,
  diagnostics: comparison.canonical.diagnostics,
  filesChanged: canonicalTurn?.facts?.turnDiff?.filesChanged ?? [],
  environmentChanges: canonicalTurn?.facts?.environmentDelta?.changes ?? [],
}, null, 2));

if (exitCode !== 0) process.exitCode = 1;

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const newSessions = findCodexSessions()
      .map(file => path.resolve(file))
      .filter(file => !existingSessions.has(file));
    const matching = newSessions.find(file => {
      const metadata = readCodexSessionMetadata(file);
      return metadata?.cwd && samePath(metadata.cwd, projectRoot);
    });
    if (matching) observedSessionFile = matching;
    if (!observedSessionFile) return;
    lastLegacyEvents = readCodexProjectTimelineEvents({
      projectRoot,
      sessionFiles: [observedSessionFile],
    });
    lastCanonicalSession = adaptCodexSession(observedSessionFile, {
      projectId: `live-validation:${path.basename(runRoot)}`,
    });
    if (lastLegacyEvents.length > 0) {
      lastLegacyObservation = legacyObservation.observe(projectRoot, lastLegacyEvents);
    }
    if (lastCanonicalSession.turns.length > 0) {
      lastCanonicalObservation = canonicalObservation.observeSession(projectRoot, lastCanonicalSession);
    }
  } finally {
    polling = false;
  }
}
}

function compareResults({
  sessionFile,
  projectRoot: root,
  legacyEvents,
  canonicalSession,
  legacyTurn,
  canonicalTurn,
}) {
  const raw = summarizeRaw(sessionFile, root);
  const legacy = summarizeLegacy(legacyEvents);
  const canonical = summarizeCanonical(canonicalSession, root);
  const checks = {
    rawAndLegacyTurnIds: equalArrays(raw.turnIds, legacy.turnIds),
    rawAndCanonicalTurnIds: equalArrays(raw.turnIds, canonical.nativeTurnIds),
    legacyAndCanonicalStatuses: equalArrays(legacy.statuses, canonical.statuses),
    userMessages: legacy.semanticLines.userMessages === canonical.semanticLines.userMessages,
    assistantMessages: legacy.semanticLines.assistantMessages === canonical.semanticLines.assistantMessages,
    reasoning: raw.semanticLines.reasoning === canonical.semanticLines.reasoning,
    toolCalls: raw.semanticLines.toolCalls === canonical.semanticLines.toolCalls,
    toolResults: raw.semanticLines.toolResults === canonical.semanticLines.toolResults,
    fileChanges: raw.semanticLines.fileChanges === legacy.semanticLines.fileChanges
      && raw.semanticLines.fileChanges === canonical.semanticLines.fileChanges,
    rawReferences: canonical.rawReferencesValid,
    diagnosticsExplicit: canonical.diagnostics?.unknownSourceEventCount
      === canonical.diagnostics?.entries?.length,
    projectFacts: equalJson(projectFacts(legacyTurn), projectFacts(canonicalTurn)),
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    semanticCounts: {
      raw: raw.semanticCounts,
      legacy: legacy.semanticCounts,
      canonical: canonical.semanticCounts,
    },
    raw,
    legacy,
    canonical,
    legacyDifferences: {
      reasoning: { legacy: legacy.semanticLines.reasoning, canonical: canonical.semanticLines.reasoning },
      toolCalls: { legacy: legacy.semanticLines.toolCalls, canonical: canonical.semanticLines.toolCalls },
      toolResults: { legacy: legacy.semanticLines.toolResults, canonical: canonical.semanticLines.toolResults },
    },
  };
}

function summarizeRaw(sessionFile, root) {
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    return { recordCount: 0, turnIds: [], statuses: [], semanticCounts: {} };
  }
  const records = fs.readFileSync(sessionFile, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim())
    .flatMap((line, index) => {
      try {
        return [{ line: index + 1, value: JSON.parse(line) }];
      } catch {
        return [];
      }
    });
  const projectTurns = records
    .filter(record => record.value?.type === 'turn_context' && samePath(record.value?.payload?.cwd, root));
  const turnIds = unique(projectTurns.map(record => record.value?.payload?.turn_id).filter(Boolean));
  const semanticCounts = countBy(records, record => sourceType(record.value));
  return {
    recordCount: records.length,
    turnIds,
    semanticCounts,
    semanticLines: {
      reasoning: recordLines(records.filter(record => sourceType(record.value) === 'response_item/reasoning')),
      toolCalls: recordLines(records.filter(record => (
        sourceType(record.value) === 'response_item/function_call'
        || sourceType(record.value) === 'response_item/custom_tool_call'
      ))),
      toolResults: recordLines(records.filter(record => (
        sourceType(record.value) === 'response_item/function_call_output'
        || sourceType(record.value) === 'response_item/custom_tool_call_output'
      ))),
      fileChanges: recordLines(records.filter(record => sourceType(record.value) === 'event_msg/patch_apply_end')),
    },
  };
}

function summarizeLegacy(events) {
  const turnIds = unique(events.map(event => event.generationId).filter(Boolean));
  return {
    eventCount: events.length,
    turnIds,
    statuses: turnIds.map(turnId => legacyStatus(events, turnId)),
    semanticCounts: countBy(events, event => event.eventKind),
    semanticLines: {
      userMessages: sourceLines(events.filter(event => event.eventKind === 'user_input')),
      assistantMessages: sourceLines(events.filter(event => event.eventKind === 'assistant_message')),
      reasoning: sourceLines(events.filter(event => event.eventKind === 'reasoning')),
      toolCalls: sourceLines(events.filter(event => event.eventKind === 'tool_call')),
      toolResults: sourceLines(events.filter(event => event.eventKind === 'tool_result')),
      fileChanges: sourceLines(events.filter(event => event.eventKind === 'file_change')),
    },
  };
}

function summarizeCanonical(session, root) {
  const turns = session?.turns?.filter(turn => samePath(turn.cwd ?? session.session.cwd, root)) ?? [];
  const events = turns.flatMap(turn => turn.events);
  const rawLineCount = session?.session?.rawRef?.sourceFile && fs.existsSync(session.session.rawRef.sourceFile)
    ? fs.readFileSync(session.session.rawRef.sourceFile, 'utf8').split(/\r?\n/).length
    : 0;
  return {
    schemaVersion: session?.schemaVersion ?? null,
    turnIds: turns.map(turn => turn.turnId),
    nativeTurnIds: turns.map(turn => turn.sourceRef.sourceId).filter(Boolean),
    statuses: turns.map(turn => turn.status ?? 'in_progress'),
    eventCount: events.length,
    semanticCounts: countBy(events, event => event.type),
    semanticLines: {
      userMessages: rawLines(events.filter(event => event.type === 'message' && event.actor === 'user')),
      assistantMessages: rawLines(events.filter(event => event.type === 'message' && event.actor === 'assistant')),
      reasoning: rawLines(events.filter(event => event.type === 'reasoning_summary')),
      toolCalls: rawLines(events.filter(event => event.type === 'tool_call')),
      toolResults: rawLines(events.filter(event => event.type === 'tool_result')),
      fileChanges: rawLines(events.filter(event => event.type === 'file_change')),
    },
    rawReferencesValid: events.every(event => (
      Number.isInteger(event.rawRef?.line)
      && event.rawRef.line >= 1
      && event.rawRef.line <= rawLineCount
    )),
    capabilityManifest: session?.capabilityManifest ?? null,
    diagnostics: session?.diagnostics ?? null,
  };
}

function legacyStatus(events, turnId) {
  const names = events
    .filter(event => event.generationId === turnId && event.eventKind === 'task_status')
    .map(event => event.name);
  if (names.includes('Turn aborted')) return 'aborted';
  if (names.includes('Task failed')) return 'failed';
  if (names.includes('Task completed')) return 'completed';
  return 'in_progress';
}

function projectFacts(turn) {
  if (!turn?.facts) return null;
  return {
    filesChanged: turn.facts.turnDiff?.filesChanged ?? [],
    unifiedDiff: turn.facts.turnDiff?.unifiedDiff ?? '',
    environmentChanges: turn.facts.environmentDelta?.changes ?? [],
  };
}

function sourceType(value) {
  const nested = value?.payload?.type;
  return nested ? `${value?.type ?? 'unknown'}/${nested}` : value?.type ?? 'unknown';
}

function countBy(values, keyOf) {
  const counts = {};
  for (const value of values) {
    const key = keyOf(value) ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sourceLines(events) {
  return [...events.map(event => event.sourceLine).filter(Number.isInteger)].sort((a, b) => a - b).join(',');
}

function rawLines(events) {
  return [...events.map(event => event.rawRef?.line).filter(Number.isInteger)].sort((a, b) => a - b).join(',');
}

function recordLines(records) {
  return records.map(record => record.line).sort((a, b) => a - b).join(',');
}

function unique(values) {
  return [...new Set(values)].sort();
}

function equalArrays(left, right) {
  return equalJson([...left].sort(), [...right].sort());
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function git(projectRoot, args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
