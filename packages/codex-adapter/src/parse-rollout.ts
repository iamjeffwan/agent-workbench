import fs from 'node:fs';
import path from 'node:path';

import {
  redactCredentials,
  redactCredentialText,
} from '../../agent-workbench-security/index.mjs';
import type { AgentToolStep, CodexRolloutLine } from './types.js';

/**
 * Parse a Codex CLI rollout JSONL file into agent tool steps.
 * Format reference: response_item/function_call + function_call_output paired by call_id.
 */
export function parseCodexRollout(sessionFile: string): AgentToolStep[] {
  const abs = path.resolve(sessionFile);
  if (!fs.existsSync(abs)) {
    throw new Error(`Codex session not found: ${abs}`);
  }

  const pending = new Map<string, AgentToolStep>();
  const orderedIds: string[] = [];
  const text = fs.readFileSync(abs, 'utf8');

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

    if (event.type !== 'response_item' || !event.payload) {
      continue;
    }

    const payloadType = event.payload.type;
    if (payloadType === 'function_call') {
      const id = stringOrNull(event.payload.call_id);
      const name = stringOrNull(event.payload.name);
      if (!id || !name) {
        continue;
      }

      const step: AgentToolStep = {
        kind: 'agent_tool',
        id,
        name,
        arguments: redactCredentials(parseArguments(event.payload.arguments)),
        startedAt: event.timestamp ?? null,
        endedAt: null,
        status: 'pending',
        sessionFile: abs,
        provider: 'codex',
      };
      pending.set(id, step);
      orderedIds.push(id);
      continue;
    }

    if (payloadType === 'function_call_output') {
      const id = stringOrNull(event.payload.call_id);
      if (!id) {
        continue;
      }
      const existing = pending.get(id);
      if (!existing) {
        continue;
      }
      const output = stringOrNull(event.payload.output);
      existing.output =
        output === null
          ? undefined
          : redactCredentialText(output, { context: 'auto' });
      existing.endedAt = event.timestamp ?? null;
      existing.status = 'completed';
    }
  }

  return orderedIds
    .map((id) => pending.get(id))
    .filter((step): step is AgentToolStep => step !== undefined);
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

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
