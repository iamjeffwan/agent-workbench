#!/usr/bin/env node
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultCodexSessionsDir,
  readCodexTaskEvidence,
  readCodexProjectTimelineEvents,
} from '@agent-workbench/codex-adapter';
import {
  buildTimeline,
  reviewTimelineResults,
} from '@agent-workbench/timeline';
import {
  captureProjectState,
  deriveProjectTurnFacts,
} from '@agent-workbench/project-observation';
import { createSessionHistoryService } from './session-history.mjs';
import { createDeepSeekModelService } from './deepseek-model.mjs';
import { createFlowDocumentGenerator } from './flow-document-generator.mjs';
import { createProjectAssetsService } from './project-assets.mjs';
import { createProjectObservationService } from './project-observation-service.mjs';
import { createReviewObservationService } from './review-observation-service.mjs';
import { createProjectSyncService } from './project-sync.mjs';
import { createTaskLibraryService } from './task-library.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDistDir = path.join(__dirname, '../dist/renderer');
const iconPath = path.join(__dirname, '../assets/icon.png');
const sessionHistory = createSessionHistoryService({
  getUserDataPath: () => app.getPath('userData'),
});
const deepSeekModel = createDeepSeekModelService({
  getUserDataPath: () => app.getPath('userData'),
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: value => safeStorage.encryptString(value),
  decryptString: value => safeStorage.decryptString(value),
});
const flowDocumentGenerator = createFlowDocumentGenerator({
  completeModel: (input, context) => deepSeekModel.complete(input, context),
  skillDirectory: path.join(
    __dirname,
    '../resources/skills/generate-task-flow-document',
  ),
});
const taskLibrary = createTaskLibraryService({
  getUserDataPath: () => app.getPath('userData'),
  resolveSessionFiles: (projectRoot, sessionIds) =>
    sessionHistory.resolveTrackedSessionFiles(projectRoot, sessionIds),
  generateDocument: input => flowDocumentGenerator.generate(input),
  completeModel: (input, context) => deepSeekModel.complete(input, context),
  onChange: change => publishTaskUpdate(change),
});
const projectSync = createProjectSyncService({
  readTask: taskId => taskLibrary.readTask(taskId),
  readTaskEvidence: readCodexTaskEvidence,
});
const projectAssets = createProjectAssetsService({
  readTask: taskId => taskLibrary.readTask(taskId),
  completeModel: (input, context) => deepSeekModel.complete(input, context),
  skillInstructions: fs.readFileSync(
    path.join(__dirname, '../resources/skills/organize-project-asset/SKILL.md'),
    'utf8',
  ).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim(),
  trashItem: target => shell.trashItem(target),
});
const projectObservation = createProjectObservationService({
  getUserDataPath: () => app.getPath('userData'),
  captureState: captureProjectState,
  deriveFacts: deriveProjectTurnFacts,
});
const reviewObservation = createReviewObservationService({
  resolveSessionFiles: (projectRoot, sessionIds) =>
    sessionHistory.resolveTrackedSessionFiles(projectRoot, sessionIds),
  readTask: taskId => taskLibrary.readTask(taskId),
  readProjectObservation: projectRoot => projectObservation.read(projectRoot),
});

if (process.platform === 'win32') {
  app.setAppUserModelId('com.agentworkbench.desktop');
}

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** @type {{
 *  projectRoot: string | null,
 *  turns: unknown[],
 *  review: null | Record<string, unknown>,
 *  reviewsByTurn: Record<string, Record<string, unknown>>,
 *  validationResult: null | Record<string, unknown>,
 *  error: string | null,
 *  observation: null | Record<string, unknown>,
 *  adapters: Record<string, Record<string, unknown>>,
 *  sources: Record<string, Record<string, unknown>>,
 *  files: Record<string, string | null>,
 *  fileBus: {
 *    status: 'idle' | 'watching' | 'error',
 *    directory: string | null,
 *    lastRefreshAt: string | null,
 *    error: string | null
 *  }
 * }} */
let state = {
  projectRoot: null,
  turns: [],
  review: null,
  reviewsByTurn: {},
  validationResult: null,
  error: null,
  observation: null,
  adapters: {
    codex: {
      status: 'idle',
      sessionCount: 0,
      stepCount: 0,
      lastSyncAt: null,
      processLinking: 'unavailable',
      codeState: 'unavailable',
      projectObservation: null,
    },
  },
  sources: {},
  files: {
    agentSteps: null,
    programRecords: null,
    codeChanges: null,
    manifest: null,
  },
  fileBus: {
    status: 'idle',
    directory: null,
    lastRefreshAt: null,
    error: null,
  },
};

/** @type {fs.FSWatcher | null} */
let watcher = null;
/** @type {fs.FSWatcher[]} */
let codexSourceWatchers = [];
/** @type {fs.FSWatcher | null} */
let codexSessionsWatcher = null;
let codexRefreshTimer = null;
/** @type {'idle' | 'live' | 'history'} */
let codexObservationMode = 'idle';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'HTTP Toolkit',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const rendererUrl = process.env.AGENT_WORKBENCH_RENDERER_URL;
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    const rendererMode = process.env.AGENT_WORKBENCH_RENDERER_MODE;
    mainWindow.loadFile(
      path.join(rendererDistDir, 'index.html'),
      rendererMode ? { query: { mode: rendererMode } } : undefined,
    );
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function refreshState() {
  if (!state.projectRoot) {
    state.turns = [];
    state.review = null;
    state.reviewsByTurn = {};
    state.validationResult = null;
    state.error = null;
    state.observation = null;
    state.adapters.codex = {
      status: 'idle',
      sessionCount: 0,
      stepCount: 0,
      lastSyncAt: null,
      processLinking: 'unavailable',
      codeState: 'unavailable',
      projectObservation: null,
    };
    state.fileBus = {
      status: 'idle',
      directory: null,
      lastRefreshAt: null,
      error: null,
    };
    state.sources = {};
    publish();
    return;
  }

  state.files = {
    agentSteps: null,
    programRecords: null,
    codeChanges: null,
    manifest: null,
  };
  state.observation = null;

  try {
    const resolved = resolveCodexObservationFiles(state.projectRoot);
    const codexSteps = resolved.status === 'ready'
      ? readCodexProjectTimelineEvents({ projectRoot: state.projectRoot, sessionFiles: resolved.data.sessionFiles })
      : [];
    const projectCodexSteps = codexSteps.filter((step) => stepBelongsToProject(step, state.projectRoot));
    const observationResult = codexObservationMode === 'live' && resolved.status === 'ready'
      ? projectObservation.observe(state.projectRoot, projectCodexSteps)
      : null;
    state.turns = buildTimeline(
      projectCodexSteps,
      [],
      {},
      [],
    );
    state.validationResult = readValidationResult(state.projectRoot);
    state.review = reviewTimelineResults(state.turns, {
      results: state.validationResult,
    });
    state.reviewsByTurn = buildTurnReviews(state.turns, state.validationResult);
    state.sources = {
      codex: agentCoverage(codexSteps, state.projectRoot),
    };
    state.adapters.codex = {
      ...state.adapters.codex,
      status: resolved.status === 'ready' ? 'ready' : 'error',
      sessionCount: resolved.status === 'ready' ? resolved.data.sessionFiles.length : 0,
      stepCount: codexSteps.filter((step) => !step.parseError).length,
      lastEventAt: latestTimestamp(codexSteps),
      lastSyncAt: null,
      error: resolved.status === 'ready' ? null : resolved.error,
      codeState: observationResult?.status === 'ready' ? 'available' : 'unavailable',
      projectObservation: observationResult,
    };
    if (!state.error) {
      state.error = null;
    }
    state.fileBus = {
      ...state.fileBus,
      status: watcher ? 'watching' : state.fileBus.status,
      lastRefreshAt: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    state.error =
      error instanceof Error ? error.message : 'Failed to build timeline';
    state.turns = [];
    state.review = null;
    state.reviewsByTurn = {};
    state.validationResult = null;
    state.fileBus = {
      ...state.fileBus,
      status: 'error',
      lastRefreshAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Failed to read activity files',
    };
  }
  publish();
}

function agentCoverage(rows, projectRoot) {
  const valid = rows.filter((row) => !row.parseError);
  const assignedToTurn = valid.filter((row) => typeof row.generationId === 'string' && row.generationId);
  const assignedToProject = assignedToTurn.filter((row) => stepBelongsToProject(row, projectRoot));
  const normalized = assignedToProject;
  const rendered = normalized;
  return {
    sourceRecords: rows.length,
    assignedToTurn: assignedToTurn.length,
    assignedToProject: assignedToProject.length,
    normalized: normalized.length,
    rendered: rendered.length,
    hidden: normalized.length - rendered.length,
    unknown: 0,
    invalid: rows.length - valid.length,
  };
}

function stepBelongsToProject(step, projectRoot) {
  if (!projectRoot || typeof step?.cwd !== 'string' || !step.cwd) return false;
  const candidate = comparableProjectPath(step.cwd);
  const root = comparableProjectPath(projectRoot);
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function comparableProjectPath(value) {
  let normalized = value;
  if (process.platform === 'win32' && /^\/[A-Za-z]:[\\/]/.test(normalized)) {
    normalized = normalized.slice(1);
  }
  const resolved = path.resolve(normalized);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function latestTimestamp(rows) {
  let latest = null;
  for (const row of rows) {
    const candidate = row.endedAt || row.startedAt;
    if (typeof candidate !== 'string') continue;
    if (!latest || candidate > latest) latest = candidate;
  }
  return latest;
}

function publish() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('project:state', state);
  }
}

function publishTaskUpdate(change) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tasks:changed', change);
  }
}

function watchProject(projectRoot) {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  state.fileBus = {
    status: 'watching',
    directory: projectRoot,
    lastRefreshAt: state.fileBus.lastRefreshAt,
    error: null,
  };
  watchCodexSources(projectRoot);
}

function readValidationResult(projectRoot) {
  const candidates = [
    path.join(projectRoot, '.agent-workbench', 'validation-result.json'),
    path.join(projectRoot, 'test-results', 'agent-workbench-validation.json'),
  ];
  const statuses = new Set(['passed', 'failed', 'incomplete', 'unknown']);
  const checkStatuses = new Set(['passed', 'failed', 'incomplete', 'not_run', 'unknown']);
  const checkKinds = new Set(['command', 'test', 'build', 'lint', 'playwright', 'artifact']);
  const artifactKinds = new Set(['screenshot', 'trace', 'video', 'report', 'other']);
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (!parsed || parsed.version !== 1 || typeof parsed.profileId !== 'string' || !statuses.has(parsed.status)) {
        continue;
      }
      const checks = Array.isArray(parsed.checks)
        ? parsed.checks
          .filter(check => check && typeof check.id === 'string' && checkStatuses.has(check.status))
          .map(check => ({
            id: check.id,
            label: typeof check.label === 'string' ? check.label : undefined,
            command: typeof check.command === 'string' ? check.command : undefined,
            result: typeof check.result === 'string' ? check.result : undefined,
            kind: typeof check.kind === 'string' && checkKinds.has(check.kind) ? check.kind : undefined,
            status: check.status,
            summary: typeof check.summary === 'string' ? check.summary : undefined,
            durationMs: typeof check.durationMs === 'number' ? check.durationMs : null,
            artifacts: Array.isArray(check.artifacts)
              ? check.artifacts.filter(artifact => artifact && typeof artifact.path === 'string' && artifactKinds.has(artifact.kind))
                .map(artifact => ({ path: artifact.path, kind: artifact.kind }))
              : undefined,
          }))
        : [];
      return {
        version: 1,
        profileId: parsed.profileId,
        status: parsed.status,
        checks,
        generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined,
        sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
        generationId: typeof parsed.generationId === 'string'
          ? parsed.generationId
          : typeof parsed.turnId === 'string'
            ? parsed.turnId
            : undefined,
      };
    } catch {
      // A malformed optional result must not make the observation view unreadable.
    }
  }
  return null;
}

function buildTurnReviews(turns, validationResult) {
  const observableTurns = turns.filter(turn => turn.type === 'turn' && turn.generationId);
  const latestKey = observableTurns
    .map(turn => ({ turn, timestamp: timestampValue(turn.startedAt) ?? 0 }))
    .sort((left, right) => left.timestamp - right.timestamp)
    .at(-1);
  return Object.fromEntries(observableTurns.map(turn => {
    const key = turnIdentity(turn);
    const result = validationResult && validationResultMatchesTurn(validationResult, turn, key === turnIdentity(latestKey?.turn))
      ? validationResult
      : null;
    return [key, reviewTimelineResults([turn], { results: result })];
  }));
}

function validationResultMatchesTurn(result, turn, isLatestWithoutIdentity) {
  const hasIdentity = Boolean(result.sessionId || result.generationId);
  if (!hasIdentity) return isLatestWithoutIdentity;
  return (!result.sessionId || result.sessionId === turn.sessionId) &&
    (!result.generationId || result.generationId === turn.generationId);
}

function turnIdentity(turn) {
  return `${turn?.sessionId || 'unassigned'}:${turn?.generationId || 'unknown'}`;
}

function timestampValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function watchCodexSources(projectRoot) {
  closeCodexWatchers();
  if (codexObservationMode === 'idle') return;

  const resolved = resolveCodexObservationFiles(projectRoot);
  if (resolved.status !== 'ready') return;
  for (const sessionFile of resolved.data.sessionFiles) {
    try {
      const sourceWatcher = fs.watch(sessionFile, { persistent: false }, scheduleCodexRefresh);
      sourceWatcher.on('error', () => {});
      codexSourceWatchers.push(sourceWatcher);
    } catch {
      // Missing sources are reported by the next explicit refresh.
    }
  }

  if (codexObservationMode !== 'live') return;
  const sessionsDir = defaultCodexSessionsDir();
  if (!fs.existsSync(sessionsDir)) return;
  try {
    codexSessionsWatcher = fs.watch(
      sessionsDir,
      { persistent: false, recursive: process.platform === 'win32' },
      scheduleCodexRefresh,
    );
    codexSessionsWatcher.on('error', () => {});
  } catch {
    // An explicit refresh still discovers new rollout files if directory watching is unavailable.
  }
}

function resolveCodexObservationFiles(projectRoot) {
  if (codexObservationMode === 'live') {
    const sessions = sessionHistory.listSessions(projectRoot);
    return sessions.status === 'ready'
      ? sessionHistory.resolveTrackedSessionFiles(
          projectRoot,
          sessions.data.map(session => session.id),
        )
      : sessions;
  }
  if (codexObservationMode === 'history') {
    const selection = sessionHistory.getTrackedSelection(projectRoot);
    return selection.status === 'ready'
      ? sessionHistory.resolveTrackedSessionFiles(projectRoot, selection.data.sessionIds)
      : selection;
  }
  return {
    status: 'ready',
    source: 'codex-rollout',
    data: { projectRoot, sessionIds: [], sessionFiles: [] },
    error: null,
  };
}

function scheduleCodexRefresh() {
  if (codexRefreshTimer) clearTimeout(codexRefreshTimer);
  codexRefreshTimer = setTimeout(() => {
    codexRefreshTimer = null;
    if (codexObservationMode === 'live' && state.projectRoot) {
      watchCodexSources(state.projectRoot);
    }
    refreshState();
  }, 120);
}

function closeCodexWatchers() {
  for (const sourceWatcher of codexSourceWatchers) sourceWatcher.close();
  codexSourceWatchers = [];
  if (codexSessionsWatcher) {
    codexSessionsWatcher.close();
    codexSessionsWatcher = null;
  }
  if (codexRefreshTimer) clearTimeout(codexRefreshTimer);
  codexRefreshTimer = null;
}

function useCodexObservationMode(mode) {
  codexObservationMode = mode;
  if (state.projectRoot) {
    refreshState();
    watchCodexSources(state.projectRoot);
  }
  return state;
}

async function openProject() {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: '选择项目目录',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) {
    return state;
  }

  return activateProject(result.filePaths[0]);
}

function activateProject(projectRoot) {
  codexObservationMode = 'idle';
  state.projectRoot = projectRoot;
  state.observation = null;
  state.error = null;
  watchProject(state.projectRoot);
  refreshState();
  return state;
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('project:open', () => openProject());
  ipcMain.handle('project:getState', () => state);
  ipcMain.handle('project:refresh', () => {
    if (state.projectRoot) {
      watchProject(state.projectRoot);
    }
    refreshState();
    return state;
  });
  ipcMain.handle('view:startLive', () => useCodexObservationMode('live'));
  ipcMain.handle('view:useHistory', () => useCodexObservationMode('history'));
  ipcMain.handle('history:listProjects', () => sessionHistory.listProjects());
  ipcMain.handle('history:listSessions', (_event, projectRoot) =>
    sessionHistory.listSessions(projectRoot ?? state.projectRoot));
  ipcMain.handle('history:readSession', (_event, projectRoot, sessionId) =>
    sessionHistory.readSession(projectRoot ?? state.projectRoot, sessionId));
  ipcMain.handle('history:getTrackedSelection', (_event, projectRoot) =>
    sessionHistory.getTrackedSelection(projectRoot ?? state.projectRoot));
  ipcMain.handle('history:setTrackedSelection', (_event, projectRoot, sessionIds) => {
    const targetProjectRoot = projectRoot ?? state.projectRoot;
    const result = sessionHistory.setTrackedSelection(targetProjectRoot, sessionIds);
    if (result.status === 'ready' && targetProjectRoot) {
      const isActiveProject = Boolean(
        state.projectRoot &&
        comparableProjectPath(state.projectRoot) === comparableProjectPath(targetProjectRoot),
      );
      if (sessionIds.length > 0 && !isActiveProject) {
        activateProject(targetProjectRoot);
      } else if (isActiveProject) {
        if (codexObservationMode === 'history') {
          refreshState();
          watchCodexSources(state.projectRoot);
        }
      }
    }
    return result;
  });
  ipcMain.handle('tasks:list', (_event, projectRoot) => taskLibrary.listTasks(projectRoot));
  ipcMain.handle('tasks:read', (_event, taskId) => taskLibrary.readTask(taskId));
  ipcMain.handle('tasks:create', (_event, input) => taskLibrary.createTask(input));
  ipcMain.handle('tasks:discuss', (_event, taskId, message) => taskLibrary.discuss(taskId, message));
  ipcMain.handle('tasks:saveScript', (_event, taskId, input) => taskLibrary.saveScript(taskId, input));
  ipcMain.handle('review:prepareFromTask', (_event, taskId, options) =>
    reviewObservation.prepareFromTask(taskId, options));
  ipcMain.handle('review:prepareFromTurns', (_event, input) =>
    reviewObservation.prepareFromTurns(input));
  ipcMain.handle('sync:listTasks', (_event, projectRoot) => projectSync.listSyncTasks(projectRoot ?? state.projectRoot));
  ipcMain.handle('sync:readTask', (_event, projectRoot, taskId) => projectSync.readSyncTask(projectRoot ?? state.projectRoot, taskId));
  ipcMain.handle('sync:addTask', (_event, taskId) => projectSync.addTaskToSync(taskId));
  ipcMain.handle('sync:repositoryStatus', (_event, projectRoot) => projectSync.getRepositoryStatus(projectRoot ?? state.projectRoot));
  ipcMain.handle('sync:pullRepository', (_event, projectRoot) => projectSync.pullRepository(projectRoot ?? state.projectRoot));
  ipcMain.handle('sync:publishRepository', (_event, input) => projectSync.publishRepository(input));
  ipcMain.handle('sync:createGithubRepository', (_event, input) => projectSync.createGithubRepository(input));
  ipcMain.handle('assets:list', (_event, projectRoot) => projectAssets.listAssets(projectRoot ?? state.projectRoot));
  ipcMain.handle('assets:read', (_event, projectRoot, relativePath) =>
    projectAssets.readAsset(projectRoot ?? state.projectRoot, relativePath));
  ipcMain.handle('assets:createDraft', (_event, input) => projectAssets.createDraft(input));
  ipcMain.handle('assets:writeDraft', (_event, input) => projectAssets.writeDraft(input));
  ipcMain.handle('assets:initializeDocs', (_event, projectRoot) => projectAssets.initializeDocs(projectRoot ?? state.projectRoot));
  ipcMain.handle('assets:createFolder', (_event, projectRoot, relativePath) => projectAssets.createFolder(projectRoot ?? state.projectRoot, relativePath));
  ipcMain.handle('assets:renameFolder', (_event, projectRoot, relativePath, nextName) => projectAssets.renameFolder(projectRoot ?? state.projectRoot, relativePath, nextName));
  ipcMain.handle('assets:trashFolder', (_event, projectRoot, relativePath) => projectAssets.trashFolder(projectRoot ?? state.projectRoot, relativePath));
  ipcMain.handle('assets:createDocument', (_event, projectRoot, relativePath) => projectAssets.createDocument(projectRoot ?? state.projectRoot, relativePath));
  ipcMain.handle('assets:renameDocument', (_event, projectRoot, relativePath, nextName) => projectAssets.renameDocument(projectRoot ?? state.projectRoot, relativePath, nextName));
  ipcMain.handle('assets:trashDocument', (_event, projectRoot, relativePath) => projectAssets.trashDocument(projectRoot ?? state.projectRoot, relativePath));
  ipcMain.handle('model:getStatus', () => deepSeekModel.getStatus());
  ipcMain.handle('model:saveDeepSeekApiKey', (_event, apiKey) => deepSeekModel.saveApiKey(apiKey));
  ipcMain.handle('model:clearDeepSeekApiKey', () => deepSeekModel.clearApiKey());
  ipcMain.handle('model:testDeepSeekConnection', () => deepSeekModel.testConnection({
    projectRoot: state.projectRoot,
  }));
  ipcMain.handle('model:listCalls', () => deepSeekModel.listCalls());
  ipcMain.handle('model:readCall', (_event, callId) => deepSeekModel.readCall(callId));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  closeCodexWatchers();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
