import fs from 'node:fs';
import path from 'node:path';

import { findCodexSessions } from './find-sessions.js';
import { derivedTurnId, nativeTurnIdFromPayload } from './turn-identity.js';
import type { CodexRolloutLine } from './types.js';

const MAX_TITLE_CHARS = 120;

export type CodexHistoryActivity =
  | 'SEARCH'
  | 'PROCESS'
  | 'REQUEST'
  | 'WRITE'
  | 'DIFF'
  | 'TEST'
  | 'TOOL'
  | 'DELEGATE'
  | 'ERROR';

export type CodexHistoryTurnStatus =
  | 'unknown'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted';

export type CodexHistoryUserInput = {
  id: string;
  text: string;
  timestamp: string | null;
};

export type CodexHistoryTurn = {
  id: string;
  sessionId: string;
  userInput: string;
  userInputs: CodexHistoryUserInput[];
  planTitles: string[];
  startedAt: string | null;
  updatedAt: string | null;
  cwd: string;
  status: CodexHistoryTurnStatus;
  hasObservableActivity: boolean;
  activities: CodexHistoryActivity[];
};

export type CodexSessionSummary = {
  id: string;
  provider: 'codex';
  sessionFile: string;
  source: string;
  threadSource: string;
  title: string;
  startedAt: string | null;
  updatedAt: string | null;
  turns: CodexHistoryTurn[];
};

export type ListCodexProjectSessionsOptions = {
  projectRoot: string;
  sessionsDir?: string;
};

export type ReadCodexProjectSessionOptions = {
  projectRoot: string;
  sessionFile: string;
};

export type ListCodexSessionProjectsOptions = {
  sessionsDir?: string;
};

export type CodexSessionProjectSummary = {
  projectRoot: string;
  updatedAt: string | null;
  sessionCount: number;
};

type MutableTurn = {
  id: string;
  cwd?: string;
  startedAt: string | null;
  updatedAt: string | null;
  status: CodexHistoryTurnStatus;
  activities: Set<CodexHistoryActivity>;
  userInputs: CodexHistoryUserInput[];
  planTitles: string[];
  seenUserInputIds: Set<string>;
};

type ParsedSession = {
  id: string;
  sessionFile: string;
  source: string;
  threadSource: string;
  turns: Map<string, MutableTurn>;
};

/**
 * Read existing Codex rollout files without modifying them and return the
 * sessions that contain at least one turn explicitly assigned to the
 * requested project by turn_context.cwd.
 */
export function listCodexProjectSessions(
  options: ListCodexProjectSessionsOptions,
): CodexSessionSummary[] {
  return findCodexSessions(options.sessionsDir)
    .map(sessionFile => readCodexProjectSession({
      projectRoot: options.projectRoot,
      sessionFile,
    }))
    .filter((session): session is CodexSessionSummary => session !== null)
    .sort(compareSessions);
}

/** Discover the exact turn working directories used by explicit user sessions. */
export function listCodexSessionProjects(
  options: ListCodexSessionProjectsOptions = {},
): CodexSessionProjectSummary[] {
  const groups = new Map<string, {
    projectRoot: string;
    updatedAt: string | null;
    sessionIds: Set<string>;
  }>();

  for (const sessionFile of findCodexSessions(options.sessionsDir)) {
    const session = parseSessionFile(sessionFile);
    if (session.threadSource.toLowerCase() !== 'user') continue;

    const projectsInSession = new Map<string, {
      projectRoot: string;
      updatedAt: string | null;
    }>();
    for (const turn of session.turns.values()) {
      if (!turn.cwd) continue;
      const projectRoot = path.resolve(turn.cwd);
      const key = comparablePath(projectRoot);
      const existing = projectsInSession.get(key);
      projectsInSession.set(key, {
        projectRoot,
        updatedAt: latestTimestamp([
          existing?.updatedAt ?? null,
          turn.updatedAt,
          turn.startedAt,
        ]),
      });
    }

    for (const [key, project] of projectsInSession) {
      const existing = groups.get(key);
      if (existing) {
        existing.updatedAt = latestTimestamp([existing.updatedAt, project.updatedAt]);
        existing.sessionIds.add(session.id);
      } else {
        groups.set(key, {
          projectRoot: project.projectRoot,
          updatedAt: project.updatedAt,
          sessionIds: new Set([session.id]),
        });
      }
    }
  }

  return [...groups.values()]
    .map(group => ({
      projectRoot: group.projectRoot,
      updatedAt: group.updatedAt,
      sessionCount: group.sessionIds.size,
    }))
    .sort((left, right) => (
      (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '') ||
      left.projectRoot.localeCompare(right.projectRoot)
    ));
}

/** Read one rollout file using the same explicit source and project rules. */
export function readCodexProjectSession(
  options: ReadCodexProjectSessionOptions,
): CodexSessionSummary | null {
  const session = parseSessionFile(options.sessionFile);
  if (session.threadSource.toLowerCase() !== 'user') return null;
  return summarizeSession(session, path.resolve(options.projectRoot));
}

function parseSessionFile(sessionFile: string): ParsedSession {
  const absoluteFile = path.resolve(sessionFile);
  const session: ParsedSession = {
    id: inferSessionId(absoluteFile),
    sessionFile: absoluteFile,
    source: 'unknown',
    threadSource: 'unknown',
    turns: new Map(),
  };
  let currentTurnId: string | undefined;
  let currentCwd: string | undefined;
  let sessionMetadataSeen = false;

  const text = fs.readFileSync(absoluteFile, 'utf8');

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    if (!rawLine.trim()) continue;
    let event: CodexRolloutLine;
    try {
      event = JSON.parse(rawLine) as CodexRolloutLine;
    } catch {
      continue;
    }
    if (!event.payload) continue;

    if (event.type === 'session_meta') {
      if (!sessionMetadataSeen) {
        session.id =
          stringOrNull(event.payload.id) ??
          stringOrNull(event.payload.session_id) ??
          session.id;
        session.source = sourceName(event.payload.source) ?? session.source;
        session.threadSource =
          sourceName(event.payload.thread_source) ?? session.threadSource;
        sessionMetadataSeen = true;
      }
      continue;
    }

    if (event.type === 'turn_context') {
      const turnId = nativeTurnIdFromPayload(event.payload);
      const cwd = stringOrNull(event.payload.cwd);
      currentCwd = cwd ? path.resolve(cwd) : undefined;
      if (!turnId) {
        currentTurnId = undefined;
        continue;
      }
      currentTurnId = turnId;
      const turn = ensureTurn(session.turns, turnId);
      turn.cwd = currentCwd;
      touchTurn(turn, event.timestamp);
      continue;
    }

    if (event.type === 'event_msg') {
      const eventType = stringOrNull(event.payload.type);
      const explicitTurnId = nativeTurnIdFromPayload(event.payload);
      if (eventType === 'task_started') {
        if (explicitTurnId && explicitTurnId !== currentTurnId) {
          currentTurnId = explicitTurnId;
        }
        const turnId = explicitTurnId ?? currentTurnId;
        if (!turnId) continue;
        const turn = ensureTurn(session.turns, turnId);
        turn.status = 'running';
        touchTurn(turn, event.payload.started_at ?? event.timestamp);
        continue;
      }

      const turnId = explicitTurnId ?? currentTurnId;
      if (!turnId) continue;
      const turn = ensureTurn(session.turns, turnId);
      touchTurn(turn, event.payload.completed_at ?? event.timestamp);

      if (eventType === 'task_complete') {
        if (event.payload.error != null) {
          turn.status = 'failed';
          turn.activities.add('ERROR');
        } else {
          turn.status = 'completed';
        }
      } else if (eventType === 'turn_aborted') {
        turn.status = 'aborted';
        turn.activities.add('ERROR');
      } else if (eventType === 'patch_apply_end') {
        turn.activities.add('WRITE');
        turn.activities.add('DIFF');
        if (event.payload.success === false) turn.activities.add('ERROR');
      } else if (eventType === 'web_search_end') {
        turn.activities.add('SEARCH');
        turn.activities.add('REQUEST');
      } else if (eventType === 'mcp_tool_call_end') {
        turn.activities.add('TOOL');
        if (eventPayloadFailed(event.payload)) turn.activities.add('ERROR');
      } else if (eventType === 'sub_agent_activity') {
        turn.activities.add('DELEGATE');
      }
      continue;
    }

    if (event.type !== 'response_item') continue;

    const payloadType = stringOrNull(event.payload.type);
    const nativeTurnId = nativeTurnIdFromPayload(event.payload);
    let turnId = nativeTurnId ?? currentTurnId;
    if (!turnId && payloadType === 'message' && event.payload.role === 'user') {
      const rawText = userMessageText(event.payload.content);
      if (!rawText || isInjectedRuntimeContext(rawText) || !rawText.trim() || !currentCwd) continue;
      turnId = derivedTurnId(session.id, index + 1);
      currentTurnId = turnId;
    }
    if (!turnId) continue;
    const turn = ensureTurn(session.turns, turnId);
    if (!turn.cwd && currentCwd) turn.cwd = currentCwd;
    touchTurn(turn, event.timestamp);

    if (payloadType === 'message' && event.payload.role === 'user') {
      const rawText = userMessageText(event.payload.content);
      if (!rawText || isInjectedRuntimeContext(rawText)) continue;
      if (!rawText.trim()) continue;
      if (turn.status === 'completed' || turn.status === 'failed' || turn.status === 'aborted') {
        turn.status = 'running';
      }
      const inputId =
        stringOrNull(event.payload.id) ??
        `${turnId}:${event.timestamp ?? 'unknown'}:${rawText.length}`;
      if (turn.seenUserInputIds.has(inputId)) continue;
      turn.seenUserInputIds.add(inputId);
      turn.userInputs.push({
        id: inputId,
        text: rawText,
        timestamp: isoTimestamp(event.timestamp),
      });
      continue;
    }

    if (payloadType === 'message' && event.payload.role === 'assistant') {
      for (const title of planTitlesFromMessage(event.payload.content)) {
        if (!turn.planTitles.includes(title)) turn.planTitles.push(title);
      }
      continue;
    }

    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      if (turn.status === 'completed' || turn.status === 'failed' || turn.status === 'aborted') {
        turn.status = 'running';
      }
      classifyToolCall(
        turn.activities,
        stringOrNull(event.payload.name) ?? '',
        payloadType === 'custom_tool_call'
          ? event.payload.input
          : event.payload.arguments,
      );
    } else if (
      payloadType === 'function_call_output' ||
      payloadType === 'custom_tool_call_output'
    ) {
      if (outputFailed(event.payload.output)) turn.activities.add('ERROR');
    }
  }

  return session;
}

function summarizeSession(
  session: ParsedSession,
  projectRoot: string,
): CodexSessionSummary | null {
  const turns = [...session.turns.values()]
    .filter(turn => turn.cwd && isPathWithin(turn.cwd, projectRoot))
    .map(turn => finalizeTurn(turn, session.id))
    .sort(compareTurns);
  if (turns.length === 0) return null;

  const firstInput = turns.flatMap(turn => turn.userInputs).find(input => input.text);
  return {
    id: session.id,
    provider: 'codex',
    sessionFile: session.sessionFile,
    source: session.source,
    threadSource: session.threadSource,
    title: titleFrom(firstInput?.text, session.id),
    startedAt: earliestTimestamp(turns.map(turn => turn.startedAt)),
    updatedAt: latestTimestamp(turns.map(turn => turn.updatedAt)),
    turns,
  };
}

function finalizeTurn(turn: MutableTurn, sessionId: string): CodexHistoryTurn {
  const activities = orderedActivities(turn.activities);
  const combined = turn.userInputs.map(input => input.text).join('\n\n');
  return {
    id: turn.id,
    sessionId,
    userInput: combined,
    userInputs: turn.userInputs,
    planTitles: turn.planTitles,
    startedAt: turn.startedAt,
    updatedAt: turn.updatedAt,
    cwd: path.resolve(turn.cwd!),
    status: turn.status,
    hasObservableActivity: activities.some(activity => activity !== 'ERROR'),
    activities,
  };
}

function ensureTurn(turns: Map<string, MutableTurn>, turnId: string): MutableTurn {
  const existing = turns.get(turnId);
  if (existing) return existing;
  const turn: MutableTurn = {
    id: turnId,
    startedAt: null,
    updatedAt: null,
    status: 'unknown',
    activities: new Set(),
    userInputs: [],
    planTitles: [],
    seenUserInputIds: new Set(),
  };
  turns.set(turnId, turn);
  return turn;
}

function touchTurn(turn: MutableTurn, value: unknown): void {
  const timestamp = isoTimestamp(value);
  if (!timestamp) return;
  if (!turn.startedAt || timestamp < turn.startedAt) turn.startedAt = timestamp;
  if (!turn.updatedAt || timestamp > turn.updatedAt) turn.updatedAt = timestamp;
}

function classifyToolCall(
  activities: Set<CodexHistoryActivity>,
  rawName: string,
  rawArguments: unknown,
): void {
  const name = normalizeToolName(rawName);
  const argumentText = valueText(rawArguments).toLowerCase();
  const combined = `${name} ${argumentText}`;

  if (isReadOnlyTool(name)) return;
  if (name === 'exec') {
    classifyExecTransport(activities, argumentText);
    return;
  }
  if (/(?:^|_)(?:apply_patch|edit|write|delete|move|rename)(?:$|_)/.test(name)) {
    activities.add('WRITE');
    if (name.includes('patch')) activities.add('DIFF');
    return;
  }
  if (
    name.includes('search') ||
    name === 'grep' ||
    name === 'rg' ||
    /\b(?:search_query|image_query|web_search)\b/.test(argumentText)
  ) {
    activities.add('SEARCH');
    if (name.includes('web') || argumentText.includes('search_query')) {
      activities.add('REQUEST');
    }
    return;
  }
  if (
    name.includes('fetch') ||
    name.includes('request') ||
    name.includes('browser') ||
    /\b(?:open|click|weather|finance|sports)\b/.test(argumentText)
  ) {
    activities.add('REQUEST');
    return;
  }
  if (
    name.includes('spawn_agent') ||
    name.includes('sub_agent') ||
    name.includes('send_message') ||
    name.includes('followup_task')
  ) {
    activities.add('DELEGATE');
    return;
  }
  if (
    name.includes('shell') ||
    name.includes('exec_command') ||
    name.includes('write_stdin') ||
    name.includes('process')
  ) {
    activities.add('PROCESS');
    if (/\b(?:test|vitest|jest|pytest|cargo\s+test|go\s+test|pnpm\s+(?:run\s+)?test|npm\s+(?:run\s+)?test)\b/.test(combined)) {
      activities.add('TEST');
    }
    if (/\b(?:apply_patch|write_file|edit_file)\b/.test(argumentText)) {
      activities.add('WRITE');
      if (argumentText.includes('apply_patch')) activities.add('DIFF');
    }
    return;
  }
  if (name && !name.includes('wait')) activities.add('TOOL');
}

function classifyExecTransport(
  activities: Set<CodexHistoryActivity>,
  source: string,
): void {
  let classified = false;
  if (/tools\.(?:apply_patch|write_file|edit_file|delete_file|move_file)\b/.test(source)) {
    activities.add('WRITE');
    if (source.includes('tools.apply_patch')) activities.add('DIFF');
    classified = true;
  }
  if (/tools\.(?:shell_command|exec_command|write_stdin|process_launch)\b/.test(source)) {
    activities.add('PROCESS');
    if (/\b(?:test|vitest|jest|pytest|cargo\s+test|go\s+test|pnpm\s+(?:run\s+)?test|npm\s+(?:run\s+)?test)\b/.test(source)) {
      activities.add('TEST');
    }
    classified = true;
  }
  if (/tools\.(?:web__run|web_search|search_query)\b|\bsearch_query\b/.test(source)) {
    activities.add('SEARCH');
    activities.add('REQUEST');
    classified = true;
  }
  if (/tools\.(?:browser|fetch|request|open_url)[\w]*\b/.test(source)) {
    activities.add('REQUEST');
    classified = true;
  }
  if (/tools\.(?:collaboration\.)?(?:spawn_agent|send_message|followup_task)\b/.test(source)) {
    activities.add('DELEGATE');
    classified = true;
  }
  if (!classified && !/tools\.(?:read_file|view_image|get_goal|wait)\b/.test(source)) {
    activities.add('TOOL');
  }
}

function isReadOnlyTool(name: string): boolean {
  return (
    name === 'read' ||
    name.includes('read_file') ||
    name.includes('view_image') ||
    name.includes('screenshot') ||
    name.includes('get_goal') ||
    name.includes('list_mcp_resource') ||
    name.includes('read_mcp_resource')
  );
}

function orderedActivities(values: Set<CodexHistoryActivity>): CodexHistoryActivity[] {
  const order: CodexHistoryActivity[] = [
    'SEARCH', 'PROCESS', 'REQUEST', 'WRITE', 'DIFF', 'TEST', 'TOOL', 'DELEGATE', 'ERROR',
  ];
  return order.filter(activity => values.has(activity));
}

function userMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object' || Array.isArray(part)) return '';
      const item = part as Record<string, unknown>;
      const type = stringOrNull(item.type);
      return type === 'input_text' || type === 'output_text' || type === 'text'
        ? stringOrNull(item.text) ?? ''
        : '';
    })
    .filter(Boolean)
    .join('\n');
}

function planTitlesFromMessage(content: unknown): string[] {
  const text = userMessageText(content);
  if (!text) return [];
  const titles: string[] = [];
  const blocks = text.matchAll(/<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/g);
  for (const block of blocks) {
    const heading = block[1]?.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
    titles.push(heading || '未命名计划');
  }
  return titles;
}

function isInjectedRuntimeContext(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    (
      trimmed.startsWith('<recommended_plugins>') &&
      trimmed.includes('# AGENTS.md instructions') &&
      trimmed.includes('<environment_context>')
    ) ||
    (
      trimmed.startsWith('<environment_context>') &&
      trimmed.includes('<workspace_roots>') &&
      trimmed.includes('<current_date>') &&
      trimmed.includes('<timezone>')
    )
  );
}

function eventPayloadFailed(payload: Record<string, unknown>): boolean {
  return payload.success === false || payload.error != null || outputFailed(payload.result);
}

function outputFailed(value: unknown): boolean {
  let candidate = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return false;
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const record = candidate as Record<string, unknown>;
  return (
    record.isError === true ||
    record.success === false ||
    record.status === 'failed' ||
    record.status === 'error' ||
    (typeof record.exit_code === 'number' && record.exit_code !== 0) ||
    (typeof record.exitCode === 'number' && record.exitCode !== 0)
  );
}

function sourceName(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return (
    stringOrNull(record.type) ??
    stringOrNull(record.kind) ??
    Object.keys(record)[0] ??
    null
  );
}

function normalizeToolName(value: string): string {
  return value.trim().replace(/[.:/-]+/g, '_').toLowerCase();
}

function valueText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? '');
  } catch {
    return '';
  }
}

function titleFrom(value: string | undefined, sessionId: string): string {
  if (!value) return `Codex session ${sessionId.slice(0, 8)}`;
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= MAX_TITLE_CHARS
    ? compact
    : `${compact.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}\u2026`;
}

function compareSessions(
  left: CodexSessionSummary,
  right: CodexSessionSummary,
): number {
  return (
    (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '') ||
    left.id.localeCompare(right.id)
  );
}

function compareTurns(left: CodexHistoryTurn, right: CodexHistoryTurn): number {
  return (
    (left.startedAt ?? '').localeCompare(right.startedAt ?? '') ||
    left.id.localeCompare(right.id)
  );
}

function earliestTimestamp(values: Array<string | null>): string | null {
  const timestamps = values.filter((value): value is string => value !== null).sort();
  return timestamps[0] ?? null;
}

function latestTimestamp(values: Array<string | null>): string | null {
  const timestamps = values.filter((value): value is string => value !== null).sort();
  return timestamps.at(-1) ?? null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    return new Date(milliseconds).toISOString();
  }
  if (typeof value !== 'string' || !value) return null;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? null : new Date(milliseconds).toISOString();
}

function isPathWithin(candidate: string, root: string): boolean {
  const comparableCandidate = comparablePath(candidate);
  const comparableRoot = comparablePath(root);
  const relative = path.relative(comparableRoot, comparableCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function inferSessionId(sessionFile: string): string {
  return path.basename(sessionFile, path.extname(sessionFile)).replace(/^rollout-/, '');
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
