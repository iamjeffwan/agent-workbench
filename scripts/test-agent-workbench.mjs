#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const packages = [
  { name: 'security', root: 'packages/agent-workbench-security', build: false },
  { name: 'timeline', root: 'packages/timeline', build: true },
  { name: 'codex-adapter', root: 'packages/codex-adapter', build: true },
  { name: 'desktop', root: 'apps/desktop', build: true, vite: true },
];

for (const item of packages) {
  const packageRoot = path.join(repoRoot, item.root);
  console.log(`\n[agent-workbench] ${item.name}`);

  if (item.build) {
    const localTsc = path.join(packageRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    const rootTsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    const compiler = fs.existsSync(localTsc) ? localTsc : rootTsc;
    run(process.execPath, [compiler, '-p', path.join(packageRoot, 'tsconfig.json')], repoRoot);
  }

  if (item.vite) {
    const localVite = path.join(packageRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    const rootVite = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    const vite = fs.existsSync(localVite) ? localVite : rootVite;
    run(process.execPath, [vite, 'build'], packageRoot);
  }

  run(
    process.execPath,
    item.name === 'desktop'
      ? ['--experimental-strip-types', '--test', 'test/*.test.mjs']
      : ['--test', 'test/*.test.mjs'],
    packageRoot,
  );
}

console.log('\n[agent-workbench] all tests passed');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
