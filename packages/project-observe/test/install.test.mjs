import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  installProjectObservation,
  isWorkbenchManagedHookCommand,
  mergeCursorHooksConfig,
} from '../dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');

test('merge keeps user hooks and replaces previous managed entries', () => {
  const merged = mergeCursorHooksConfig({
    version: 1,
    metadata: { owner: 'user' },
    hooks: {
      preToolUse: [
        { command: 'node tools/mine.mjs', matcher: 'Shell' },
        {
          command: 'node .agent-workbench/cursor-hooks/inject-shell-trace.mjs',
          matcher: 'Shell',
        },
      ],
      postToolUse: [
        { command: 'node .cursor/hooks/record-agent-tool.mjs' },
        { command: 'node .agent-workbench/cursor-hooks/record-agent-tool.mjs' },
      ],
    },
  });

  assert.equal(merged.hooks.preToolUse.length, 2);
  assert.equal(merged.hooks.preToolUse[0].command, 'node tools/mine.mjs');
  assert.ok(
    isWorkbenchManagedHookCommand(merged.hooks.preToolUse[1].command),
  );
  assert.equal(merged.hooks.postToolUse.length, 1);
  assert.ok(isWorkbenchManagedHookCommand('node .cursor/hooks/record-agent-tool.mjs'));
  assert.equal(merged.hooks.postToolUseFailure.length, 1);
  assert.equal(merged.hooks.beforeSubmitPrompt.length, 1);
  assert.equal(merged.hooks.stop.length, 1);
  assert.deepEqual(merged.metadata, { owner: 'user' });
});

test('install writes managed wrappers and merges hooks.json', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-observe-'));
  const cursorDir = path.join(projectRoot, '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });
  fs.writeFileSync(
    path.join(cursorDir, 'hooks.json'),
    JSON.stringify(
      {
        version: 1,
        hooks: {
          preToolUse: [{ command: 'node keep-me.mjs', matcher: 'Write' }],
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const result = installProjectObservation({
    projectRoot,
    workbenchHome: repoRoot,
  });

  assert.equal(result.warnings.length, 0);
  assert.ok(fs.existsSync(result.observationPath));
  assert.ok(
    fs.existsSync(
      path.join(projectRoot, '.agent-workbench/cursor-hooks/record-agent-tool.mjs'),
    ),
  );

  const wrapper = fs.readFileSync(
    path.join(projectRoot, '.agent-workbench/cursor-hooks/record-agent-tool.mjs'),
    'utf8',
  );
  assert.match(wrapper, /AGENT_WORKBENCH_HOME/);
  assert.match(wrapper, /Managed by Agent Workbench/);

  const hooks = JSON.parse(fs.readFileSync(result.hooksConfigPath, 'utf8'));
  assert.equal(hooks.hooks.preToolUse[0].command, 'node keep-me.mjs');
  assert.ok(
    hooks.hooks.preToolUse.some((entry) =>
      isWorkbenchManagedHookCommand(entry.command),
    ),
  );
  assert.ok(
    hooks.hooks.postToolUse.some((entry) =>
      isWorkbenchManagedHookCommand(entry.command),
    ),
  );
  assert.ok(
    hooks.hooks.beforeSubmitPrompt.some((entry) =>
      isWorkbenchManagedHookCommand(entry.command),
    ),
  );
  assert.ok(
    hooks.hooks.stop.some((entry) =>
      isWorkbenchManagedHookCommand(entry.command),
    ),
  );

  const observation = JSON.parse(fs.readFileSync(result.observationPath, 'utf8'));
  assert.equal(observation.workbenchHome, repoRoot);

});

test('custom hook sources are embedded into managed files', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-observe-custom-'));
  const workbenchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-home-custom-'));
  const sourceHooksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hooks-custom-'));
  for (const fileName of [
    'record-agent-tool.mjs',
    'inject-shell-trace.mjs',
    'run-with-trace.mjs',
    'record-code-state.mjs',
  ]) {
    fs.writeFileSync(
      path.join(sourceHooksDir, fileName),
      `#!/usr/bin/env node\nconsole.log('custom:${fileName}');\n`,
      'utf8',
    );
  }

  const result = installProjectObservation({
    projectRoot,
    workbenchHome,
    sourceHooksDir,
  });
  const installed = fs.readFileSync(
    path.join(result.hooksDir, 'inject-shell-trace.mjs'),
    'utf8',
  );
  assert.match(installed, /custom:inject-shell-trace\.mjs/);
});

test('installed hooks fail open after the workbench moves', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-observe-move-'));
  const workbenchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-home-move-'));
  const sourceHooksDir = path.join(workbenchHome, '.cursor', 'hooks');
  fs.mkdirSync(sourceHooksDir, { recursive: true });
  for (const fileName of [
    'record-agent-tool.mjs',
    'inject-shell-trace.mjs',
    'run-with-trace.mjs',
    'record-code-state.mjs',
  ]) {
    fs.copyFileSync(
      path.join(repoRoot, '.cursor', 'hooks', fileName),
      path.join(sourceHooksDir, fileName),
    );
  }
  const result = installProjectObservation({ projectRoot, workbenchHome });
  const movedHome = `${workbenchHome}-moved`;
  fs.renameSync(workbenchHome, movedHome);

  const hook = path.join(result.hooksDir, 'inject-shell-trace.mjs');
  const execution = spawnSync(process.execPath, [hook], {
    cwd: projectRoot,
    input: JSON.stringify({
      tool_name: 'Shell',
      workspace_roots: [projectRoot],
      tool_input: { command: 'node app.js' },
    }),
    encoding: 'utf8',
  });

  assert.equal(execution.status, 0, execution.stderr);
  assert.deepEqual(JSON.parse(execution.stdout), {});
  assert.doesNotMatch(execution.stderr, new RegExp(escapeRegex(workbenchHome)));
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
