#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { stopProcessTree } from '../../../scripts/local-operation-safety.mjs';

// Windows taskkill ['/T', '/F'] is delegated to the safety module after identity checks.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const require = createRequire(path.join(appRoot, 'package.json'));

function resolveElectronCli() {
  try {
    return require.resolve('electron/cli.js');
  } catch {
    // fall through
  }

  const candidates = [
    path.join(appRoot, 'node_modules', 'electron', 'cli.js'),
    path.join(appRoot, '../../node_modules', 'electron', 'cli.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveViteCli() {
  try {
    return require.resolve('vite/bin/vite.js');
  } catch {
    const candidate = path.join(appRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    return fs.existsSync(candidate) ? candidate : null;
  }
}

const electronCli = resolveElectronCli();
if (!electronCli) {
  console.error(
    '[desktop] electron is not installed. Run from repo root:\n  pnpm install\n  pnpm --filter @agent-workbench/desktop add -D electron',
  );
  process.exit(1);
}

const development = process.argv.includes('--dev');
const uiPreview = process.argv.includes('--ui-preview');
const forwardedArguments = process.argv.slice(2).filter(
  (argument) => argument !== '--dev' && argument !== '--ui-preview',
);

let activeVite = null;
let activeElectron = null;
let activeViteExpectation = null;
let activeElectronExpectation = null;
let shuttingDown = false;

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

if (development) {
  await runDevelopment();
} else {
  runElectron({
    ...process.env,
    ...(uiPreview ? { AGENT_WORKBENCH_RENDERER_MODE: 'workbench-preview' } : {}),
  });
}

async function runDevelopment() {
  const viteCli = resolveViteCli();
  if (!viteCli) {
    console.error('[desktop] vite is not installed. Run pnpm install from the repository root.');
    process.exit(1);
  }

  const vite = spawn(
    process.execPath,
    [viteCli, '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
    {
      cwd: appRoot,
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
    },
  );

  activeVite = vite;
  activeViteExpectation = {
    parentPid: process.pid,
    commandLineIncludes: [viteCli],
  };

  vite.once('exit', (code) => {
    if (activeVite === vite) activeVite = null;
    if (!shuttingDown && code !== 0) shutdown(code ?? 1);
  });

  try {
    await waitForRenderer('http://127.0.0.1:5173');
  } catch (error) {
    console.error(`[desktop] ${error instanceof Error ? error.message : String(error)}`);
    shutdown(1);
  }

  runElectron({
    ...process.env,
    AGENT_WORKBENCH_RENDERER_URL: uiPreview
      ? 'http://127.0.0.1:5173/?mode=workbench-preview'
      : 'http://127.0.0.1:5173',
  });
}

function runElectron(environment) {
  const child = spawn(
    process.execPath,
    [electronCli, appRoot, ...forwardedArguments],
    {
      cwd: appRoot,
      stdio: 'inherit',
      env: environment,
      windowsHide: false,
    },
  );

  activeElectron = child;
  activeElectronExpectation = {
    parentPid: process.pid,
    commandLineIncludes: [appRoot],
  };

  child.on('exit', (code, signal) => {
    if (activeElectron === child) activeElectron = null;
    if (shuttingDown) return;
    shuttingDown = true;
    reportStop(stopProcessTree(activeVite, { expected: activeViteExpectation }));
    process.exit(signal ? 1 : code ?? 1);
  });
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  reportStop(stopProcessTree(activeElectron, { expected: activeElectronExpectation }));
  reportStop(stopProcessTree(activeVite, { expected: activeViteExpectation }));
  process.exit(code);
}

function reportStop(result) {
  if (result.status === 'skipped' && result.reason !== 'process-already-exited') {
    console.error(`[desktop] skipped child termination: ${result.reason}`);
  }
}

async function waitForRenderer(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The renderer development server did not start within 15 seconds.');
}
