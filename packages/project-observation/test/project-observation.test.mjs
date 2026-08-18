import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  captureProjectState,
  deriveProjectTurnFacts,
  projectContextFromObservation,
} from '../dist/index.js';

test('derives a turn-only diff without attributing pre-existing dirty changes', t => {
  const repositoryRoot = createRepository();
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  write(repositoryRoot, 'alpha.txt', 'committed base\n');
  write(repositoryRoot, 'old-name.txt', 'rename me with enough stable content\n');
  write(repositoryRoot, 'deleted.txt', 'delete me\n');
  writeBinary(repositoryRoot, 'binary.bin', [0, 1, 2, 3]);
  commitAll(repositoryRoot, 'initial');

  write(repositoryRoot, 'alpha.txt', 'dirty before turn\n');
  const context = {
    projectId: 'project-demo',
    sessionId: 'session-demo',
    turnId: 'turn-0001',
    cwd: repositoryRoot,
  };
  const before = captureProjectState(context, new Date('2026-08-18T08:00:00.000Z'));

  write(repositoryRoot, 'alpha.txt', 'changed during turn\n');
  fs.renameSync(
    path.join(repositoryRoot, 'old-name.txt'),
    path.join(repositoryRoot, 'new-name.txt'),
  );
  fs.rmSync(path.join(repositoryRoot, 'deleted.txt'));
  write(repositoryRoot, 'added.txt', 'added during turn\n');
  writeBinary(repositoryRoot, 'binary.bin', [0, 9, 8, 7]);
  const after = captureProjectState(context, new Date('2026-08-18T08:01:00.000Z'));
  const facts = deriveProjectTurnFacts(
    context,
    before,
    after,
    new Date('2026-08-18T08:01:01.000Z'),
  );

  assert.equal(facts.turnDiff.baseRef, before.snapshot.git.treeHash);
  assert.equal(facts.turnDiff.resultRef, after.snapshot.git.treeHash);
  assert.match(facts.turnDiff.unifiedDiff, /-dirty before turn/);
  assert.match(facts.turnDiff.unifiedDiff, /\+changed during turn/);
  assert.doesNotMatch(facts.turnDiff.unifiedDiff, /-committed base/);
  assert.deepEqual(
    facts.turnDiff.filesChanged.map(change => [
      change.path,
      change.previousPath ?? null,
      change.status,
      change.binary,
    ]),
    [
      ['added.txt', null, 'added', false],
      ['alpha.txt', null, 'modified', false],
      ['binary.bin', null, 'modified', true],
      ['deleted.txt', null, 'deleted', false],
      ['new-name.txt', 'old-name.txt', 'renamed', false],
    ],
  );
});

test('captures project profile and reports meaningful environment changes', t => {
  const repositoryRoot = createRepository();
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  writeJson(repositoryRoot, 'package.json', {
    scripts: { test: 'node --test' },
    dependencies: { zod: '^4.0.0' },
  });
  write(repositoryRoot, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  writeJson(repositoryRoot, 'tsconfig.json', { compilerOptions: { strict: true } });
  commitAll(repositoryRoot, 'initial environment');

  const context = {
    projectId: 'project-environment',
    sessionId: 'session-environment',
    turnId: 'turn-environment',
    cwd: repositoryRoot,
  };
  const before = captureProjectState(context, new Date('2026-08-18T09:00:00.000Z'));
  git(repositoryRoot, ['checkout', '-b', 'feature/environment']);
  writeJson(repositoryRoot, 'package.json', {
    scripts: { test: 'node --test', typecheck: 'tsc --noEmit' },
    dependencies: { zod: '^4.0.0', diff: '^8.0.0' },
  });
  write(repositoryRoot, 'AGENTS.md', '# Repository guidance\n');
  write(repositoryRoot, '.agents/skills/demo/SKILL.md', '# Demo skill\n');
  writeJson(repositoryRoot, '.mcp.json', { mcpServers: {} });
  const after = captureProjectState(context, new Date('2026-08-18T09:01:00.000Z'));
  const { environmentDelta } = deriveProjectTurnFacts(context, before, after);
  const kinds = environmentDelta.changes.map(change => change.kind);

  assert.deepEqual(before.profile.technologyStack, ['Node.js', 'TypeScript']);
  assert.deepEqual(before.profile.packageManagers, ['pnpm']);
  assert.ok(before.profile.keyDependencies.includes('zod@^4.0.0'));
  assert.ok(after.profile.keyDependencies.includes('diff@^8.0.0'));
  assert.ok(after.profile.ruleFiles.includes('AGENTS.md'));
  assert.ok(after.profile.skillFiles.includes('.agents/skills/demo/SKILL.md'));
  assert.ok(after.profile.mcpFiles.includes('.mcp.json'));
  assert.ok(kinds.includes('git_branch'));
  assert.ok(kinds.includes('dependency'));
  assert.ok(kinds.includes('command'));
  assert.ok(kinds.includes('configuration'));
  assert.ok(kinds.includes('project_rule'));
  assert.ok(kinds.includes('skill'));
  assert.ok(kinds.includes('mcp'));
});

test('takes project, session, turn and cwd only from the canonical observation', t => {
  const repositoryRoot = createRepository();
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  write(repositoryRoot, 'README.md', 'canonical context\n');
  commitAll(repositoryRoot, 'canonical context');
  const nestedCwd = path.join(repositoryRoot, 'packages', 'app');
  fs.mkdirSync(nestedCwd, { recursive: true });

  const observation = {
    schemaVersion: '1.0-draft',
    session: {
      sessionId: 'session-from-adapter',
      projectId: 'project-from-workbench',
      sourceAgent: 'codex',
      sourceVersion: '0.148.0-alpha.15',
      adapterVersion: '0.1.0',
      cwd: repositoryRoot,
      rawRef: { sourceFile: 'redacted.jsonl', line: 1, sourceType: 'session_meta' },
    },
    turns: [{
      turnId: 'turn-from-adapter',
      sequence: 0,
      cwd: nestedCwd,
      sourceRef: { sourceFile: 'redacted.jsonl', line: 2, sourceType: 'turn_context' },
      events: [],
    }],
    capabilityManifest: { agent: 'codex', capabilities: {} },
    diagnostics: {
      unknownSourceEventCount: 0,
      parseErrorCount: 0,
      lossyEventCount: 0,
      unsupportedFieldCount: 0,
      entries: [],
    },
  };

  const context = projectContextFromObservation(observation, 'turn-from-adapter');
  const capture = captureProjectState(context);

  assert.deepEqual(context, {
    projectId: 'project-from-workbench',
    sessionId: 'session-from-adapter',
    turnId: 'turn-from-adapter',
    cwd: nestedCwd,
  });
  assert.equal(capture.repositoryRoot, repositoryRoot);
  assert.equal(capture.snapshot.projectId, 'project-from-workbench');
  assert.equal(capture.snapshot.sessionId, 'session-from-adapter');
});

function createRepository() {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-observation-'));
  git(repositoryRoot, ['init', '--initial-branch=main']);
  git(repositoryRoot, ['config', 'user.email', 'project-observation@example.invalid']);
  git(repositoryRoot, ['config', 'user.name', 'Project Observation Test']);
  return repositoryRoot;
}

function commitAll(repositoryRoot, message) {
  git(repositoryRoot, ['add', '-A']);
  git(repositoryRoot, ['commit', '-m', message]);
}

function git(repositoryRoot, args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

function write(repositoryRoot, relativePath, content) {
  const file = path.join(repositoryRoot, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function writeBinary(repositoryRoot, relativePath, bytes) {
  const file = path.join(repositoryRoot, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(bytes));
}

function writeJson(repositoryRoot, relativePath, value) {
  write(repositoryRoot, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}
