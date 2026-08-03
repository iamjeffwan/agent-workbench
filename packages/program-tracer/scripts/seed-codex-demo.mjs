#!/usr/bin/env node
/**
 * Seed a verification demo against a local Beside checkout:
 * 1) Parse fixture Codex rollout → agent-steps.jsonl
 * 2) Run summarize under observe-run with matching process origin id
 *
 * Requires BESIDE_ROOT (defaults to ../Beside next to this repo).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { redactCredentialText } from '../../agent-workbench-security/index.mjs';
import { spawnDirect, spawnShellCommand } from './process-launch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const besideRoot = process.env.BESIDE_ROOT
  ? path.resolve(process.env.BESIDE_ROOT)
  : path.resolve(repoRoot, '../Beside');
const workerAw = path.join(besideRoot, 'apps/worker/.agent-workbench');
const originId = 'call_demo_summarize_1';

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      cwd: repoRoot,
      stdio: 'inherit',
      ...opts,
    };
    const child =
      process.platform === 'win32' && command.toLowerCase() === 'pnpm'
        ? spawnShellCommand(formatShellCommand(command, args), options)
        : spawnDirect(command, args, options);
    child.once('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

function formatShellCommand(command, args) {
  return [command, ...args].map(quoteShellArgument).join(' ');
}

function quoteShellArgument(value) {
  const text = String(value);
  if (process.platform === 'win32') {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return `'${text.replaceAll("'", "'\\''")}'`;
}

async function main() {
  if (!fs.existsSync(path.join(besideRoot, 'apps/worker'))) {
    throw new Error(
      `Beside worker not found at ${besideRoot}. Set BESIDE_ROOT to your Beside checkout.`,
    );
  }

  fs.mkdirSync(workerAw, { recursive: true });

  await run('pnpm', ['--filter', '@agent-workbench/codex-adapter', 'build']);
  await run('pnpm', ['--filter', '@agent-workbench/program-tracer', 'build']);
  await run('node', [
    'packages/program-tracer/dist/host/cli.js',
    path.join(besideRoot, 'apps/worker'),
    '--out',
    path.join(workerAw, 'trace-manifest.json'),
  ]);
  await run('pnpm', ['--filter', '@beside/worker', 'build'], { cwd: besideRoot });

  await run('node', [
    'packages/codex-adapter/dist/cli.js',
    '--session',
    'packages/codex-adapter/fixtures/sample-rollout.jsonl',
    '--out',
    path.join(workerAw, 'agent-steps.jsonl'),
  ]);

  const recordsPath = path.join(workerAw, 'trace-records.jsonl');
  if (fs.existsSync(recordsPath)) {
    fs.unlinkSync(recordsPath);
  }

  await run('node', [
    'packages/program-tracer/scripts/observe-run.mjs',
    '--origin',
    originId,
    '--manifest',
    path.join(workerAw, 'trace-manifest.json'),
    '--out',
    recordsPath,
    '--',
    'node',
    'packages/program-tracer/scripts/dogfood-worker-summarize.cjs',
  ]);

  console.log(`
Demo ready.
  agent-steps: ${path.join(workerAw, 'agent-steps.jsonl')}
  records:     ${recordsPath}
  origin:      ${originId}

Open desktop:
  pnpm desktop
`);
}

main().catch((error) => {
  console.error(
    redactCredentialText(error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
});
