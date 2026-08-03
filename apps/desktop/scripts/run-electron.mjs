#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

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

const electronCli = resolveElectronCli();
if (!electronCli) {
  console.error(
    '[desktop] electron is not installed. Run from repo root:\n  pnpm install\n  pnpm --filter @agent-workbench/desktop add -D electron',
  );
  process.exit(1);
}

const child = spawn(process.execPath, [electronCli, appRoot, ...process.argv.slice(2)], {
  cwd: appRoot,
  stdio: 'inherit',
  env: process.env,
  windowsHide: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
