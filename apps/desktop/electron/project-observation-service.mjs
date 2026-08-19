import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const STORE_VERSION = 1;
const STORE_DIRECTORY = 'project-observations';
const SOURCE = 'project-observation';

export function createProjectObservationService({
  getUserDataPath,
  captureState,
  deriveFacts,
  now = () => new Date(),
} = {}) {
  if (typeof getUserDataPath !== 'function') {
    throw new Error('getUserDataPath is required');
  }
  if (typeof captureState !== 'function' || typeof deriveFacts !== 'function') {
    throw new Error('Project observation capture and derivation functions are required');
  }

  const observeTurns = (projectRoot, collect) => {
    if (!projectRoot) return unavailable(emptySummary(), 'Open a project before observing turns.');

    try {
      const target = storePath(getUserDataPath(), projectRoot);
      const store = readStore(target, projectRoot);
      const turns = collect();
      let dirty = false;

      for (const turn of turns) {
        const key = turnKey(turn.sessionId, turn.turnId);
        const existing = store.turns[key];
        if (isFinal(existing)) continue;

        if (turn.terminal) {
          if (existing?.before) {
            dirty = completeTurn(store, key, turn, existing, captureState, deriveFacts, now) || dirty;
          } else {
            store.turns[key] = unavailableTurn(turn, existing, now());
            dirty = true;
          }
          continue;
        }

        if (!existing || existing.status === 'error') {
          store.turns[key] = startTurn(store.projectId, turn, captureState, now());
          dirty = true;
        }
      }

      if (dirty) {
        store.updatedAt = now().toISOString();
        writeJsonAtomically(target, store);
      }
      return ready(summarize(store));
    } catch (error) {
      return failed(emptySummary(), error, 'Unable to observe project changes.');
    }
  };

  return {
    observe(projectRoot, events) {
      return observeTurns(projectRoot, () => collectTurns(events));
    },

    observeSession(projectRoot, observationSession) {
      return observeTurns(projectRoot, () => collectObservationTurns(observationSession));
    },

    read(projectRoot) {
      if (!projectRoot) return unavailable(null, 'Open a project before reading observations.');
      try {
        return ready(readStore(storePath(getUserDataPath(), projectRoot), projectRoot));
      } catch (error) {
        return failed(null, error, 'Unable to read project observations.');
      }
    },
  };
}

function collectTurns(events) {
  const turns = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== 'object') continue;
    const sessionId = cleanString(event.sessionId);
    const turnId = cleanString(event.generationId);
    const cwd = cleanString(event.cwd);
    if (!sessionId || !turnId || !cwd) continue;
    const key = turnKey(sessionId, turnId);
    const current = turns.get(key) ?? { sessionId, turnId, cwd, terminal: false };
    current.cwd = cwd;
    current.terminal ||= isTerminalEvent(event);
    turns.set(key, current);
  }
  return [...turns.values()];
}

function collectObservationTurns(observationSession) {
  if (!observationSession || typeof observationSession !== 'object' || Array.isArray(observationSession)) {
    throw new Error('Observation session is invalid.');
  }
  const sessionId = cleanString(observationSession.session?.sessionId);
  const sessionCwd = cleanString(observationSession.session?.cwd);
  if (!sessionId || !Array.isArray(observationSession.turns)) {
    throw new Error('Observation session is missing its identity or turns.');
  }

  return observationSession.turns.flatMap(turn => {
    const turnId = cleanString(turn?.turnId);
    const cwd = cleanString(turn?.cwd) ?? sessionCwd;
    if (!turnId || !cwd) return [];
    return [{
      sessionId,
      turnId,
      cwd,
      terminal: turn.status === 'completed' || turn.status === 'aborted',
    }];
  });
}

function isTerminalEvent(event) {
  if (event.eventKind !== 'task_status') return false;
  return event.name === 'Task completed' ||
    event.name === 'Task failed' ||
    event.name === 'Turn aborted';
}

function startTurn(projectId, turn, captureState, capturedAt) {
  const context = contextFor(projectId, turn);
  try {
    return {
      ...turnIdentity(turn),
      cwd: path.resolve(turn.cwd),
      status: 'observing',
      observedAt: capturedAt.toISOString(),
      fidelity: 'observation_window',
      before: captureState(context, capturedAt),
    };
  } catch (error) {
    return {
      ...turnIdentity(turn),
      cwd: path.resolve(turn.cwd),
      status: 'error',
      observedAt: capturedAt.toISOString(),
      fidelity: 'observation_window',
      stage: 'before',
      error: errorMessage(error, 'Unable to capture the state before the turn.'),
    };
  }
}

function completeTurn(store, key, turn, existing, captureState, deriveFacts, now) {
  const capturedAt = now();
  const context = contextFor(store.projectId, turn);
  let after = existing.after;

  if (!after) {
    try {
      after = captureState(context, capturedAt);
    } catch (error) {
      store.turns[key] = {
        ...existing,
        status: 'error',
        completedAt: capturedAt.toISOString(),
        stage: 'after_capture',
        error: errorMessage(error, 'Unable to capture the state after the turn.'),
      };
      return true;
    }
  }

  try {
    const facts = deriveFacts(context, existing.before, after, capturedAt);
    store.turns[key] = {
      ...existing,
      status: 'completed',
      completedAt: capturedAt.toISOString(),
      attribution: 'source_uncertain',
      after,
      facts,
    };
  } catch (error) {
    store.turns[key] = {
      ...existing,
      status: 'error',
      completedAt: capturedAt.toISOString(),
      stage: 'derive',
      error: errorMessage(error, 'Unable to derive project changes for the turn.'),
      after,
    };
  }
  return true;
}

function unavailableTurn(turn, existing, observedAt) {
  const reason = existing?.stage === 'before'
    ? 'before_capture_failed'
    : 'turn_started_before_observation';
  return {
    ...turnIdentity(turn),
    cwd: path.resolve(turn.cwd),
    status: 'unavailable',
    observedAt: existing?.observedAt ?? observedAt.toISOString(),
    completedAt: observedAt.toISOString(),
    fidelity: 'unavailable',
    reason,
    ...(existing?.error ? { error: existing.error } : {}),
  };
}

function contextFor(projectId, turn) {
  return {
    projectId,
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    cwd: turn.cwd,
  };
}

function turnIdentity(turn) {
  return { sessionId: turn.sessionId, turnId: turn.turnId };
}

function isFinal(turn) {
  return turn?.status === 'completed' || turn?.status === 'unavailable';
}

function readStore(file, projectRoot) {
  const resolvedRoot = path.resolve(projectRoot);
  if (!fs.existsSync(file)) return emptyStore(resolvedRoot);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    parsed.version !== STORE_VERSION ||
    comparablePath(parsed.projectRoot) !== comparablePath(resolvedRoot) ||
    !parsed.turns ||
    typeof parsed.turns !== 'object' ||
    Array.isArray(parsed.turns)
  ) {
    throw new Error('Project observation store is invalid.');
  }
  return parsed;
}

function emptyStore(projectRoot) {
  return {
    version: STORE_VERSION,
    projectId: localProjectId(projectRoot),
    projectRoot,
    updatedAt: null,
    turns: {},
  };
}

function summarize(store) {
  const summary = emptySummary();
  for (const turn of Object.values(store.turns)) {
    if (Object.hasOwn(summary, turn?.status)) summary[turn.status] += 1;
  }
  summary.updatedAt = store.updatedAt;
  return summary;
}

function emptySummary() {
  return { observing: 0, completed: 0, unavailable: 0, error: 0, updatedAt: null };
}

function storePath(userDataPath, projectRoot) {
  if (typeof userDataPath !== 'string' || !userDataPath) {
    throw new Error('Electron user data directory is unavailable.');
  }
  const digest = createHash('sha256').update(comparablePath(projectRoot)).digest('hex');
  return path.join(userDataPath, STORE_DIRECTORY, `${digest}.json`);
}

function localProjectId(projectRoot) {
  const digest = createHash('sha256').update(comparablePath(projectRoot)).digest('hex');
  return `local-project:${digest.slice(0, 24)}`;
}

function comparablePath(value) {
  const resolved = path.resolve(String(value));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function turnKey(sessionId, turnId) {
  return `${sessionId}\0${turnId}`;
}

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function errorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
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
    error: errorMessage(cause, fallback),
  };
}
