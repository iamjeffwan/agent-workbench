import fs from 'node:fs';
import path from 'node:path';

export function compareResults({
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
    sessionFilePresent: raw.sessionFilePresent,
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
    failureReasons: raw.sessionFilePresent ? [] : ['session_file_missing'],
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

export function summarizeRaw(sessionFile, root) {
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    return emptyRawSummary(false);
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
    sessionFilePresent: true,
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

function emptyRawSummary(sessionFilePresent) {
  return {
    sessionFilePresent,
    recordCount: 0,
    turnIds: [],
    statuses: [],
    semanticCounts: {},
    semanticLines: {
      reasoning: '',
      toolCalls: '',
      toolResults: '',
      fileChanges: '',
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

export function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
