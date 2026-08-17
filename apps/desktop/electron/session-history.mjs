import { createHash } from 'node:crypto';
// Session history storage and rollout index.
import fs from 'node:fs';
import path from 'node:path';

import {
  findCodexSessions,
  listCodexSessionProjects,
  readCodexProjectSession,
  readCodexSessionMetadata,
} from '@agent-workbench/codex-adapter';

const CONFIG_VERSION = 1;
const CONFIG_FILE = 'session-tracking.json';
const INDEX_VERSION = 3;
const INDEX_DIRECTORY = 'session-history';
const SOURCE = 'codex-rollout';

/**
 * Keep Electron-specific state out of the history reader so failures can be
 * returned to the renderer without taking down the main process.
 */
export function createSessionHistoryService({
  getUserDataPath,
  findSessionFiles = findCodexSessions,
  listSessionProjects = listCodexSessionProjects,
  readProjectSession = readCodexProjectSession,
  readSessionMetadata = readCodexSessionMetadata,
}) {
  const sessionCache = new Map();
  const detailCache = new Map();

  const loadSessions = (projectRoot, refresh = false) => {
    const key = projectKey(projectRoot);
    if (!refresh && sessionCache.has(key)) {
      return sessionCache.get(key);
    }
    const sessions = refreshSessionIndex({
      projectRoot,
      indexFile: indexPath(getUserDataPath(), projectRoot),
      findSessionFiles,
      readProjectSession,
      detailCache,
    });
    sessionCache.set(key, sessions);
    return sessions;
  };

  return {
    listProjects() {
      try {
        return ready(listSessionProjects());
      } catch (error) {
        return failed([], error, 'Unable to discover Codex session projects.');
      }
    },

    listSessions(projectRoot) {
      if (!projectRoot) {
        return unavailable([], 'Open a project to browse Codex sessions.');
      }

      try {
        const sessions = loadSessions(projectRoot, true);
        return ready(sessions);
      } catch (error) {
        const cached = sessionCache.get(projectKey(projectRoot)) ??
          readPersistedSummaries(indexPath(getUserDataPath(), projectRoot), projectRoot);
        return failed(
          cached,
          error,
          'Unable to read Codex session history.',
        );
      }
    },

    readSession(projectRoot, sessionId) {
      if (!projectRoot) {
        return unavailable(null, 'Open a project to read a Codex session.');
      }
      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        return failed(null, null, 'A session ID is required.');
      }

      try {
        const target = indexPath(getUserDataPath(), projectRoot);
        if (!fs.existsSync(target)) loadSessions(projectRoot, true);
        const index = readIndex(target, projectKey(projectRoot));
        const matches = Object.entries(index.files).filter(([, entry]) =>
          entry?.summary?.id === sessionId);
        if (matches.length !== 1) {
          return failed(
            null,
            null,
            'The selected session cannot be located exactly in the history index.',
          );
        }
        const [[sessionFile, entry]] = matches;
        const session = readIndexedSession({
          projectRoot,
          sessionId,
          sessionFile,
          readProjectSession,
          detailCache,
        });
        return ready(toSessionDetails(session));
      } catch (error) {
        return failed(null, error, 'Unable to read the selected Codex session.');
      }
    },

    resolveTrackedSessionFiles(projectRoot, input) {
      return resolveTrackedSessionFilesResult({
        projectRoot,
        input,
        getUserDataPath,
        readSessionMetadata,
      });
    },

    getTrackedSelection(projectRoot) {
      const empty = trackedSelection(projectRoot, []);
      if (!projectRoot) {
        return unavailable(empty, 'Open a project to read its tracked sessions.');
      }

      try {
        const config = readConfig(configPath(getUserDataPath()));
        const project = config.projects[projectKey(projectRoot)];
        return ready(trackedSelection(
          projectRoot,
          Array.isArray(project?.trackedSessionIds)
            ? project.trackedSessionIds.filter(value => typeof value === 'string')
            : [],
        ));
      } catch (error) {
        return failed(empty, error, 'Unable to read the tracked session selection.');
      }
    },

    setTrackedSelection(projectRoot, input) {
      const empty = trackedSelection(projectRoot, []);
      if (!projectRoot) {
        return unavailable(empty, 'Open a project before saving tracked sessions.');
      }

      const sessionIds = normalizeSessionIds(input);
      if (sessionIds === null) {
        return failed(empty, null, 'Tracked session IDs must be an array of strings.');
      }

      try {
        const target = configPath(getUserDataPath());
        const config = readConfig(target);
        const existing = trackedSelection(
          projectRoot,
          Array.isArray(config.projects[projectKey(projectRoot)]?.trackedSessionIds)
            ? config.projects[projectKey(projectRoot)].trackedSessionIds
                .filter(value => typeof value === 'string')
            : [],
        );
        if (sessionIds.length > 0) {
          const resolution = resolveTrackedSessionFilesResult({
            projectRoot,
            input: sessionIds,
            getUserDataPath,
            readSessionMetadata,
          });
          if (resolution.status !== 'ready') {
            return failed(
              existing,
              null,
              resolution.error ?? 'Unable to validate tracked sessions.',
            );
          }
        }
        config.projects[projectKey(projectRoot)] = {
          projectRoot: path.resolve(projectRoot),
          trackedSessionIds: sessionIds,
          updatedAt: new Date().toISOString(),
        };
        writeConfig(target, config);
        return ready(trackedSelection(projectRoot, sessionIds));
      } catch (error) {
        return failed(empty, error, 'Unable to save the tracked session selection.');
      }
    },
  };
}

function resolvedSessionFiles(
  projectRoot,
  sessionIds,
  sessionFiles,
  missingSessionIds,
  staleSessionIds = [],
  ambiguousSessionIds = [],
) {
  return {
    projectRoot: projectRoot ? path.resolve(projectRoot) : null,
    sessionIds,
    sessionFiles,
    missingSessionIds,
    staleSessionIds,
    ambiguousSessionIds,
  };
}

function resolveTrackedSessionFilesResult({
  projectRoot,
  input,
  getUserDataPath,
  readSessionMetadata,
}) {
  const empty = resolvedSessionFiles(projectRoot, [], [], [], []);
  if (!projectRoot) {
    return unavailable(empty, 'Open a project to resolve tracked sessions.');
  }
  const sessionIds = normalizeSessionIds(input);
  if (sessionIds === null) {
    return failed(empty, null, 'Tracked session IDs must be an array of strings.');
  }
  if (sessionIds.length === 0) return ready(empty);

  try {
    const target = indexPath(getUserDataPath(), projectRoot);
    if (!fs.existsSync(target)) {
      return unavailable(empty, 'Session history must be indexed before tracking it.');
    }
    const index = readIndex(target, projectKey(projectRoot));
    const sessionFiles = [];
    const missingSessionIds = [];
    const staleSessionIds = [];
    const ambiguousSessionIds = [];
    for (const sessionId of sessionIds) {
      const matches = Object.entries(index.files).filter(([, entry]) =>
        entry?.summary?.id === sessionId);
      if (matches.length === 0) {
        missingSessionIds.push(sessionId);
        continue;
      }
      if (matches.length > 1) {
        ambiguousSessionIds.push(sessionId);
        continue;
      }
      const [[sessionFile, entry]] = matches;
      if (!isCurrentIndexEntry(
        sessionFile,
        entry,
        sessionId,
        readSessionMetadata,
      )) {
        staleSessionIds.push(sessionId);
        continue;
      }
      sessionFiles.push(path.resolve(sessionFile));
    }

    const data = resolvedSessionFiles(
      projectRoot,
      sessionIds,
      sessionFiles,
      missingSessionIds,
      staleSessionIds,
      ambiguousSessionIds,
    );
    if (
      missingSessionIds.length ||
      staleSessionIds.length ||
      ambiguousSessionIds.length
    ) {
      return failed(
        data,
        null,
        'Some tracked sessions cannot be resolved exactly from the history index.',
      );
    }
    return ready(data);
  } catch (error) {
    return failed(empty, error, 'Unable to resolve tracked Codex sessions.');
  }
}

function refreshSessionIndex({
  projectRoot,
  indexFile,
  findSessionFiles,
  readProjectSession,
  detailCache,
}) {
  const rootKey = projectKey(projectRoot);
  let index;
  let dirty = false;
  try {
    index = readIndex(indexFile, rootKey);
  } catch {
    index = emptyIndex(rootKey);
    dirty = true;
  }

  const nextFiles = {};
  const sessionFiles = findSessionFiles();
  for (const sourceFile of sessionFiles) {
    const sessionFile = path.resolve(sourceFile);
    const stat = fs.statSync(sessionFile);
    if (!stat.isFile()) continue;
    const fingerprint = { size: stat.size, mtimeMs: stat.mtimeMs };
    const cached = index.files[sessionFile];
    if (isReusableIndexEntry(cached, fingerprint)) {
      nextFiles[sessionFile] = cached;
      continue;
    }

    const session = readProjectSession({ projectRoot, sessionFile });
    nextFiles[sessionFile] = {
      ...fingerprint,
      summary: session ? toSessionSummary(session) : null,
    };
    const cacheKey = detailCacheKey(projectRoot, sessionFile);
    if (session) {
      detailCache.set(cacheKey, { ...fingerprint, session });
    } else {
      detailCache.delete(cacheKey);
    }
    dirty = true;
  }

  if (!sameKeys(index.files, nextFiles)) dirty = true;
  const nextIndex = {
    version: INDEX_VERSION,
    projectRoot: rootKey,
    files: nextFiles,
  };
  if (dirty) writeJsonAtomically(indexFile, nextIndex);

  return summariesFromIndex(nextIndex);
}

function readIndex(file, rootKey) {
  if (!fs.existsSync(file)) return emptyIndex(rootKey);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    parsed.version !== INDEX_VERSION ||
    parsed.projectRoot !== rootKey ||
    !parsed.files ||
    typeof parsed.files !== 'object' ||
    Array.isArray(parsed.files)
  ) {
    throw new Error('Session history index is invalid.');
  }
  return parsed;
}

function readPersistedSummaries(file, projectRoot) {
  try {
    return summariesFromIndex(readIndex(file, projectKey(projectRoot)));
  } catch {
    return [];
  }
}

function emptyIndex(rootKey) {
  return {
    version: INDEX_VERSION,
    projectRoot: rootKey,
    files: {},
  };
}

function isReusableIndexEntry(entry, fingerprint) {
  return Boolean(
    entry &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    entry.size === fingerprint.size &&
    entry.mtimeMs === fingerprint.mtimeMs &&
    Object.prototype.hasOwnProperty.call(entry, 'summary'),
  );
}

function isCurrentIndexEntry(
  sessionFile,
  entry,
  sessionId,
  readSessionMetadata,
) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  try {
    const stat = fs.statSync(sessionFile);
    if (!stat.isFile()) return false;
    if (stat.size === entry.size && stat.mtimeMs === entry.mtimeMs) return true;
  } catch {
    return false;
  }
  const metadata = readSessionMetadata(sessionFile);
  return metadata?.sessionId === sessionId;
}

function readIndexedSession({
  projectRoot,
  sessionId,
  sessionFile,
  readProjectSession,
  detailCache,
}) {
  const stat = fs.statSync(sessionFile);
  if (!stat.isFile()) throw new Error('Indexed Codex session source is not a file.');
  const fingerprint = { size: stat.size, mtimeMs: stat.mtimeMs };
  const cacheKey = detailCacheKey(projectRoot, sessionFile);
  const cached = detailCache.get(cacheKey);
  if (
    cached?.size === fingerprint.size &&
    cached?.mtimeMs === fingerprint.mtimeMs &&
    cached.session?.id === sessionId
  ) {
    return cached.session;
  }

  const session = readProjectSession({ projectRoot, sessionFile });
  if (!session) {
    throw new Error('The indexed session no longer belongs to this project.');
  }
  if (session.id !== sessionId) {
    throw new Error('The indexed rollout no longer matches the selected session.');
  }
  detailCache.set(cacheKey, { ...fingerprint, session });
  return session;
}

function detailCacheKey(projectRoot, sessionFile) {
  return `${projectKey(projectRoot)}\0${path.resolve(sessionFile)}`;
}

function summariesFromIndex(index) {
  return Object.values(index.files)
    .map(entry => entry?.summary)
    .filter(Boolean)
    .sort(compareSessions);
}

function sameKeys(left, right) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index]);
}

function compareSessions(left, right) {
  return (
    String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')) ||
    String(left.id ?? '').localeCompare(String(right.id ?? ''))
  );
}

function toSessionSummary(session) {
  return {
    id: session.id,
    provider: session.provider,
    title: session.title,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    turnCount: session.turns.length,
    observableTurnCount: session.turns.filter(turn => turn.hasObservableActivity).length,
  };
}

function toSessionDetails(session) {
  return {
    ...toSessionSummary(session),
    turns: session.turns,
  };
}

function trackedSelection(projectRoot, sessionIds) {
  return {
    projectRoot: projectRoot ? path.resolve(projectRoot) : null,
    sessionIds: [...new Set(sessionIds)],
  };
}

function normalizeSessionIds(input) {
  const values = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray(input.sessionIds)
      ? input.sessionIds
      : null;
  if (!values || values.some(value => typeof value !== 'string')) return null;
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function configPath(userDataPath) {
  if (typeof userDataPath !== 'string' || !userDataPath) {
    throw new Error('Electron user data directory is unavailable.');
  }
  return path.join(userDataPath, CONFIG_FILE);
}

function indexPath(userDataPath, projectRoot) {
  if (typeof userDataPath !== 'string' || !userDataPath) {
    throw new Error('Electron user data directory is unavailable.');
  }
  const digest = createHash('sha256').update(projectKey(projectRoot)).digest('hex');
  return path.join(userDataPath, INDEX_DIRECTORY, `${digest}.json`);
}

function readConfig(file) {
  if (!fs.existsSync(file)) return emptyConfig();
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Session tracking configuration is invalid.');
  }
  return {
    version: CONFIG_VERSION,
    projects:
      parsed.projects && typeof parsed.projects === 'object' && !Array.isArray(parsed.projects)
        ? parsed.projects
        : {},
  };
}

function writeConfig(file, config) {
  writeJsonAtomically(file, config);
}

function writeJsonAtomically(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function emptyConfig() {
  return { version: CONFIG_VERSION, projects: {} };
}

function projectKey(projectRoot) {
  const resolved = path.resolve(projectRoot);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function ready(data) {
  return { status: 'ready', source: SOURCE, data, error: null };
}

function unavailable(data, error) {
  return { status: 'unavailable', source: SOURCE, data, error };
}

function failed(data, cause, fallback) {
  return {
    status: 'error',
    source: SOURCE,
    data,
    error: cause instanceof Error ? cause.message : fallback,
  };
}
