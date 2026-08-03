import fs from 'node:fs';
import path from 'node:path';

import { redactCredentials } from '../../agent-workbench-security/index.mjs';
import type { AgentToolStep, CursorTranscriptLine } from './types.js';

/**
 * Parse a Cursor agent-transcripts JSONL file into agent tool steps.
 *
 * Known limits of the on-disk format:
 * - tool_use inputs are present; tool results usually are not
 * - tool_use blocks often have no stable call id
 * - no per-event timestamps (file mtime used as a weak fallback)
 */
export function parseCursorTranscript(sessionFile: string): AgentToolStep[] {
  const abs = path.resolve(sessionFile);
  if (!fs.existsSync(abs)) {
    throw new Error(`Cursor transcript not found: ${abs}`);
  }

  const sessionId = inferSessionId(abs);
  const fallbackTime = fs.statSync(abs).mtime.toISOString();
  const steps: AgentToolStep[] = [];
  let seq = 0;
  const text = fs.readFileSync(abs, 'utf8');

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let event: CursorTranscriptLine;
    try {
      event = JSON.parse(line) as CursorTranscriptLine;
    } catch {
      continue;
    }

    if (event.role !== 'assistant' || !event.message?.content) {
      continue;
    }

    for (const part of event.message.content) {
      if (part?.type !== 'tool_use') {
        continue;
      }

      const name = typeof part.name === 'string' ? part.name : null;
      if (!name) {
        continue;
      }

      seq += 1;
      const explicitId =
        typeof part.id === 'string' && part.id.length > 0
          ? part.id
          : typeof part.tool_use_id === 'string' && part.tool_use_id.length > 0
            ? part.tool_use_id
            : null;

      steps.push({
        kind: 'agent_tool',
        id: explicitId ?? `cursor_${sessionId}_${seq}`,
        name,
        arguments: redactCredentials(part.input ?? null),
        // Cursor JSONL typically omits tool outputs.
        startedAt: fallbackTime,
        endedAt: fallbackTime,
        status: 'completed',
        sessionFile: abs,
        provider: 'cursor',
      });
    }
  }

  return steps;
}

function inferSessionId(sessionFile: string): string {
  const base = path.basename(sessionFile, path.extname(sessionFile));
  if (/^[0-9a-f-]{36}$/i.test(base)) {
    return base.slice(0, 8);
  }
  const parent = path.basename(path.dirname(sessionFile));
  if (/^[0-9a-f-]{36}$/i.test(parent)) {
    return parent.slice(0, 8);
  }
  return base.slice(0, 8) || 'session';
}
