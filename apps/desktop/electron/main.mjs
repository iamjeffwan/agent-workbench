#!/usr/bin/env node
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installProjectObservation } from '@agent-workbench/project-observe';
import {
  buildTimeline,
  readJsonl,
} from '@agent-workbench/timeline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(__dirname, '../renderer');
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
 *  files: Record<string, string | null>
 * }} */
let state = {
  projectRoot: null,
  turns: [],
  error: null,
  observation: null,
  files: {
    agentSteps: null,
    programRecords: null,
    manifest: null,
  },
};

/** @type {fs.FSWatcher | null} */
let watcher = null;

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
    title: 'Agent Workbench',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(rendererDir, 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function workbenchPaths(projectRoot) {
  const dir = path.join(projectRoot, '.agent-workbench');
  return {
    dir,
    agentSteps: path.join(dir, 'agent-steps.jsonl'),
    programRecords: path.join(dir, 'trace-records.jsonl'),
    manifest: path.join(dir, 'trace-manifest.json'),
    observation: path.join(dir, 'observation.json'),
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
    publish();
    return;
  }

  const paths = workbenchPaths(state.projectRoot);
  state.files = {
    agentSteps: paths.agentSteps,
    programRecords: paths.programRecords,
    manifest: paths.manifest,
  };
  state.observation = readObservation(paths.observation);

  try {
    const agentSteps = readJsonl(paths.agentSteps);
    const programRecords = readJsonl(paths.programRecords);
    const methods = loadMethods(paths.manifest);
    state.turns = buildTimeline(agentSteps, programRecords, methods);
    if (!state.error) {
      state.error = null;
    }
  } catch (error) {
    state.error =
      error instanceof Error ? error.message : 'Failed to build timeline';
    state.turns = [];
  }
  publish();
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
  const dir = workbenchPaths(projectRoot).dir;
  fs.mkdirSync(dir, { recursive: true });
  watcher = fs.watch(dir, { persistent: true }, () => {
    refreshState();
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
