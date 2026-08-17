import fs from 'node:fs';
import path from 'node:path';

import type { CodexRolloutLine } from './types.js';

export type CodexTaskEvidenceEventKind =
  | 'user-input'
  | 'assistant-message'
  | 'reasoning'
  | 'tool-call'
  | 'tool-result'
  | 'search'
  | 'patch'
  | 'delegation'
  | 'completion';

export type CodexTaskEvidenceEvent = {
  kind: CodexTaskEvidenceEventKind;
  timestamp: string | null;
  name: string;
  detail: string;
  callId: string | null;
  success: boolean | null;
  source: {
    sessionFile: string;
    line: number;
  };
};

export type CodexTaskTokenMetrics = {
  input: number | null;
  cachedInput: number | null;
  cacheWriteInput: number | null;
  output: number | null;
  reasoningOutput: number | null;
  total: number | null;
};

export type CodexTaskTurnEvidence = {
  id: string;
  sessionId: string;
  cwd: string | null;
  userInput: string;
  startedAt: string | null;
  updatedAt: string | null;
  status: 'unknown' | 'running' | 'completed' | 'failed' | 'aborted';
  metrics: {
    durationMs: number | null;
    timeToFirstTokenMs: number | null;
    tokens: CodexTaskTokenMetrics;
  };
  events: CodexTaskEvidenceEvent[];
};

export type CodexTaskEvidence = {
  sessionId: string;
  projectRoot: string;
  sessionFile: string;
  requestedTurnIds: string[];
  missingTurnIds: string[];
  turns: CodexTaskTurnEvidence[];
};

export type ReadCodexTaskEvidenceOptions = {
  projectRoot: string;
  sessionFile: string;
  sessionId: string;
  turnIds: string[];
};

type MutableTurnEvidence = CodexTaskTurnEvidence & {
  userInputs: string[];
};

const emptyTokens = (): CodexTaskTokenMetrics => ({
  input: null,
  cachedInput: null,
  cacheWriteInput: null,
  output: null,
  reasoningOutput: null,
  total: null,
});

export function readCodexTaskEvidence(
  options: ReadCodexTaskEvidenceOptions,
): CodexTaskEvidence {
  const sessionFile = path.resolve(options.sessionFile);
  const projectRoot = path.resolve(options.projectRoot);
  const requestedTurnIds = [...new Set(options.turnIds.map(value => value.trim()).filter(Boolean))];
  const selectedTurnIds = new Set(requestedTurnIds);
  const turns = new Map<string, MutableTurnEvidence>();
  let currentTurnId: string | null = null;
  let sourceSessionId: string | null = null;
  let threadSource: string | null = null;
  let sessionMetadataSeen = false;

  const lines = fs.readFileSync(sessionFile, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
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
        sourceSessionId =
          text(event.payload.id) ??
          text(event.payload.session_id) ??
          null;
        threadSource = sourceName(event.payload.thread_source);
        sessionMetadataSeen = true;
      }
      continue;
    }

    if (event.type === 'turn_context') {
      currentTurnId = text(event.payload.turn_id);
      if (!currentTurnId || !selectedTurnIds.has(currentTurnId)) continue;
      const turn = ensureTurn(turns, currentTurnId, options.sessionId);
      const cwd = text(event.payload.cwd);
      turn.cwd = cwd ? path.resolve(cwd) : null;
      touch(turn, event.timestamp);
      continue;
    }

    const explicitTurnId = eventTurnId(event);
    const turnId = explicitTurnId ?? currentTurnId;
    if (!turnId || !selectedTurnIds.has(turnId)) continue;
    const turn = ensureTurn(turns, turnId, options.sessionId);
    touch(turn, event.timestamp);

    if (event.type === 'response_item') {
      collectResponseItem(turn, event, sessionFile, index + 1);
    } else if (event.type === 'event_msg') {
      collectEventMessage(turn, event, sessionFile, index + 1);
    }
  }

  if (sourceSessionId !== options.sessionId) {
    throw new Error('The rollout does not match the selected session.');
  }
  if (threadSource?.toLowerCase() !== 'user') {
    throw new Error('Task evidence can only be read from an explicit user session.');
  }

  const finalized = requestedTurnIds
    .map(turnId => turns.get(turnId))
    .filter((turn): turn is MutableTurnEvidence => Boolean(
      turn?.cwd && isPathWithin(turn.cwd, projectRoot),
    ))
    .map(turn => {
      turn.userInput = turn.userInputs.join('\n\n');
      const { userInputs: _userInputs, ...result } = turn;
      return result;
    });
  const foundIds = new Set(finalized.map(turn => turn.id));

  return {
    sessionId: options.sessionId,
    projectRoot,
    sessionFile,
    requestedTurnIds,
    missingTurnIds: requestedTurnIds.filter(turnId => !foundIds.has(turnId)),
    turns: finalized,
  };
}

function collectResponseItem(
  turn: MutableTurnEvidence,
  event: CodexRolloutLine,
  sessionFile: string,
  line: number,
): void {
  const payload = event.payload!;
  const payloadType = text(payload.type);
  if (payloadType === 'message') {
    const role = text(payload.role);
    const content = messageText(payload.content);
    if (!content) return;
    if (role === 'user') {
      if (isInjectedRuntimeContext(content)) return;
      turn.userInputs.push(content);
      turn.events.push(evidenceEvent(
        'user-input', 'User input', content, event, sessionFile, line,
      ));
    } else if (role === 'assistant') {
      turn.events.push(evidenceEvent(
        'assistant-message', 'Assistant message', content, event, sessionFile, line,
      ));
    }
    return;
  }

  if (payloadType === 'reasoning') {
    const summary = reasoningText(payload.summary);
    if (summary) {
      turn.events.push(evidenceEvent(
        'reasoning', 'Reasoning summary', summary, event, sessionFile, line,
      ));
    }
    return;
  }

  if (payloadType === 'agent_message') {
    const content = messageText(payload.content);
    if (content) {
      turn.events.push(evidenceEvent(
        'assistant-message', 'Agent message', content, event, sessionFile, line,
      ));
    }
    return;
  }

  if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
    turn.events.push({
      ...evidenceEvent(
        'tool-call',
        text(payload.name) ?? 'Tool call',
        valueText(payloadType === 'custom_tool_call' ? payload.input : payload.arguments),
        event,
        sessionFile,
        line,
      ),
      callId: text(payload.call_id),
    });
    return;
  }

  if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
    const output = payload.output;
    turn.events.push({
      ...evidenceEvent(
        'tool-result', 'Tool result', valueText(output), event, sessionFile, line,
      ),
      callId: text(payload.call_id),
      success: outputSucceeded(output),
    });
  }
}

function collectEventMessage(
  turn: MutableTurnEvidence,
  event: CodexRolloutLine,
  sessionFile: string,
  line: number,
): void {
  const payload = event.payload!;
  const eventType = text(payload.type);
  if (eventType === 'task_started') {
    turn.status = 'running';
    touch(turn, payload.started_at);
    return;
  }
  if (eventType === 'agent_reasoning') {
    const reasoning = text(payload.text);
    if (reasoning) {
      turn.events.push(evidenceEvent(
        'reasoning', 'Reasoning summary', reasoning, event, sessionFile, line,
      ));
    }
    return;
  }
  if (eventType === 'agent_message') {
    const message = text(payload.message);
    if (message) {
      turn.events.push(evidenceEvent(
        'assistant-message', 'Assistant message', message, event, sessionFile, line,
      ));
    }
    return;
  }
  if (eventType === 'token_count') {
    const info = record(payload.info);
    const usage = record(info?.last_token_usage);
    if (usage) turn.metrics.tokens = tokenMetrics(usage);
    return;
  }
  if (eventType === 'task_complete') {
    turn.status = payload.error == null ? 'completed' : 'failed';
    turn.metrics.durationMs = number(payload.duration_ms);
    turn.metrics.timeToFirstTokenMs = number(payload.time_to_first_token_ms);
    touch(turn, payload.completed_at);
    turn.events.push({
      ...evidenceEvent(
        'completion',
        turn.status === 'completed' ? 'Task completed' : 'Task failed',
        text(payload.last_agent_message) ?? '',
        event,
        sessionFile,
        line,
      ),
      success: turn.status === 'completed',
    });
    return;
  }
  if (eventType === 'turn_aborted') {
    turn.status = 'aborted';
    turn.metrics.durationMs = number(payload.duration_ms);
    touch(turn, payload.completed_at);
    turn.events.push({
      ...evidenceEvent(
        'completion', 'Task aborted', text(payload.reason) ?? '', event, sessionFile, line,
      ),
      success: false,
    });
    return;
  }
  if (eventType === 'web_search_end') {
    turn.events.push(evidenceEvent(
      'search', 'Web search', text(payload.query) ?? valueText(payload.action), event, sessionFile, line,
    ));
    return;
  }
  if (eventType === 'patch_apply_end') {
    turn.events.push({
      ...evidenceEvent(
        'patch', 'Patch applied', valueText(payload.changes), event, sessionFile, line,
      ),
      callId: text(payload.call_id),
      success: typeof payload.success === 'boolean' ? payload.success : null,
    });
    return;
  }
  if (eventType === 'sub_agent_activity') {
    turn.events.push(evidenceEvent(
      'delegation', text(payload.kind) ?? 'Sub-agent activity', text(payload.agent_path) ?? '',
      event, sessionFile, line,
    ));
  }
}

function ensureTurn(
  turns: Map<string, MutableTurnEvidence>,
  turnId: string,
  sessionId: string,
): MutableTurnEvidence {
  const existing = turns.get(turnId);
  if (existing) return existing;
  const created: MutableTurnEvidence = {
    id: turnId,
    sessionId,
    cwd: null,
    userInput: '',
    userInputs: [],
    startedAt: null,
    updatedAt: null,
    status: 'unknown',
    metrics: {
      durationMs: null,
      timeToFirstTokenMs: null,
      tokens: emptyTokens(),
    },
    events: [],
  };
  turns.set(turnId, created);
  return created;
}

function eventTurnId(event: CodexRolloutLine): string | null {
  const direct = text(event.payload?.turn_id);
  if (direct) return direct;
  const metadata = record(event.payload?.internal_chat_message_metadata_passthrough);
  return text(metadata?.turn_id);
}

function evidenceEvent(
  kind: CodexTaskEvidenceEventKind,
  name: string,
  detail: string,
  event: CodexRolloutLine,
  sessionFile: string,
  line: number,
): CodexTaskEvidenceEvent {
  return {
    kind,
    timestamp: isoTimestamp(event.timestamp),
    name,
    detail,
    callId: null,
    success: null,
    source: { sessionFile, line },
  };
}

function touch(turn: MutableTurnEvidence, value: unknown): void {
  const timestamp = isoTimestamp(value);
  if (!timestamp) return;
  if (!turn.startedAt || timestamp < turn.startedAt) turn.startedAt = timestamp;
  if (!turn.updatedAt || timestamp > turn.updatedAt) turn.updatedAt = timestamp;
}

function tokenMetrics(value: Record<string, unknown>): CodexTaskTokenMetrics {
  return {
    input: number(value.input_tokens),
    cachedInput: number(value.cached_input_tokens),
    cacheWriteInput: number(value.cache_write_input_tokens),
    output: number(value.output_tokens),
    reasoningOutput: number(value.reasoning_output_tokens),
    total: number(value.total_tokens),
  };
}

function outputSucceeded(value: unknown): boolean | null {
  const parsed = typeof value === 'string' ? parseJson(value) ?? value : value;
  const output = record(parsed);
  if (!output) return null;
  if (output.isError === true || output.success === false) return false;
  const exitCode = number(output.exit_code) ?? number(output.exitCode);
  if (exitCode !== null) return exitCode === 0;
  if (output.success === true) return true;
  return null;
}

function reasoningText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(item => {
    if (typeof item === 'string') return item;
    return text(record(item)?.text) ?? '';
  }).filter(Boolean).join('\n');
}

function messageText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(item => {
    if (typeof item === 'string') return item;
    const part = record(item);
    return text(part?.text) ?? '';
  }).filter(Boolean).join('\n');
}

function isInjectedRuntimeContext(value: string): boolean {
  const trimmed = value.trimStart();
  return (
    (
      trimmed.startsWith('<recommended_plugins>') &&
      trimmed.includes('# AGENTS.md instructions') &&
      trimmed.includes('<environment_context>')
    ) ||
    (
      trimmed.startsWith('<environment_context>') &&
      trimmed.includes('<workspace_roots>')
    )
  );
}

function isPathWithin(candidate: string, root: string): boolean {
  const normalizedCandidate = comparablePath(candidate);
  const normalizedRoot = comparablePath(root);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1_000 : value).toISOString();
  }
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function sourceName(value: unknown): string | null {
  if (typeof value === 'string') return value;
  const item = record(value);
  return item ? text(item.type) ?? text(item.kind) ?? Object.keys(item)[0] ?? null : null;
}

function valueText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
