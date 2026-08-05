import fs from 'node:fs';
import path from 'node:path';

import {
  redactCredentials,
  redactCredentialText,
} from '../../agent-workbench-security/index.mjs';
import type { AgentToolStep, CodexRolloutLine } from './types.js';

const MAX_ARGUMENT_CHARS = 2_000;
const MAX_PATCH_CHARS = 250_000;
const MAX_OUTPUT_CHARS = 4_000;

export type CodexRolloutParseState = {
  sessionFile: string;
  projectRoot?: string;
  conversationId?: string;
  generationId?: string;
  cwd?: string;
  steps: AgentToolStep[];
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
  };
}

export function consumeCodexRolloutText(
  state: CodexRolloutParseState,
  text: string,
): CodexRolloutParseState {
  const byId = new Map(state.steps.map((step) => [step.id, step]));

  for (const rawLine of text.split(/\r?\n/)) {
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
      state.conversationId =
        stringOrNull(event.payload.session_id) ||
        stringOrNull(event.payload.id) ||
        state.conversationId;
      continue;
    }

    if (event.type === 'turn_context' && event.payload) {
      state.generationId =
        stringOrNull(event.payload.turn_id) || state.generationId;
      const cwd = stringOrNull(event.payload.cwd);
      state.cwd = cwd ? path.resolve(cwd) : undefined;
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
      continue;
    }

    if (event.type !== 'response_item' || !event.payload) {
      continue;
    }

    const payloadType = event.payload.type;
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
            arguments: call.arguments,
            transportId: id,
            transportName: name,
          }))
        : [{ id, name, arguments: parseArguments(rawArguments) }];

      if (state.projectRoot && (!state.cwd || !isPathWithin(state.cwd, state.projectRoot))) {
        continue;
      }

      for (const call of calls) {
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
          provider: 'codex',
          conversationId: state.conversationId,
          generationId: state.generationId,
          cwd: state.cwd,
          projectAssignment: state.cwd ? 'turn_context' : undefined,
          source: 'codex-rollout',
          transportId: call.transportId,
          transportName: call.transportName,
          launchesProcess: canLaunchProcess(call.name, call.arguments),
        };
        const previous = byId.get(step.id);
        if (previous) {
          const existingIndex = state.steps.indexOf(previous);
          state.steps[existingIndex] = step;
        } else {
          state.steps.push(step);
        }
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
    'command', 'workdir', 'cwd', 'path', 'prompt', 'cell_id',
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
