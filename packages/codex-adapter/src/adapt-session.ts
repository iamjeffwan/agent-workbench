import fs from 'node:fs';
import path from 'node:path';

import { assertObservationSession } from '@agent-workbench/observation-schema';
import type {
  AdapterDiagnostics,
  ObservationEvent,
  ObservationEventType,
  ObservationSession,
  ObservationSessionMetadata,
  ObservationTurn,
  RawRef,
  Usage,
} from '@agent-workbench/observation-schema';
import {
  redactCredentials,
  redactCredentialText,
} from '@agent-workbench/security';
import { derivedTurnId, nativeTurnIdFromPayload } from './turn-identity.js';

const DEFAULT_ADAPTER_VERSION = '0.1.0';
const MAX_CONTENT_CHARS = 4_000;

export type AdaptCodexSessionOptions = {
  adapterVersion?: string;
  projectId?: string;
};

type SourceRecord = {
  timestamp?: unknown;
  type?: unknown;
  payload?: unknown;
};

type MutableTurn = ObservationTurn & { hasUserMessage: boolean };

/** Convert one Codex rollout file into the draft unified observation contract. */
export function adaptCodexSession(
  sessionFile: string,
  options: AdaptCodexSessionOptions = {},
): ObservationSession {
  const sourceFile = path.resolve(sessionFile);
  if (!fs.existsSync(sourceFile)) throw new Error(`Codex session not found: ${sourceFile}`);

  const adapterVersion = options.adapterVersion ?? DEFAULT_ADAPTER_VERSION;
  const diagnostics = emptyDiagnostics();
  const records: Array<{ line: number; value: SourceRecord }> = [];
  const rawLines = fs.readFileSync(sourceFile, 'utf8').split(/\r?\n/);
  for (const [index, rawLine] of rawLines.entries()) {
    if (!rawLine.trim()) continue;
    try {
      const value = JSON.parse(rawLine) as unknown;
      if (!isRecord(value)) throw new TypeError('record is not an object');
      records.push({ line: index + 1, value });
    } catch {
      diagnostics.parseErrorCount += 1;
      diagnostics.entries.push({
        rawRef: rawRef(sourceFile, index + 1, 'invalid_json'),
        reason: 'Invalid JSONL record',
      });
    }
  }

  const first = records[0];
  const sessionMetaRecord = records.find(record => record.value.type === 'session_meta');
  const sessionPayload = recordPayload(sessionMetaRecord?.value);
  const sourceVersion = stringValue(sessionPayload?.cli_version) ?? 'unknown';
  const sessionId = stringValue(sessionPayload?.id)
    ?? stringValue(sessionPayload?.session_id)
    ?? path.basename(sourceFile, path.extname(sourceFile));
  const session: ObservationSessionMetadata = {
    sessionId,
    sourceAgent: 'codex',
    sourceVersion,
    adapterVersion,
    rawRef: rawRef(sourceFile, sessionMetaRecord?.line ?? first?.line ?? 1, 'session_meta', sessionId),
    ...(stringValue(sessionPayload?.cwd) ? { cwd: stringValue(sessionPayload?.cwd) } : {}),
    ...(stringValue(sessionPayload?.model_provider) ? { provider: stringValue(sessionPayload?.model_provider) } : {}),
    ...(options.projectId ? { projectId: options.projectId } : {}),
    fieldProvenance: {
      sessionId: sessionMetaRecord ? 'direct' : 'derived',
      sourceAgent: 'supplemented',
      sourceVersion: stringValue(sessionPayload?.cli_version) ? 'direct' : 'supplemented',
      rawRef: 'supplemented',
      ...(options.projectId ? { projectId: 'supplemented' as const } : {}),
    },
  };

  const turns: MutableTurn[] = [];
  let currentTurn: MutableTurn | undefined;
  let pendingContext: { line: number; timestamp?: string; turnId?: string; cwd?: string; model?: string } | undefined;
  const pendingRuntimeContexts: Array<{ record: { line: number; value: SourceRecord }; content?: string }> = [];
  let pendingCommunication: { record: { line: number; value: SourceRecord }; data: Record<string, unknown> } | undefined;
  let eventSequence = 0;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;

  const ensureTurn = (record: { line: number; value: SourceRecord }, newUserBoundary = false): MutableTurn => {
    const nativeTurnId = nativeTurnIdFromPayload(recordPayload(record.value)) ?? pendingContext?.turnId;
    if (nativeTurnId) {
      const existing = turns.find(turn => turn.turnId === nativeTurnId);
      if (existing) {
        currentTurn = existing;
      } else {
        currentTurn = createTurn(record, nativeTurnId, 'direct');
      }
      if (pendingContext?.turnId === nativeTurnId) pendingContext = undefined;
      return currentTurn;
    }

    if (!currentTurn || (newUserBoundary && currentTurn.hasUserMessage)) {
      currentTurn = createTurn(record, derivedTurnId(sessionId, record.line), 'derived');
    }
    return currentTurn;
  };

  const createTurn = (
    record: { line: number; value: SourceRecord },
    turnId: string,
    turnIdProvenance: 'direct' | 'derived',
  ): MutableTurn => {
    const context = pendingContext;
    const sourceType = context ? 'turn_context' : sourceEventType(record.value);
    const timestamp = timestampValue(record.value.timestamp) ?? context?.timestamp;
    const turn: MutableTurn = {
      turnId,
      sequence: turns.length,
      sourceRef: rawRef(
        sourceFile,
        context?.line ?? record.line,
        sourceType,
        turnIdProvenance === 'direct' ? turnId : context?.turnId,
      ),
      fieldProvenance: { turnId: turnIdProvenance, sourceRef: context?.turnId ? 'direct' : 'supplemented' },
      ...(timestamp ? { startedAt: timestamp } : {}),
      ...(context?.cwd ? { cwd: context.cwd } : {}),
      ...(context?.model ? { model: context.model } : {}),
      status: 'in_progress',
      events: [],
      hasUserMessage: false,
    };
    turns.push(turn);
    pendingContext = undefined;
    return turn;
  };

  const appendEvent = (
    record: { line: number; value: SourceRecord },
    type: ObservationEventType,
    details: Partial<ObservationEvent> = {},
    newUserBoundary = false,
  ): ObservationEvent => {
    const turn = ensureTurn(record, newUserBoundary);
    for (const pending of pendingRuntimeContexts.splice(0)) {
      turn.events.push(createEvent(pending.record, turn, 'lifecycle', {
        actor: 'system',
        subtype: 'runtime_context',
        content: pending.content,
      }));
    }
    const event = createEvent(record, turn, type, details);
    turn.events.push(event);
    return event;
  };

  const createEvent = (
    record: { line: number; value: SourceRecord },
    turn: MutableTurn,
    type: ObservationEventType,
    details: Partial<ObservationEvent> = {},
  ): ObservationEvent => {
    const timestamp = timestampValue(record.value.timestamp);
    const event: ObservationEvent = {
      eventId: `event-${String(eventSequence + 1).padStart(6, '0')}`,
      turnId: turn.turnId,
      sequence: eventSequence,
      type,
      ...(timestamp ? { timestamp } : {}),
      sourceAgent: 'codex',
      sourceVersion,
      sourceEventType: sourceEventType(record.value),
      adapterVersion,
      provenance: 'direct',
      fieldProvenance: {
        eventId: 'derived',
        turnId: turn.fieldProvenance?.turnId ?? 'derived',
        rawRef: 'supplemented',
      },
      fidelity: 'full',
      rawRef: rawRef(sourceFile, record.line, sourceEventType(record.value), sourceId(record.value)),
      ...details,
    };
    eventSequence += 1;
    return event;
  };

  for (const record of records) {
    const sourceType = stringValue(record.value.type);
    const payload = recordPayload(record.value);
    const payloadType = stringValue(payload?.type);
    const timestamp = timestampValue(record.value.timestamp);
    if (timestamp) {
      firstTimestamp ??= timestamp;
      lastTimestamp = timestamp;
    }

    const isAgentMessage = sourceType === 'response_item' && payloadType === 'agent_message';
    if (pendingCommunication && !isAgentMessage && sourceType !== 'inter_agent_communication_metadata') {
      appendEvent(pendingCommunication.record, 'lifecycle', {
        actor: 'system',
        category: 'inter_agent',
        subtype: 'communication_metadata',
        data: safeValue(pendingCommunication.data),
      });
      pendingCommunication = undefined;
    }

    if (sourceType === 'session_meta') continue;
    if (sourceType === 'turn_context') {
      pendingContext = {
        line: record.line,
        ...(timestamp ? { timestamp } : {}),
        ...(stringValue(payload?.turn_id) ? { turnId: stringValue(payload?.turn_id) } : {}),
        ...(stringValue(payload?.cwd) ? { cwd: stringValue(payload?.cwd) } : {}),
        ...(stringValue(payload?.model) ? { model: stringValue(payload?.model) } : {}),
      };
      if (currentTurn?.hasUserMessage) currentTurn = undefined;
      continue;
    }

    if (sourceType === 'response_item' && payloadType === 'message') {
      const role = stringValue(payload?.role);
      if (role === 'user' || role === 'assistant') {
        const content = extractMessage(payload?.content);
        if (role === 'user' && isInjectedRuntimeContext(content)) {
          pendingRuntimeContexts.push({ record, content });
          continue;
        }
        if (role === 'user' && attachDuplicateUserSource(currentTurn, content, record, sourceFile)) {
          continue;
        }
        const event = appendEvent(record, 'message', {
          actor: role,
          content,
        }, role === 'user');
        if (role === 'user') ensureMutableTurn(turns, event.turnId).hasUserMessage = true;
        continue;
      }
      if (role === 'developer' || role === 'system') {
        appendEvent(record, 'lifecycle', {
          actor: 'system',
          subtype: 'context_instruction',
          content: extractMessage(payload?.content),
        });
        continue;
      }
    }
    if (sourceType === 'inter_agent_communication_metadata') {
      if (pendingCommunication) {
        appendEvent(pendingCommunication.record, 'lifecycle', {
          actor: 'system',
          category: 'inter_agent',
          subtype: 'communication_metadata',
          data: safeValue(pendingCommunication.data),
        });
      }
      pendingCommunication = { record, data: payload ?? {} };
      continue;
    }
    if (isAgentMessage) {
      const communication = pendingCommunication;
      pendingCommunication = undefined;
      const triggerTurn = communication?.data.trigger_turn;
      appendEvent(record, 'message', {
        actor: 'assistant',
        category: 'inter_agent',
        subtype: 'agent_message',
        content: extractMessage(payload?.content),
        authorId: stringValue(payload?.author),
        recipientId: stringValue(payload?.recipient),
        data: {
          ...(typeof triggerTurn === 'boolean' ? { triggerTurn } : {}),
          ...(payload?.internal_chat_message_metadata_passthrough !== undefined
            ? { metadata: safeValue(payload.internal_chat_message_metadata_passthrough) }
            : {}),
        },
        ...(communication ? {
          relatedRawRefs: [rawRef(
            sourceFile,
            communication.record.line,
            sourceEventType(communication.record.value),
            sourceId(communication.record.value),
          )],
        } : {}),
      });
      continue;
    }
    if (sourceType === 'event_msg' && (payloadType === 'user_message' || payloadType === 'agent_message')) {
      const role = payloadType === 'user_message' ? 'user' : 'assistant';
      const content = safeText(payload?.message ?? payload?.text);
      if (role === 'user' && attachDuplicateUserSource(currentTurn, content, record, sourceFile)) {
        continue;
      }
      const event = appendEvent(record, 'message', {
        actor: role,
        content,
      }, role === 'user');
      if (role === 'user') ensureMutableTurn(turns, event.turnId).hasUserMessage = true;
      continue;
    }
    if ((sourceType === 'response_item' && payloadType === 'reasoning')
      || (sourceType === 'event_msg' && payloadType === 'agent_reasoning')) {
      appendEvent(record, 'reasoning_summary', {
        actor: 'assistant',
        content: extractReasoning(payload),
        fidelity: 'partial',
      });
      continue;
    }
    if (sourceType === 'response_item' && (payloadType === 'function_call' || payloadType === 'custom_tool_call')) {
      appendEvent(record, 'tool_call', {
        actor: 'assistant',
        status: 'pending',
        callId: stringValue(payload?.call_id),
        sourceToolName: stringValue(payload?.name),
        category: toolCategory(stringValue(payload?.name)),
        data: safeValue(parseArguments(payload?.arguments ?? payload?.input)),
      });
      continue;
    }
    if (sourceType === 'response_item' && (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output')) {
      const callId = stringValue(payload?.call_id);
      appendEvent(record, 'tool_result', {
        actor: 'tool',
        status: 'completed',
        ...(callId ? { callId } : {}),
        data: safeValue(payload?.output),
      });
      markToolCallCompleted(turns, callId);
      continue;
    }
    if (sourceType === 'event_msg' && payloadType === 'token_count') {
      const info = isRecord(payload?.info) ? payload.info : undefined;
      const usage = normalizeUsage(info?.last_token_usage ?? info?.total_token_usage);
      const event = appendEvent(record, 'lifecycle', { subtype: 'usage', ...(usage ? { usage } : {}) });
      const turn = ensureMutableTurn(turns, event.turnId);
      if (usage) turn.usage = usage;
      continue;
    }
    if (sourceType === 'event_msg' && payloadType === 'task_started') {
      const event = appendEvent(record, 'lifecycle', { subtype: 'turn_started', status: 'started' });
      const turn = ensureMutableTurn(turns, event.turnId);
      const nativeTurnId = stringValue(payload?.turn_id);
      if (nativeTurnId && !turn.sourceRef.sourceId) {
        turn.sourceRef = rawRef(sourceFile, record.line, sourceEventType(record.value), nativeTurnId);
      }
      turn.startedAt = timestamp ?? turn.startedAt;
      continue;
    }
    if (sourceType === 'event_msg' && payloadType === 'task_complete') {
      const event = appendEvent(record, 'lifecycle', { subtype: 'turn_completed', status: 'completed' });
      const turn = ensureMutableTurn(turns, event.turnId);
      turn.status = 'completed';
      turn.endedAt = timestamp ?? turn.endedAt;
      const durationMs = numberValue(payload?.duration_ms);
      if (durationMs !== undefined) turn.durationMs = durationMs;
      continue;
    }
    if (sourceType === 'event_msg' && payloadType === 'turn_aborted') {
      const event = appendEvent(record, 'lifecycle', { subtype: 'turn_aborted', status: 'aborted' });
      const turn = ensureMutableTurn(turns, event.turnId);
      turn.status = 'aborted';
      turn.endedAt = timestamp ?? turn.endedAt;
      continue;
    }
    if (sourceType === 'event_msg' && payloadType === 'patch_apply_end') {
      appendEvent(record, 'file_change', {
        actor: 'tool',
        status: payload?.success === false ? 'failed' : 'completed',
        callId: stringValue(payload?.call_id),
        category: 'patch',
        data: safeValue(payload?.changes),
        fidelity: 'partial',
      });
      diagnostics.lossyEventCount += 1;
      continue;
    }
    if (sourceType === 'event_msg' && payloadType === 'sub_agent_activity') {
      const kind = stringValue(payload?.kind) ?? 'activity';
      appendEvent(record, 'lifecycle', {
        actor: 'assistant',
        category: 'subagent',
        subtype: kind,
        status: subagentStatus(kind),
        authorId: stringValue(payload?.agent_path) ?? stringValue(payload?.agent_thread_id),
        data: safeValue({
          eventId: payload?.event_id,
          agentThreadId: payload?.agent_thread_id,
          agentPath: payload?.agent_path,
          kind,
        }),
      });
      continue;
    }
    if (sourceType === 'event_msg' && (payloadType === 'web_search_end' || payloadType === 'mcp_tool_call_end')) {
      appendEvent(record, 'tool_result', {
        actor: 'tool',
        status: 'completed',
        callId: stringValue(payload?.call_id),
        category: payloadType === 'web_search_end' ? 'search' : 'mcp',
        sourceToolName: stringValue(payload?.action_name),
        data: safeValue(payloadType === 'web_search_end' ? payload?.results : payload?.result),
      });
      continue;
    }
    if ((sourceType === 'event_msg' && payloadType === 'context_compacted') || sourceType === 'compacted') {
      appendEvent(record, 'lifecycle', { subtype: 'context_compacted', data: safeValue(payload) });
      continue;
    }
    if (sourceType === 'event_msg' && (payloadType === 'thread_settings_applied' || payloadType === 'thread_rolled_back')) {
      appendEvent(record, 'lifecycle', { subtype: payloadType, data: safeValue(payload) });
      continue;
    }
    if (sourceType === 'event_msg' && payloadType === 'error') {
      appendEvent(record, 'error', { actor: 'system', status: 'failed', data: safeValue(payload) });
      continue;
    }

    diagnostics.unknownSourceEventCount += 1;
    diagnostics.entries.push({
      rawRef: rawRef(sourceFile, record.line, sourceEventType(record.value), sourceId(record.value)),
      reason: 'Unsupported Codex source event',
    });
  }

  if (firstTimestamp) session.startedAt = firstTimestamp;
  if (lastTimestamp) session.endedAt = lastTimestamp;
  const lastTurn = turns.at(-1);
  if (lastTurn?.status === 'in_progress' && lastTimestamp) lastTurn.endedAt = lastTimestamp;
  if (pendingCommunication) {
    appendEvent(pendingCommunication.record, 'lifecycle', {
      actor: 'system',
      category: 'inter_agent',
      subtype: 'communication_metadata',
      data: safeValue(pendingCommunication.data),
    });
  }

  const events = turns.flatMap(turn => turn.events);
  const fileChanges = events.filter(event => event.type === 'file_change');

  const observation: ObservationSession = {
    schemaVersion: '1.0-draft',
    session,
    turns: turns.map(({ hasUserMessage: _hasUserMessage, ...turn }) => turn),
    capabilityManifest: {
      agent: 'codex',
      capabilities: {
        user_message: availability(events.some(event => event.type === 'message' && event.actor === 'user')),
        agent_message: availability(events.some(event => event.type === 'message' && event.actor === 'assistant')),
        tool_call: availability(events.some(event => event.type === 'tool_call')),
        tool_result: availability(events.some(event => event.type === 'tool_result')),
        tool_duration: turns.some(turn => turn.durationMs !== undefined) ? 'partial' : 'unavailable',
        file_diff: fileChanges.length === 0
          ? 'unavailable'
          : fileChanges.every(event => event.fidelity === 'full') ? 'full' : 'partial',
        token_usage: availability(events.some(event => event.usage !== undefined)),
        reasoning_summary: events.some(event => event.type === 'reasoning_summary') ? 'partial' : 'unavailable',
        approval_events: 'unavailable',
        subagent_events: availability(events.some(event => event.category === 'subagent')),
        inter_agent_messages: availability(events.some(event => event.category === 'inter_agent' && event.type === 'message')),
        git_metadata: options.projectId ? 'derived' : 'unavailable',
      },
    },
    diagnostics,
  };
  const jsonObservation = JSON.parse(JSON.stringify(observation)) as ObservationSession;
  assertObservationSession(jsonObservation);
  return jsonObservation;
}

function emptyDiagnostics(): AdapterDiagnostics {
  return {
    unknownSourceEventCount: 0,
    parseErrorCount: 0,
    lossyEventCount: 0,
    unsupportedFieldCount: 0,
    entries: [],
  };
}

function rawRef(sourceFile: string, line: number, sourceType: string, sourceIdValue?: string): RawRef {
  return { sourceFile, line, sourceType, ...(sourceIdValue ? { sourceId: sourceIdValue } : {}) };
}

function sourceEventType(record: SourceRecord): string {
  const top = stringValue(record.type) ?? 'unknown';
  const nested = stringValue(recordPayload(record)?.type);
  return nested ? `${top}/${nested}` : top;
}

function sourceId(record: SourceRecord): string | undefined {
  const payload = recordPayload(record);
  return stringValue(payload?.call_id)
    ?? nativeTurnIdFromPayload(payload)
    ?? stringValue(payload?.id);
}

function recordPayload(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return isRecord(value.payload) ? value.payload : undefined;
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value > 1e12 ? value : value * 1000).toISOString();
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function extractMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return safeText(value);
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map(item => isRecord(item) ? stringValue(item.text) : undefined)
    .filter((item): item is string => Boolean(item))
    .join('\n');
  return text ? safeText(text) : undefined;
}

function extractReasoning(payload: Record<string, unknown> | undefined): string | undefined {
  const summary = payload?.summary;
  if (Array.isArray(summary)) {
    const text = summary
      .map(item => isRecord(item) ? stringValue(item.text) : undefined)
      .filter((item): item is string => Boolean(item))
      .join('\n');
    if (text) return safeText(text);
  }
  return safeText(payload?.message ?? payload?.text);
}

function isInjectedRuntimeContext(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trimStart();
  return (
    (trimmed.startsWith('<recommended_plugins>')
      && trimmed.includes('# AGENTS.md instructions')
      && trimmed.includes('<environment_context>'))
    || (trimmed.startsWith('<environment_context>')
      && trimmed.includes('</environment_context>')
      && trimmed.includes('<current_date>')
      && trimmed.includes('<timezone>'))
  );
}

function attachDuplicateUserSource(
  turn: MutableTurn | undefined,
  content: string | undefined,
  record: { line: number; value: SourceRecord },
  sourceFile: string,
): boolean {
  if (!turn || !content) return false;
  const previous = [...turn.events].reverse().find(event => event.type === 'message' && event.actor === 'user');
  if (!previous || previous.content !== content || Math.abs(previous.rawRef.line - record.line) > 3) return false;
  const pair = new Set([previous.rawRef.sourceType, sourceEventType(record.value)]);
  if (!pair.has('response_item/message') || !pair.has('event_msg/user_message')) return false;
  previous.relatedRawRefs = [
    ...(previous.relatedRawRefs ?? []),
    rawRef(sourceFile, record.line, sourceEventType(record.value), sourceId(record.value)),
  ];
  return true;
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const redacted = redactCredentialText(value, { context: 'auto' });
  return redacted.length <= MAX_CONTENT_CHARS
    ? redacted
    : `${redacted.slice(0, MAX_CONTENT_CHARS)}…`;
}

function safeValue(value: unknown): unknown {
  const safe = redactCredentials(value);
  if (typeof safe === 'string') return safeText(safe);
  const serialized = JSON.stringify(safe);
  if (serialized && serialized.length > MAX_CONTENT_CHARS) {
    return { $summary: 'truncated', $length: serialized.length };
  }
  return safe;
}

function normalizeUsage(value: unknown): Usage | undefined {
  if (!isRecord(value)) return undefined;
  const usage: Usage = {};
  assignNumber(usage, 'inputTokens', value.input_tokens);
  assignNumber(usage, 'cachedInputTokens', value.cached_input_tokens);
  assignNumber(usage, 'cacheWriteInputTokens', value.cache_write_input_tokens);
  assignNumber(usage, 'outputTokens', value.output_tokens);
  assignNumber(usage, 'reasoningOutputTokens', value.reasoning_output_tokens);
  assignNumber(usage, 'totalTokens', value.total_tokens);
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function assignNumber(target: Usage, key: keyof Usage, value: unknown): void {
  const candidate = numberValue(value);
  if (candidate !== undefined) target[key] = candidate;
}

function toolCategory(name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (/search/i.test(name)) return 'search';
  if (/patch|write|edit/i.test(name)) return 'file';
  if (/mcp/i.test(name)) return 'mcp';
  if (/exec|shell|command|stdin/i.test(name)) return 'shell';
  return 'other';
}

function availability(observed: boolean): 'full' | 'unavailable' {
  return observed ? 'full' : 'unavailable';
}

function subagentStatus(kind: string): ObservationEvent['status'] | undefined {
  if (kind === 'started') return 'started';
  if (kind === 'completed' || kind === 'finished') return 'completed';
  if (kind === 'failed') return 'failed';
  if (kind === 'aborted') return 'aborted';
  return undefined;
}

function markToolCallCompleted(turns: MutableTurn[], callId: string | undefined): void {
  if (!callId) return;
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const call = [...turns[turnIndex].events].reverse().find(event => event.type === 'tool_call' && event.callId === callId);
    if (call) {
      call.status = 'completed';
      return;
    }
  }
}

function ensureMutableTurn(turns: MutableTurn[], turnId: string): MutableTurn {
  const turn = turns.find(candidate => candidate.turnId === turnId);
  if (!turn) throw new Error(`Adapter invariant failed for ${turnId}`);
  return turn;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
