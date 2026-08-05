#!/usr/bin/env node
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { watchCodexProjectSessions } from '@agent-workbench/codex-adapter';
import { installProjectObservation } from '@agent-workbench/project-observe';
import {
  buildTimeline,
  classifyAgentTool,
  readJsonl,
} from '@agent-workbench/timeline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDistDir = path.join(__dirname, '../dist/renderer');
const iconPath = path.join(__dirname, '../assets/icon.png');
const workbenchHome = resolveWorkbenchHome();

if (process.platform === 'win32') {
  app.setAppUserModelId('com.agentworkbench.desktop');
}

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** @type {{
 *  projectRoot: string | null,
 *  turns: unknown[],
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
  error: null,
  observation: null,
  adapters: {
    cursor: {
      status: 'idle',
      stepCount: 0,
      lastEventAt: null,
      processLinking: 'ready',
      codeState: 'ready',
    },
    codex: {
      status: 'idle',
      sessionCount: 0,
      stepCount: 0,
      lastSyncAt: null,
      processLinking: 'unavailable',
      codeState: 'unavailable',
    },
  },
  sources: {},
  files: {
    agentSteps: null,
    codexAgentSteps: null,
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

/** @type {import('@agent-workbench/codex-adapter').CodexProjectWatcher | null} */
let codexWatcher = null;

function resolveWorkbenchHome() {
  if (process.env.AGENT_WORKBENCH_HOME) {
    return path.resolve(process.env.AGENT_WORKBENCH_HOME);
  }
  // apps/desktop/electron -> repo root
  return path.resolve(__dirname, '../../..');
}

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
      sandbox: false,
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

function workbenchPaths(projectRoot) {
  const dir = path.join(projectRoot, '.agent-workbench');
  return {
    dir,
    agentSteps: path.join(dir, 'agent-steps.jsonl'),
    codexAgentSteps: path.join(dir, 'codex-agent-steps.jsonl'),
    programRecords: path.join(dir, 'trace-records.jsonl'),
    codeChanges: path.join(dir, 'code-changes.jsonl'),
    manifest: path.join(dir, 'trace-manifest.json'),
    observation: path.join(dir, 'observation.json'),
    hookErrors: path.join(dir, 'hook-errors.log'),
  };
}

function loadMethods(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return {};
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const map = {};
    for (const method of manifest.methods || []) {
      const label = method.className
        ? `${method.className}.${method.methodName}`
        : method.methodName;
      map[method.id] = {
        label,
        sourceFile: method.sourceFile,
        compiledFile: method.compiledFile,
      };
    }
    return map;
  } catch (error) {
    state.error =
      error instanceof Error ? error.message : 'Failed to read manifest';
    return {};
  }
}

function readObservation(observationPath) {
  if (!fs.existsSync(observationPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(observationPath, 'utf8'));
  } catch {
    return null;
  }
}

function refreshState() {
  if (!state.projectRoot) {
    state.turns = [];
    state.error = null;
    state.observation = null;
    state.adapters.cursor = {
      status: 'idle',
      stepCount: 0,
      lastEventAt: null,
      processLinking: 'ready',
      codeState: 'ready',
    };
    state.adapters.codex = {
      status: 'idle',
      sessionCount: 0,
      stepCount: 0,
      lastSyncAt: null,
      processLinking: 'unavailable',
      codeState: 'unavailable',
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

  const paths = workbenchPaths(state.projectRoot);
  state.files = {
    agentSteps: paths.agentSteps,
    codexAgentSteps: paths.codexAgentSteps,
    programRecords: paths.programRecords,
    codeChanges: paths.codeChanges,
    manifest: paths.manifest,
  };
  state.observation = readObservation(paths.observation);

  try {
    const cursorSteps = readJsonl(paths.agentSteps);
    const codexSteps = readJsonl(paths.codexAgentSteps);
    const projectCursorSteps = cursorSteps.filter((step) => stepBelongsToProject(step, state.projectRoot));
    const projectCodexSteps = codexSteps.filter((step) => stepBelongsToProject(step, state.projectRoot));
    const agentSteps = [...projectCursorSteps, ...projectCodexSteps];
    const programRecords = readJsonl(paths.programRecords);
    const codeChanges = readJsonl(paths.codeChanges);
    const methods = loadMethods(paths.manifest);
    state.turns = buildTimeline(
      agentSteps,
      programRecords,
      methods,
      codeChanges,
    );
    state.sources = {
      cursor: agentCoverage(cursorSteps, state.projectRoot),
      codex: agentCoverage(codexSteps, state.projectRoot),
      runtime: runtimeCoverage(programRecords, agentSteps),
      changes: changeCoverage(codeChanges),
    };
    const lastHookError = readLastLine(paths.hookErrors);
    state.adapters.cursor = {
      ...state.adapters.cursor,
      status: state.observation?.workbenchHome ? 'ready' : 'error',
      stepCount: cursorSteps.filter((step) => !step.parseError).length,
      lastEventAt: latestTimestamp(cursorSteps),
      lastHookError,
    };
    state.adapters.codex = {
      ...state.adapters.codex,
      stepCount: codexSteps.filter((step) => !step.parseError).length,
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
  const classified = assignedToProject.map((row) => ({ row, classification: classifyAgentTool(row) }));
  const normalized = classified.filter((item) => item.classification.normalized);
  const rendered = normalized.filter((item) => item.classification.display);
  return {
    sourceRecords: rows.length,
    assignedToTurn: assignedToTurn.length,
    assignedToProject: assignedToProject.length,
    normalized: normalized.length,
    rendered: rendered.length,
    hidden: normalized.length - rendered.length,
    unknown: assignedToProject.length - normalized.length,
    invalid: rows.length - valid.length,
  };
}

function runtimeCoverage(rows, agentSteps) {
  const valid = rows.filter((row) => !row.parseError);
  const normalized = valid.filter((row) => typeof row.callId === 'number');
  const origins = new Set(agentSteps.map((step) => step.id).filter(Boolean));
  const linked = normalized.filter((row) => row.processOriginId && origins.has(row.processOriginId));
  return {
    sourceRecords: rows.length,
    assignedToTurn: linked.length,
    assignedToProject: valid.length,
    normalized: normalized.length,
    rendered: normalized.length,
    hidden: 0,
    unknown: valid.length - normalized.length,
    invalid: rows.length - valid.length,
  };
}

function changeCoverage(rows) {
  const changes = rows.filter((row) => !row.parseError && row.kind === 'code_change');
  const rendered = changes.filter((row) => row.changed !== false);
  return {
    sourceRecords: rows.length,
    assignedToTurn: 0,
    assignedToProject: changes.length,
    normalized: changes.length,
    rendered: rendered.length,
    hidden: changes.length - rendered.length,
    unknown: 0,
    invalid: rows.filter((row) => row.parseError).length,
    unassigned: changes.length,
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

function readLastLine(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).at(-1) || null;
  } catch {
    return 'Hook error log could not be read.';
  }
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

function watchProject(projectRoot) {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (codexWatcher) {
    codexWatcher.close();
    codexWatcher = null;
  }
  const dir = workbenchPaths(projectRoot).dir;
  fs.mkdirSync(dir, { recursive: true });
  try {
    watcher = fs.watch(dir, { persistent: true }, () => {
      refreshState();
    });
    state.fileBus = {
      status: 'watching',
      directory: dir,
      lastRefreshAt: state.fileBus.lastRefreshAt,
      error: null,
    };
    watcher.on('error', (error) => {
      state.fileBus = {
        status: 'error',
        directory: dir,
        lastRefreshAt: state.fileBus.lastRefreshAt,
        error: error instanceof Error ? error.message : 'File watcher failed',
      };
      publish();
    });
  } catch (error) {
    state.fileBus = {
      status: 'error',
      directory: dir,
      lastRefreshAt: state.fileBus.lastRefreshAt,
      error: error instanceof Error ? error.message : 'Unable to watch project activity',
    };
  }
  codexWatcher = watchCodexProjectSessions({
    projectRoot,
    outFile: workbenchPaths(projectRoot).codexAgentSteps,
    onChange: () => refreshState(),
    onSync: (result) => {
      state.adapters.codex = {
        ...state.adapters.codex,
        status: 'ready',
        sessionCount: result.sessionCount,
        stepCount: result.stepCount,
        lastSyncAt: result.syncedAt,
        error: null,
      };
      publish();
    },
    onError: () => {
      state.adapters.codex = {
        ...state.adapters.codex,
        status: 'error',
        error: '会话同步失败',
      };
      publish();
    },
  });
}

function enableObservation(projectRoot) {
  const result = installProjectObservation({
    projectRoot,
    workbenchHome,
  });
  state.observation = {
    ...readObservation(result.observationPath),
    warnings: result.warnings,
  };
  state.adapters.cursor = {
    ...state.adapters.cursor,
    status: 'ready',
    error: null,
  };
  if (result.warnings.length) {
    state.error = result.warnings.join('; ');
  }
  return result;
}

async function openProject() {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: '选择要观察的项目目录',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) {
    return state;
  }

  const projectRoot = result.filePaths[0];
  try {
    enableObservation(projectRoot);
    state.error = state.observation?.warnings?.length
      ? state.observation.warnings.join('; ')
      : null;
  } catch (error) {
    state.projectRoot = projectRoot;
    state.observation = null;
    state.error =
      error instanceof Error
        ? `观察配置注入失败：${error.message}`
        : '观察配置注入失败';
    watchProject(projectRoot);
    refreshState();
    return state;
  }

  state.projectRoot = projectRoot;
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
      try {
        enableObservation(state.projectRoot);
        state.error = null;
      } catch (error) {
        state.error =
          error instanceof Error
            ? `观察配置刷新失败：${error.message}`
            : '观察配置刷新失败';
      }
    }
    refreshState();
    return state;
  });

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
  if (codexWatcher) {
    codexWatcher.close();
    codexWatcher = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
