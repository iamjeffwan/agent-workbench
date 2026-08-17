import fs from 'node:fs';
import path from 'node:path';

import { findCodexSessions } from './find-sessions.js';
import { parseCodexRollout, parseCodexTimelineEvents } from './parse-rollout.js';
import type { AgentToolStep, CodexRolloutLine, CodexTimelineEvent } from './types.js';

const METADATA_READ_LIMIT = 64 * 1024;

export type CodexSessionMetadata = {
  sessionFile: string;
  sessionId: string;
  cwd: string | null;
  startedAt: string | null;
};

export type ReadCodexProjectStepsOptions = {
  projectRoot: string;
  sessionsDir?: string;
  /** Exact rollout paths already resolved by the local history index. */
  sessionFiles?: readonly string[];
  /** When provided, only these user-selected Codex sessions are parsed. */
  sessionIds?: readonly string[];
};

/** Build the current tracked project view directly from the selected rollout files. */
export function readCodexProjectSteps(options: ReadCodexProjectStepsOptions): AgentToolStep[] {
  const projectRoot = path.resolve(options.projectRoot);
  return deduplicateSteps(
    selectedSessionFiles(options)
      .flatMap(sessionFile => parseCodexRollout(sessionFile))
      .filter(step => step.cwd && isCodexSessionForProject(step.cwd, projectRoot)),
  ).sort(compareSteps);
}

/** Build the complete observable event stream for the selected project sessions. */
export function readCodexProjectTimelineEvents(
  options: ReadCodexProjectStepsOptions,
): CodexTimelineEvent[] {
  return deduplicateTimelineEvents(
    selectedSessionFiles(options)
      .flatMap(sessionFile => parseCodexTimelineEvents(sessionFile, options.projectRoot))
      .filter(event => event.cwd && isCodexSessionForProject(event.cwd, options.projectRoot)),
  ).sort(compareTimelineEvents);
}

export function readCodexSessionMetadata(
  sessionFile: string,
): CodexSessionMetadata | null {
  const abs = path.resolve(sessionFile);
  let handle: number | null = null;
  try {
    handle = fs.openSync(abs, 'r');
    const buffer = Buffer.alloc(METADATA_READ_LIMIT);
    const count = fs.readSync(handle, buffer, 0, buffer.length, 0);
    const text = buffer.toString('utf8', 0, count);

    for (const rawLine of text.split(/\r?\n/)) {
      if (!rawLine.trim()) {
        continue;
      }
      let event: CodexRolloutLine;
      try {
        event = JSON.parse(rawLine) as CodexRolloutLine;
      } catch {
        continue;
      }
      if (event.type !== 'session_meta' || !event.payload) {
        continue;
      }
      const cwd = stringOrNull(event.payload.cwd);
      const sessionId =
        stringOrNull(event.payload.id) ||
        stringOrNull(event.payload.session_id) ||
        inferSessionId(abs);
      return {
        sessionFile: abs,
        sessionId,
        cwd: cwd ? path.resolve(cwd) : null,
        startedAt:
          stringOrNull(event.timestamp) || stringOrNull(event.payload.timestamp),
      };
    }
  } catch {
    return null;
  } finally {
    if (handle !== null) {
      fs.closeSync(handle);
    }
  }
  return null;
}

export function isCodexSessionForProject(
  sessionCwd: string,
  projectRoot: string,
): boolean {
  const cwd = comparablePath(sessionCwd);
  const root = comparablePath(projectRoot);
  const relative = path.relative(root, cwd);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function selectedSessionFiles(
  options: ReadCodexProjectStepsOptions,
  metadataCache = new Map<string, CodexSessionMetadata>(),
): string[] {
  if (options.sessionFiles) {
    return [...new Set(options.sessionFiles.map(sessionFile => path.resolve(sessionFile)))];
  }
  const sessions = findCodexSessions(options.sessionsDir);
  if (options.sessionIds === undefined) {
    return sessions;
  }
  const selected = new Set(options.sessionIds);
  if (selected.size === 0) {
    return [];
  }
  return sessions.filter((sessionFile) => {
    const metadata = cachedSessionMetadata(sessionFile, metadataCache);
    return metadata ? selected.has(metadata.sessionId) : false;
  });
}

function cachedSessionMetadata(
  sessionFile: string,
  cache: Map<string, CodexSessionMetadata>,
): CodexSessionMetadata | null {
  const abs = path.resolve(sessionFile);
  const cached = cache.get(abs);
  if (cached) {
    return cached;
  }
  const metadata = readCodexSessionMetadata(abs);
  if (metadata) {
    cache.set(abs, metadata);
  }
  return metadata;
}

function deduplicateSteps(steps: AgentToolStep[]): AgentToolStep[] {
  const byId = new Map<string, AgentToolStep>();
  for (const step of steps) {
    byId.set(`${step.sessionId || step.sessionFile}:${step.id}`, step);
  }
  return [...byId.values()];
}

function deduplicateTimelineEvents(events: CodexTimelineEvent[]): CodexTimelineEvent[] {
  const byId = new Map<string, CodexTimelineEvent>();
  for (const event of events) {
    byId.set(`${event.sessionId || event.sessionFile}:${event.id}`, event);
  }
  return [...byId.values()];
}

function compareSteps(left: AgentToolStep, right: AgentToolStep): number {
  return (left.startedAt || '').localeCompare(right.startedAt || '');
}

function compareTimelineEvents(left: CodexTimelineEvent, right: CodexTimelineEvent): number {
  return (left.startedAt || '').localeCompare(right.startedAt || '') ||
    (left.sourceLine || 0) - (right.sourceLine || 0);
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
