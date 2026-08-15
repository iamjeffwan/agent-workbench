import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  findCodexSessions,
  listCodexConversationProjects,
  readCodexProjectConversation,
  readCodexSessionMetadata,
} from '@agent-workbench/codex-adapter';

const CONFIG_VERSION = 1;
const CONFIG_FILE = 'conversation-tracking.json';
const INDEX_VERSION = 3;
const INDEX_DIRECTORY = 'conversation-history';
const SOURCE = 'codex-rollout';

/**
 * Keep Electron-specific state out of the history reader so failures can be
 * returned to the renderer without taking down the main process.
 */
export function createConversationHistoryService({
  getUserDataPath,
  findSessionFiles = findCodexSessions,
  listConversationProjects = listCodexConversationProjects,
  readProjectConversation = readCodexProjectConversation,
  readSessionMetadata = readCodexSessionMetadata,
}) {
  const conversationCache = new Map();
  const detailCache = new Map();

  const loadConversations = (projectRoot, refresh = false) => {
    const key = projectKey(projectRoot);
    if (!refresh && conversationCache.has(key)) {
      return conversationCache.get(key);
    }
    const conversations = refreshConversationIndex({
      projectRoot,
      indexFile: indexPath(getUserDataPath(), projectRoot),
      findSessionFiles,
      readProjectConversation,
      detailCache,
    });
    conversationCache.set(key, conversations);
    return conversations;
  };

  return {
    listProjects() {
      try {
        return ready(listConversationProjects());
      } catch (error) {
        return failed([], error, 'Unable to discover Codex conversation projects.');
      }
    },

    listConversations(projectRoot) {
      if (!projectRoot) {
        return unavailable([], 'Open a project to browse Codex conversations.');
      }

      try {
        const conversations = loadConversations(projectRoot, true);
        return ready(conversations);
      } catch (error) {
        const cached = conversationCache.get(projectKey(projectRoot)) ??
          readPersistedSummaries(indexPath(getUserDataPath(), projectRoot), projectRoot);
        return failed(
          cached,
          error,
          'Unable to read Codex conversation history.',
        );
      }
    },

    readConversation(projectRoot, conversationId) {
      if (!projectRoot) {
        return unavailable(null, 'Open a project to read a Codex conversation.');
      }
      if (typeof conversationId !== 'string' || !conversationId.trim()) {
        return failed(null, null, 'A conversation ID is required.');
      }

      try {
        const target = indexPath(getUserDataPath(), projectRoot);
        if (!fs.existsSync(target)) loadConversations(projectRoot, true);
        const index = readIndex(target, projectKey(projectRoot));
        const matches = Object.entries(index.files).filter(([, entry]) =>
          entry?.summary?.id === conversationId);
        if (matches.length !== 1) {
          return failed(
            null,
            null,
            'The selected conversation cannot be located exactly in the history index.',
          );
        }
        const [[sessionFile, entry]] = matches;
        const conversation = readIndexedConversation({
          projectRoot,
          conversationId,
          sessionFile,
          readProjectConversation,
          detailCache,
        });
        return ready(toConversationDetails(conversation));
      } catch (error) {
        return failed(null, error, 'Unable to read the selected Codex conversation.');
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
        return unavailable(empty, 'Open a project to read its tracked conversations.');
      }

      try {
        const config = readConfig(configPath(getUserDataPath()));
        const project = config.projects[projectKey(projectRoot)];
        return ready(trackedSelection(
          projectRoot,
          Array.isArray(project?.trackedConversationIds)
            ? project.trackedConversationIds.filter(value => typeof value === 'string')
            : [],
        ));
      } catch (error) {
        return failed(empty, error, 'Unable to read the tracked conversation selection.');
      }
    },

    setTrackedSelection(projectRoot, input) {
      const empty = trackedSelection(projectRoot, []);
      if (!projectRoot) {
        return unavailable(empty, 'Open a project before saving tracked conversations.');
      }

      const conversationIds = normalizeConversationIds(input);
      if (conversationIds === null) {
        return failed(empty, null, 'Tracked conversation IDs must be an array of strings.');
      }

      try {
        const target = configPath(getUserDataPath());
        const config = readConfig(target);
        const existing = trackedSelection(
          projectRoot,
          Array.isArray(config.projects[projectKey(projectRoot)]?.trackedConversationIds)
            ? config.projects[projectKey(projectRoot)].trackedConversationIds
                .filter(value => typeof value === 'string')
            : [],
        );
        if (conversationIds.length > 0) {
          const resolution = resolveTrackedSessionFilesResult({
            projectRoot,
            input: conversationIds,
            getUserDataPath,
            readSessionMetadata,
          });
          if (resolution.status !== 'ready') {
            return failed(
              existing,
              null,
              resolution.error ?? 'Unable to validate tracked conversations.',
            );
          }
        }
        config.projects[projectKey(projectRoot)] = {
          projectRoot: path.resolve(projectRoot),
          trackedConversationIds: conversationIds,
          updatedAt: new Date().toISOString(),
        };
        writeConfig(target, config);
        return ready(trackedSelection(projectRoot, conversationIds));
      } catch (error) {
        return failed(empty, error, 'Unable to save the tracked conversation selection.');
      }
    },
  };
}

function resolvedSessionFiles(
  projectRoot,
  conversationIds,
  sessionFiles,
  missingConversationIds,
  staleConversationIds = [],
  ambiguousConversationIds = [],
) {
  return {
    projectRoot: projectRoot ? path.resolve(projectRoot) : null,
    conversationIds,
    sessionFiles,
    missingConversationIds,
    staleConversationIds,
    ambiguousConversationIds,
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
    return unavailable(empty, 'Open a project to resolve tracked conversations.');
  }
  const conversationIds = normalizeConversationIds(input);
  if (conversationIds === null) {
    return failed(empty, null, 'Tracked conversation IDs must be an array of strings.');
  }
  if (conversationIds.length === 0) return ready(empty);

  try {
    const target = indexPath(getUserDataPath(), projectRoot);
    if (!fs.existsSync(target)) {
      return unavailable(empty, 'Conversation history must be indexed before tracking it.');
    }
    const index = readIndex(target, projectKey(projectRoot));
    const sessionFiles = [];
    const missingConversationIds = [];
    const staleConversationIds = [];
    const ambiguousConversationIds = [];
    for (const conversationId of conversationIds) {
      const matches = Object.entries(index.files).filter(([, entry]) =>
        entry?.summary?.id === conversationId);
      if (matches.length === 0) {
        missingConversationIds.push(conversationId);
        continue;
      }
      if (matches.length > 1) {
        ambiguousConversationIds.push(conversationId);
        continue;
      }
      const [[sessionFile, entry]] = matches;
      if (!isCurrentIndexEntry(
        sessionFile,
        entry,
        conversationId,
        readSessionMetadata,
      )) {
        staleConversationIds.push(conversationId);
        continue;
      }
      sessionFiles.push(path.resolve(sessionFile));
    }

    const data = resolvedSessionFiles(
      projectRoot,
      conversationIds,
      sessionFiles,
      missingConversationIds,
      staleConversationIds,
      ambiguousConversationIds,
    );
    if (
      missingConversationIds.length ||
      staleConversationIds.length ||
      ambiguousConversationIds.length
    ) {
      return failed(
        data,
        null,
        'Some tracked conversations cannot be resolved exactly from the history index.',
      );
    }
    return ready(data);
  } catch (error) {
    return failed(empty, error, 'Unable to resolve tracked Codex conversations.');
  }
}

function refreshConversationIndex({
  projectRoot,
  indexFile,
  findSessionFiles,
  readProjectConversation,
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

    const conversation = readProjectConversation({ projectRoot, sessionFile });
    nextFiles[sessionFile] = {
      ...fingerprint,
      summary: conversation ? toConversationSummary(conversation) : null,
    };
    const cacheKey = detailCacheKey(projectRoot, sessionFile);
    if (conversation) {
      detailCache.set(cacheKey, { ...fingerprint, conversation });
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
    throw new Error('Conversation history index is invalid.');
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
  conversationId,
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
  return metadata?.sessionId === conversationId;
}

function readIndexedConversation({
  projectRoot,
  conversationId,
  sessionFile,
  readProjectConversation,
  detailCache,
}) {
  const stat = fs.statSync(sessionFile);
  if (!stat.isFile()) throw new Error('Indexed Codex conversation source is not a file.');
  const fingerprint = { size: stat.size, mtimeMs: stat.mtimeMs };
  const cacheKey = detailCacheKey(projectRoot, sessionFile);
  const cached = detailCache.get(cacheKey);
  if (
    cached?.size === fingerprint.size &&
    cached?.mtimeMs === fingerprint.mtimeMs &&
    cached.conversation?.id === conversationId
  ) {
    return cached.conversation;
  }

  const conversation = readProjectConversation({ projectRoot, sessionFile });
  if (!conversation) {
    throw new Error('The indexed conversation no longer belongs to this project.');
  }
  if (conversation.id !== conversationId) {
    throw new Error('The indexed rollout no longer matches the selected conversation.');
  }
  detailCache.set(cacheKey, { ...fingerprint, conversation });
  return conversation;
}

function detailCacheKey(projectRoot, sessionFile) {
  return `${projectKey(projectRoot)}\0${path.resolve(sessionFile)}`;
}

function summariesFromIndex(index) {
  return Object.values(index.files)
    .map(entry => entry?.summary)
    .filter(Boolean)
    .sort(compareConversations);
}

function sameKeys(left, right) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index]);
}

function compareConversations(left, right) {
  return (
    String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')) ||
    String(left.id ?? '').localeCompare(String(right.id ?? ''))
  );
}

function toConversationSummary(conversation) {
  return {
    id: conversation.id,
    provider: conversation.provider,
    title: conversation.title,
    startedAt: conversation.startedAt,
    updatedAt: conversation.updatedAt,
    turnCount: conversation.turns.length,
    observableTurnCount: conversation.turns.filter(turn => turn.hasObservableActivity).length,
  };
}

function toConversationDetails(conversation) {
  return {
    ...toConversationSummary(conversation),
    turns: conversation.turns,
  };
}

function trackedSelection(projectRoot, conversationIds) {
  return {
    projectRoot: projectRoot ? path.resolve(projectRoot) : null,
    conversationIds: [...new Set(conversationIds)],
  };
}

function normalizeConversationIds(input) {
  const values = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray(input.conversationIds)
      ? input.conversationIds
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
    throw new Error('Conversation tracking configuration is invalid.');
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
