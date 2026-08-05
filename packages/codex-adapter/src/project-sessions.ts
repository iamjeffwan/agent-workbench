import fs from 'node:fs';
import path from 'node:path';

import { findCodexSessions } from './find-sessions.js';
import {
  consumeCodexRolloutText,
  createCodexRolloutParseState,
  parseCodexRollout,
} from './parse-rollout.js';
import type { CodexRolloutParseState } from './parse-rollout.js';
import type { AgentToolStep, CodexRolloutLine } from './types.js';

const METADATA_READ_LIMIT = 64 * 1024;

export type CodexSessionMetadata = {
  sessionFile: string;
  sessionId: string;
  cwd: string;
  startedAt: string | null;
};

export type SyncCodexProjectOptions = {
  projectRoot: string;
  sessionsDir?: string;
  outFile?: string;
  stateFile?: string;
};

export type SyncCodexProjectResult = {
  changed: boolean;
  sessionCount: number;
  stepCount: number;
  outFile: string;
  syncedAt: string;
};

export type WatchCodexProjectOptions = SyncCodexProjectOptions & {
  intervalMs?: number;
  onChange?: (result: SyncCodexProjectResult) => void;
  onSync?: (result: SyncCodexProjectResult) => void;
  onError?: (error: unknown) => void;
};

export type CodexProjectWatcher = {
  syncNow: () => SyncCodexProjectResult;
  close: () => void;
};

type StoredSessionState = {
  offset: number;
  parser: CodexRolloutParseState;
};

type StoredSyncState = {
  version: 4;
  sessions: Record<string, StoredSessionState>;
};

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
      if (!cwd) {
        return null;
      }
      const sessionId =
        stringOrNull(event.payload.session_id) ||
        stringOrNull(event.payload.id) ||
        inferSessionId(abs);
      return {
        sessionFile: abs,
        sessionId,
        cwd: path.resolve(cwd),
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

export function syncCodexProjectSessions(
  options: SyncCodexProjectOptions,
): SyncCodexProjectResult {
  const projectRoot = path.resolve(options.projectRoot);
  const outFile = path.resolve(
    options.outFile ||
      path.join(projectRoot, '.agent-workbench', 'codex-agent-steps.jsonl'),
  );
  const sessions = findCodexSessions(options.sessionsDir);

  const steps = deduplicateSteps(
    sessions
      .flatMap((sessionFile) => parseCodexRollout(sessionFile))
      .filter((step) => step.cwd && isCodexSessionForProject(step.cwd, projectRoot)),
  ).sort(compareSteps);
  const nextText = steps.length
    ? `${steps.map((step) => JSON.stringify(step)).join('\n')}\n`
    : '';
  const currentText = fs.existsSync(outFile)
    ? fs.readFileSync(outFile, 'utf8')
    : null;
  const changed = currentText !== nextText;

  if (changed) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, nextText, 'utf8');
  }

  return {
    changed,
    sessionCount: new Set(steps.map((step) => step.sessionFile)).size,
    stepCount: steps.length,
    outFile,
    syncedAt: new Date().toISOString(),
  };
}

export function watchCodexProjectSessions(
  options: WatchCodexProjectOptions,
): CodexProjectWatcher {
  const intervalMs = Math.max(250, options.intervalMs ?? 1_000);
  const stateFile = path.resolve(
    options.stateFile ||
      path.join(options.projectRoot, '.agent-workbench', 'codex-sync-state.json'),
  );
  let stored = readStoredSyncState(stateFile);
  const metadataCache = new Map<string, CodexSessionMetadata>();
  let closed = false;
  let lastFingerprint: string | null = null;

  const syncNow = (): SyncCodexProjectResult => {
    const result = syncCodexProjectSessionsIncrementally(
      options,
      stored,
      metadataCache,
    );
    writeStoredSyncState(stateFile, stored);
    lastFingerprint = projectSessionFingerprint(options, metadataCache);
    options.onSync?.(result);
    if (result.changed) {
      options.onChange?.(result);
    }
    return result;
  };

  const poll = () => {
    if (closed) {
      return;
    }
    try {
      const fingerprint = projectSessionFingerprint(options, metadataCache);
      if (fingerprint !== lastFingerprint) {
        syncNow();
      }
    } catch (error) {
      options.onError?.(error);
    }
  };

  try {
    syncNow();
  } catch (error) {
    options.onError?.(error);
  }
  const timer = setInterval(poll, intervalMs);
  timer.unref?.();

  return {
    syncNow,
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}

function syncCodexProjectSessionsIncrementally(
  options: SyncCodexProjectOptions,
  stored: StoredSyncState,
  metadataCache: Map<string, CodexSessionMetadata>,
): SyncCodexProjectResult {
  const projectRoot = path.resolve(options.projectRoot);
  const outFile = path.resolve(
    options.outFile ||
      path.join(projectRoot, '.agent-workbench', 'codex-agent-steps.jsonl'),
  );
  const sessions = findCodexSessions(options.sessionsDir).map((sessionFile) => path.resolve(sessionFile));

  for (const sessionFile of sessions) {
    let session = stored.sessions[sessionFile];
    const size = fs.statSync(sessionFile).size;
    if (!session || session.offset > size) {
      session = {
        offset: 0,
        parser: createCodexRolloutParseState(sessionFile, projectRoot),
      };
      stored.sessions[sessionFile] = session;
    }
    consumeCompleteAppendedLines(sessionFile, size, session);
  }

  const steps = deduplicateSteps(
    Object.values(stored.sessions).flatMap((session) => session.parser.steps),
  ).sort(compareSteps);
  const changed = writeStepsIfChanged(outFile, steps);
  return {
    changed,
    sessionCount: new Set(steps.map((step) => step.sessionFile)).size,
    stepCount: steps.length,
    outFile,
    syncedAt: new Date().toISOString(),
  };
}

function consumeCompleteAppendedLines(
  sessionFile: string,
  size: number,
  session: StoredSessionState,
): void {
  const remaining = size - session.offset;
  if (remaining <= 0) {
    return;
  }
  const buffer = Buffer.alloc(remaining);
  let handle: number | null = null;
  try {
    handle = fs.openSync(sessionFile, 'r');
    const count = fs.readSync(handle, buffer, 0, remaining, session.offset);
    const completeEnd = buffer.lastIndexOf(0x0a, count - 1);
    if (completeEnd < 0) {
      return;
    }
    const complete = buffer.subarray(0, completeEnd + 1).toString('utf8');
    consumeCodexRolloutText(session.parser, complete);
    session.offset += completeEnd + 1;
  } finally {
    if (handle !== null) {
      fs.closeSync(handle);
    }
  }
}

function readStoredSyncState(stateFile: string): StoredSyncState {
  if (!fs.existsSync(stateFile)) {
    return { version: 4, sessions: {} };
  }
  try {
    const value = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as StoredSyncState;
    if (
      value.version === 4 &&
      value.sessions &&
      typeof value.sessions === 'object' &&
      Object.values(value.sessions).every(isStoredSessionState)
    ) {
      return value;
    }
  } catch {
    // Invalid or interrupted checkpoints are rebuilt from the source sessions.
  }
  return { version: 4, sessions: {} };
}

function isStoredSessionState(value: unknown): value is StoredSessionState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as StoredSessionState;
  return (
    Number.isSafeInteger(candidate.offset) &&
    candidate.offset >= 0 &&
    !!candidate.parser &&
    typeof candidate.parser.sessionFile === 'string' &&
    Array.isArray(candidate.parser.steps)
  );
}

function writeStoredSyncState(stateFile: string, state: StoredSyncState): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state)}\n`, 'utf8');
}

function projectSessionFingerprint(
  options: SyncCodexProjectOptions,
  _metadataCache = new Map<string, CodexSessionMetadata>(),
): string {
  return findCodexSessions(options.sessionsDir)
    .map((sessionFile) => {
      try {
        const stat = fs.statSync(sessionFile);
        return `${sessionFile}:${stat.size}:${stat.mtimeMs}`;
      } catch {
        return null;
      }
    })
    .filter((value): value is string => value !== null)
    .sort()
    .join('|');
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
    byId.set(`${step.conversationId || step.sessionFile}:${step.id}`, step);
  }
  return [...byId.values()];
}

function writeStepsIfChanged(outFile: string, steps: AgentToolStep[]): boolean {
  const nextText = steps.length
    ? `${steps.map((step) => JSON.stringify(step)).join('\n')}\n`
    : '';
  const currentText = fs.existsSync(outFile)
    ? fs.readFileSync(outFile, 'utf8')
    : null;
  if (currentText === nextText) {
    return false;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, nextText, 'utf8');
  return true;
}

function compareSteps(left: AgentToolStep, right: AgentToolStep): number {
  return (left.startedAt || '').localeCompare(right.startedAt || '');
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
