import fs from 'node:fs';
import path from 'node:path';

import {
  redactCredentials,
  redactCredentialText,
} from '../../agent-workbench-security/index.mjs';
import type {
  AgentToolStep,
  CodexRolloutLine,
  CodexTimelineEvent,
  CodexTimelineEventKind,
} from './types.js';

const MAX_ARGUMENT_CHARS = 2_000;
const MAX_PATCH_CHARS = 250_000;
const MAX_OUTPUT_CHARS = 4_000;

export type CodexRolloutParseState = {
  sessionFile: string;
  projectRoot?: string;
  sessionId?: string;
  generationId?: string;
  cwd?: string;
  steps: AgentToolStep[];
  events: CodexTimelineEvent[];
};

/**
 * Parse a Codex CLI rollout JSONL file into agent tool steps.
 * Format reference: response_item/function_call + function_call_output paired by call_id.
 */
export function parseCodexRollout(sessionFile: string): AgentToolStep[] {
  const abs = path.resolve(sessionFile);
  if (!fs.existsSync(abs)) {
    throw new Error(`Codex session not found: ${abs}`);
  }

  const text = fs.readFileSync(abs, 'utf8');
  return consumeCodexRolloutText(createCodexRolloutParseState(abs), text).steps;
}

export function createCodexRolloutParseState(
  sessionFile: string,
  projectRoot?: string,
): CodexRolloutParseState {
  return {
    sessionFile: path.resolve(sessionFile),
    projectRoot: projectRoot ? path.resolve(projectRoot) : undefined,
    steps: [],
    events: [],
  };
}

/** Parse all observable Codex records needed by the unified project timeline. */
export function parseCodexTimelineEvents(
  sessionFile: string,
  projectRoot?: string,
): CodexTimelineEvent[] {
  const abs = path.resolve(sessionFile);
  if (!fs.existsSync(abs)) {
    throw new Error(`Codex session not found: ${abs}`);
  }
  const text = fs.readFileSync(abs, 'utf8');
  return consumeCodexRolloutText(createCodexRolloutParseState(abs, projectRoot), text).events;
}

export function consumeCodexRolloutText(
  state: CodexRolloutParseState,
  text: string,
): CodexRolloutParseState {
  const byId = new Map(state.steps.map((step) => [step.id, step]));

  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let event: CodexRolloutLine;
    try {
      event = JSON.parse(line) as CodexRolloutLine;
    } catch {
      continue;
    }

    if (event.type === 'session_meta' && event.payload) {
      state.sessionId =
        stringOrNull(event.payload.session_id) ||
        stringOrNull(event.payload.id) ||
        state.sessionId;
      continue;
    }

    if (event.type === 'turn_context' && event.payload) {
      state.generationId =
        stringOrNull(event.payload.turn_id) || state.generationId;
      const cwd = stringOrNull(event.payload.cwd);
      state.cwd = cwd ? path.resolve(cwd) : undefined;
      appendTimelineEvent(state, {
        id: `context:${lineIndex + 1}`,
        eventKind: 'context_ref',
        name: 'Turn context',
        timestamp: event.timestamp,
        sourceLine: lineIndex + 1,
        arguments: {
          turnId: state.generationId || null,
          cwd: state.cwd || null,
        },
      });
      continue;
    }

    if (
      event.type === 'event_msg' &&
      event.payload?.type === 'task_started'
    ) {
      const generationId = stringOrNull(event.payload.turn_id);
      if (generationId && generationId !== state.generationId) {
        state.cwd = undefined;
      }
      state.generationId = generationId || state.generationId;
      appendTimelineEvent(state, {
        id: `task-started:${lineIndex + 1}`,
        eventKind: 'task_status',
        name: 'Task started',
        timestamp: event.timestamp || stringOrNull(event.payload.started_at),
        sourceLine: lineIndex + 1,
        status: 'pending',
        output: event.payload,
      });
      continue;
    }

    if (event.type === 'event_msg' && event.payload?.type === 'token_count') {
      const info = record(event.payload.info);
      const usage = record(info?.last_token_usage);
      if (usage) {
        appendTimelineEvent(state, {
          id: `model-usage:${lineIndex + 1}`,
          eventKind: 'model_call',
          name: 'Model token usage',
          timestamp: event.timestamp,
          sourceLine: lineIndex + 1,
          tokenUsage: tokenMetrics(usage),
          output: { usage: tokenMetrics(usage) },
        });
      }
      continue;
    }

    if (event.type === 'event_msg' && event.payload?.type === 'task_complete') {
      const failed = event.payload.error != null;
      appendTimelineEvent(state, {
        id: `task-complete:${lineIndex + 1}`,
        eventKind: 'task_status',
        name: failed ? 'Task failed' : 'Task completed',
        timestamp: event.timestamp || stringOrNull(event.payload.completed_at),
        sourceLine: lineIndex + 1,
        status: 'completed',
        output: event.payload.last_agent_message,
        failed,
        error: failed ? event.payload.error : undefined,
        durationMs: numberOrUndefined(event.payload.duration_ms),
      });
      continue;
    }

    if (event.type === 'event_msg' && event.payload?.type === 'turn_aborted') {
      appendTimelineEvent(state, {
        id: `turn-aborted:${lineIndex + 1}`,
        eventKind: 'task_status',
        name: 'Turn aborted',
        timestamp: event.timestamp || stringOrNull(event.payload.completed_at),
        sourceLine: lineIndex + 1,
        status: 'completed',
        output: event.payload.reason,
        failed: true,
        error: event.payload.reason,
        durationMs: numberOrUndefined(event.payload.duration_ms),
      });
      continue;
    }

    if (event.type === 'event_msg' && event.payload?.type === 'agent_reasoning') {
      const summary = stringOrNull(event.payload.text);
      if (summary) {
        appendTimelineEvent(state, {
          id: `event-reasoning:${lineIndex + 1}`,
          eventKind: 'reasoning',
          name: 'Reasoning summary',
          timestamp: event.timestamp,
          sourceLine: lineIndex + 1,
          content: summary,
        });
      }
      continue;
    }

    if (event.type === 'event_msg' && event.payload?.type === 'agent_message') {
      const message = stringOrNull(event.payload.message);
      if (message) {
        appendTimelineEvent(state, {
          id: `event-message:${lineIndex + 1}`,
          eventKind: 'assistant_message',
          name: 'Agent message',
          timestamp: event.timestamp,
          sourceLine: lineIndex + 1,
          content: message,
          role: 'assistant',
        });
      }
      continue;
    }

    if (
      event.type === 'event_msg' &&
      event.payload?.type === 'patch_apply_end'
    ) {
      const turnId = stringOrNull(event.payload.turn_id) || state.generationId;
      if (!turnId || (state.projectRoot && (!state.cwd || !isPathWithin(state.cwd, state.projectRoot)))) {
        continue;
      }
      const success = event.payload.success === true;
      const id = `patch:${stringOrNull(event.payload.call_id) || `${turnId}:${event.timestamp || state.steps.length}`}`;
      const changes = event.payload.changes;
      const step: AgentToolStep = {
        kind: 'agent_tool',
        id,
        name: 'apply_patch',
        arguments: {},
        output: {
          stdout: event.payload.stdout,
          stderr: event.payload.stderr,
        },
        startedAt: event.timestamp ?? null,
        endedAt: event.timestamp ?? null,
        status: 'completed',
        sessionFile: state.sessionFile,
        sourceLine: lineIndex + 1,
        provider: 'codex',
        sessionId: state.sessionId,
        generationId: turnId,
        cwd: state.cwd,
        projectAssignment: state.cwd ? 'turn_context' : undefined,
        source: 'codex-rollout',
        durationMs: 0,
        failed: !success,
        error: success ? undefined : event.payload.stderr,
        outcome: 'exact',
        appliedChanges: changes && typeof changes === 'object' && !Array.isArray(changes)
          ? changes as Record<string, unknown>
          : undefined,
        appliedChangeSuccess: success,
        eventKind: 'file_change',
      };
      const existing = byId.get(id);
      if (existing) state.steps[state.steps.indexOf(existing)] = step;
      else state.steps.push(step);
      byId.set(id, step);
      replaceTimelineEvent(state, step);
      continue;
    }

    if (event.type !== 'response_item' || !event.payload) {
      continue;
    }

    const payloadType = event.payload.type;
    if (payloadType === 'message') {
      const role = stringOrNull(event.payload.role);
      const content = messageText(event.payload.content);
      if (content && (role === 'user' || role === 'assistant') && !isInjectedRuntimeContext(content)) {
        appendTimelineEvent(state, {
          id: `message:${lineIndex + 1}`,
          eventKind: role === 'user' ? 'user_input' : 'assistant_message',
          name: role === 'user' ? 'User input' : 'Assistant message',
          timestamp: event.timestamp,
          sourceLine: lineIndex + 1,
          content,
          role,
        });
      }
      continue;
    }

    if (payloadType === 'reasoning') {
      const summary = reasoningText(event.payload.summary);
      if (summary) {
        appendTimelineEvent(state, {
          id: `reasoning:${lineIndex + 1}`,
          eventKind: 'reasoning',
          name: 'Reasoning summary',
          timestamp: event.timestamp,
          sourceLine: lineIndex + 1,
          content: summary,
        });
      }
      continue;
    }

    if (payloadType === 'agent_message') {
      const content = messageText(event.payload.content);
      if (content) {
        appendTimelineEvent(state, {
          id: `agent-message:${lineIndex + 1}`,
          eventKind: 'assistant_message',
          name: 'Agent message',
          timestamp: event.timestamp,
          sourceLine: lineIndex + 1,
          content,
          role: 'assistant',
        });
      }
      continue;
    }

    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      const id = stringOrNull(event.payload.call_id);
      const name = stringOrNull(event.payload.name);
      if (!id || !name) {
        continue;
      }

      const rawArguments = payloadType === 'custom_tool_call'
        ? event.payload.input
        : event.payload.arguments;
      const nested = name === 'exec'
        ? extractNestedToolCalls(rawArguments)
        : [];
      const calls: Array<{
        id: string;
        name: string;
        arguments: unknown;
        transportId?: string;
        transportName?: string;
      }> = nested.length > 0
        ? nested.map((call, index) => ({
            id: `${id}:${index + 1}:${call.name}`,
            name: call.name,
            arguments: resolveNestedArguments(rawArguments, call.arguments),
            transportId: id,
            transportName: name,
          }))
        : [{ id, name, arguments: parseArguments(rawArguments) }];

      if (state.projectRoot && (!state.cwd || !isPathWithin(state.cwd, state.projectRoot))) {
        continue;
      }

      for (const call of calls) {
        // Successful and failed patch applications are represented by the
        // authoritative patch_apply_end event, not the pre-execution request.
        if (call.name === 'apply_patch') continue;
        const safeArguments = redactCredentials(call.arguments);
        const step: AgentToolStep = {
          kind: 'agent_tool',
          id: call.id,
          name: call.name,
          arguments: summarizeValue(
            safeArguments,
            call.name === 'apply_patch' ? MAX_PATCH_CHARS : MAX_ARGUMENT_CHARS,
          ),
          startedAt: event.timestamp ?? null,
          endedAt: null,
          status: 'pending',
          sessionFile: state.sessionFile,
          sourceLine: lineIndex + 1,
          provider: 'codex',
          sessionId: state.sessionId,
          generationId: state.generationId,
          cwd: state.cwd,
          projectAssignment: state.cwd ? 'turn_context' : undefined,
          source: 'codex-rollout',
          transportId: call.transportId,
          transportName: call.transportName,
          launchesProcess: canLaunchProcess(call.name, call.arguments),
          eventKind: 'tool_call',
        };
        const previous = byId.get(step.id);
        if (previous) {
          const existingIndex = state.steps.indexOf(previous);
          state.steps[existingIndex] = step;
        } else {
          state.steps.push(step);
        }
        replaceTimelineEvent(state, step);
        byId.set(step.id, step);
      }
      continue;
    }

    if (
      payloadType === 'function_call_output' ||
      payloadType === 'custom_tool_call_output'
    ) {
      const id = stringOrNull(event.payload.call_id);
      if (!id) {
        continue;
      }
      const existingSteps = state.steps.filter(
        (step) => step.id === id || step.transportId === id,
      );
      if (existingSteps.length === 0) {
        continue;
      }
      const exactOutcome = existingSteps.length === 1;
      for (const existing of existingSteps) {
        existing.endedAt = event.timestamp ?? null;
        existing.status = 'completed';
        existing.durationMs = elapsedMs(existing.startedAt, existing.endedAt);
        existing.outcome = exactOutcome ? 'exact' : 'transport-only';
        if (exactOutcome) {
          existing.output = redactOutput(event.payload.output);
          existing.failed = outputFailed(event.payload.output);
          if (existing.failed) existing.error = existing.output;
        }
      }
    }
  }

  return state;
}

function elapsedMs(startedAt: string | null, endedAt: string | null): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const duration = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
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
  return record.isError === true ||
    record.success === false ||
    record.status === 'failed' ||
    record.status === 'error' ||
    (typeof record.exit_code === 'number' && record.exit_code !== 0) ||
    (typeof record.exitCode === 'number' && record.exitCode !== 0);
}

function redactOutput(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  const safe = typeof value === 'string'
    ? redactCredentialText(value, { context: 'auto' })
    : redactCredentials(value);
  return summarizeValue(safe, MAX_OUTPUT_CHARS);
}

function summarizeValue(value: unknown, maxChars: number): unknown {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text.length <= maxChars) {
    return value;
  }
  return {
    $summary: 'truncated',
    $length: text.length,
    $preview: text.slice(0, Math.min(400, maxChars)),
  };
}

function canLaunchProcess(name: string, rawArguments: unknown): boolean {
  if (name === 'shell_command' || name === 'exec_command') {
    return true;
  }
  if (name !== 'exec') {
    return false;
  }
  const text =
    typeof rawArguments === 'string'
      ? rawArguments
      : JSON.stringify(rawArguments ?? null);
  return /\b(?:shell_command|exec_command|spawn|spawnSync)\b/.test(text);
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value ?? null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

type NestedToolCall = {
  name: string;
  arguments: unknown;
};

function extractNestedToolCalls(value: unknown): NestedToolCall[] {
  if (typeof value !== 'string') return [];
  const calls: NestedToolCall[] = [];
  for (let index = 0; index < value.length;) {
    const char = value[index];
    if (char === '"' || char === "'" || char === '`') {
      index = skipQuoted(value, index);
      continue;
    }
    if (value.startsWith('//', index)) {
      const end = value.indexOf('\n', index + 2);
      index = end < 0 ? value.length : end + 1;
      continue;
    }
    if (value.startsWith('/*', index)) {
      const end = value.indexOf('*/', index + 2);
      index = end < 0 ? value.length : end + 2;
      continue;
    }
    if (!value.startsWith('tools.', index) || (index > 0 && /[\w$]/.test(value[index - 1]))) {
      index += 1;
      continue;
    }
    const nameStart = index + 'tools.'.length;
    const nameMatch = /^[A-Za-z_$][\w$]*/.exec(value.slice(nameStart));
    if (!nameMatch) {
      index += 1;
      continue;
    }
    let open = nameStart + nameMatch[0].length;
    while (/\s/.test(value[open] || '')) open += 1;
    if (value[open] !== '(') {
      index = open;
      continue;
    }
    const close = findMatchingParenthesis(value, open);
    if (close < 0) break;
    const firstArgument = firstTopLevelArgument(value.slice(open + 1, close));
    calls.push({
      name: nameMatch[0],
      arguments: parseJavaScriptArgument(firstArgument),
    });
    index = close + 1;
  }
  return calls;
}

function skipQuoted(text: string, start: number): number {
  const quote = text[start];
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === quote) return index + 1;
  }
  return text.length;
}

function findMatchingParenthesis(text: string, open: number): number {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')' && --depth === 0) return index;
  }
  return -1;
}

function firstTopLevelArgument(text: string): string {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if ('({['.includes(char)) depth += 1;
    else if (')}]'.includes(char)) depth -= 1;
    else if (char === ',' && depth === 0) return text.slice(0, index).trim();
  }
  return text.trim();
}

function parseJavaScriptArgument(text: string): unknown {
  if (!text) return null;
  const literal = parseStringLiteral(text);
  if (literal !== null) return literal;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const common = parseCommonObjectFields(text);
    return Object.keys(common).length > 0 ? common : text;
  }
}

/**
 * Codex often writes `const patch = "..."; tools.apply_patch(patch)`.
 * Nested extraction only sees the identifier; resolve it from the exec source.
 */
function resolveNestedArguments(execSource: unknown, args: unknown): unknown {
  if (typeof execSource !== 'string') return args;
  if (typeof args === 'string' && /^[A-Za-z_$][\w$]*$/.test(args.trim())) {
    return resolveIdentifierBinding(execSource, args.trim()) ?? args;
  }
  return args;
}

type TimelineEventInput = {
  id: string;
  eventKind: CodexTimelineEventKind;
  name: string;
  timestamp?: string | null;
  sourceLine: number;
  content?: string;
  role?: 'user' | 'assistant';
  arguments?: unknown;
  output?: unknown;
  status?: 'pending' | 'completed';
  failed?: boolean;
  error?: unknown;
  durationMs?: number;
  tokenUsage?: CodexTimelineEvent['tokenUsage'];
};

function appendTimelineEvent(
  state: CodexRolloutParseState,
  input: TimelineEventInput,
): void {
  if (state.projectRoot && (!state.cwd || !isPathWithin(state.cwd, state.projectRoot))) {
    return;
  }
  const event: CodexTimelineEvent = {
    kind: 'agent_tool',
    id: input.id,
    name: input.name,
    arguments: input.arguments,
    output: input.output,
    startedAt: input.timestamp || null,
    endedAt: input.status === 'completed' ? input.timestamp || null : null,
    status: input.status || 'completed',
    sessionFile: state.sessionFile,
    provider: 'codex',
    sessionId: state.sessionId,
    generationId: state.generationId,
    cwd: state.cwd,
    projectAssignment: state.cwd ? 'turn_context' : undefined,
    source: 'codex-rollout',
    sourceLine: input.sourceLine,
    eventKind: input.eventKind,
    content: input.content,
    role: input.role,
    failed: input.failed,
    error: input.error,
    durationMs: input.durationMs,
    tokenUsage: input.tokenUsage,
  };
  state.events.push(event);
}

function replaceTimelineEvent(
  state: CodexRolloutParseState,
  step: AgentToolStep,
): void {
  if (state.projectRoot && (!step.cwd || !isPathWithin(step.cwd, state.projectRoot))) {
    return;
  }
  const event = step as CodexTimelineEvent;
  const index = state.events.findIndex(item => item.id === step.id);
  if (index >= 0) state.events[index] = event;
  else state.events.push(event);
}

function messageText(value: unknown): string {
  if (typeof value === 'string') return redactCredentialText(value, { context: 'auto' });
  if (!Array.isArray(value)) return '';
  return value.map(item => {
    if (typeof item === 'string') return item;
    const part = record(item);
    return stringOrNull(part?.text) || '';
  }).filter(Boolean).join('\n');
}

function reasoningText(value: unknown): string {
  if (typeof value === 'string') return redactCredentialText(value, { context: 'auto' });
  if (!Array.isArray(value)) return '';
  return value.map(item => {
    if (typeof item === 'string') return item;
    const part = record(item);
    return stringOrNull(part?.text) || '';
  }).filter(Boolean).join('\n');
}

function isInjectedRuntimeContext(value: string): boolean {
  const trimmed = value.trimStart();
  return (
    (trimmed.startsWith('<recommended_plugins>') &&
      trimmed.includes('# AGENTS.md instructions') &&
      trimmed.includes('<environment_context>')) ||
    (trimmed.startsWith('<environment_context>') && trimmed.includes('<workspace_roots>'))
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberOrUndefined(value: unknown): number | undefined {
  return number(value) ?? undefined;
}

function tokenMetrics(value: Record<string, unknown>): NonNullable<CodexTimelineEvent['tokenUsage']> {
  return {
    input: number(value.input_tokens),
    cachedInput: number(value.cached_input_tokens),
    cacheWriteInput: number(value.cache_write_input_tokens),
    output: number(value.output_tokens),
    reasoningOutput: number(value.reasoning_output_tokens),
    total: number(value.total_tokens),
  };
}

function resolveIdentifierBinding(source: string, name: string): unknown | null {
  const pattern = new RegExp(
    `(?:(?:const|let|var)\\s+${name}\\s*=\\s*)((?:"(?:\\\\.|[^"\\\\])*")|(?:'(?:\\\\.|[^'\\\\])*')|(?:\`(?:\\\\.|[^\\\\\`])*\`))`,
  );
  const match = pattern.exec(source);
  if (!match) return null;
  return parseStringLiteral(match[1]);
}

function parseStringLiteral(text: string): string | null {
  const trimmed = text.trim();
  const quote = trimmed[0];
  if (!['"', "'", '`'].includes(quote) || trimmed.at(-1) !== quote) return null;
  if (quote === '"') {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return null;
    }
  }
  if (quote === '`' && trimmed.includes('${')) return null;
  const body = trimmed.slice(1, -1);
  return body.replace(/\\([\\'"`nrt])/g, (_match, escaped: string) => {
    if (escaped === 'n') return '\n';
    if (escaped === 'r') return '\r';
    if (escaped === 't') return '\t';
    return escaped;
  });
}

function parseCommonObjectFields(text: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const keys = [
    'command', 'cmd', 'workdir', 'cwd', 'path', 'prompt', 'cell_id',
    'timeout_ms', 'yield_time_ms', 'terminate',
  ];
  for (const key of keys) {
    const match = new RegExp(`(?:["']?${key}["']?)\\s*:\\s*((?:"(?:\\\\.|[^"\\\\])*")|(?:'(?:\\\\.|[^'\\\\])*')|(?:\\d+)|(?:true|false|null))`).exec(text);
    if (!match) continue;
    const raw = match[1];
    const string = parseStringLiteral(raw);
    if (string !== null) fields[key] = string;
    else if (raw === 'true' || raw === 'false') fields[key] = raw === 'true';
    else if (raw === 'null') fields[key] = null;
    else fields[key] = Number(raw);
  }
  return fields;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isPathWithin(candidate: string, root: string): boolean {
  const comparableCandidate = process.platform === 'win32'
    ? path.resolve(candidate).toLowerCase()
    : path.resolve(candidate);
  const comparableRoot = process.platform === 'win32'
    ? path.resolve(root).toLowerCase()
    : path.resolve(root);
  const relative = path.relative(comparableRoot, comparableCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
