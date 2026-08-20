import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  enrichReviewEvidencePackageFromProject,
  validateReviewEvidencePackage,
} from '../dist/index.js';

test('adds bounded changed, test, rule, dependency, and diff evidence from a working tree', async () => {
  const root = await repositoryFixture();
  await writeFile(path.join(root, 'src/parser.ts'), 'export const parse = () => "new";\nconst apiKey = "sk-1234567890abcdefghijkl";\n');
  await writeFile(path.join(root, '.env'), 'API_KEY=do-not-read\n');
  await mkdir(path.join(root, '.review-runs'));
  await writeFile(path.join(root, '.review-runs/result.json'), '{"result":"recursive"}\n');

  const result = await enrichReviewEvidencePackageFromProject({
    evidencePackage: evidencePackage(),
    repositoryRoot: root,
  });

  assert.equal(result.reviewability, 'sufficient');
  assert.equal(result.projectContext.scope, 'working_tree');
  assert.match(result.projectContext.diff.content, /parser\.ts/);
  assert.deepEqual(
    result.projectContext.files.map(file => file.path),
    ['src/parser.ts', 'test/parser.test.mjs', 'AGENTS.md', 'package.json'],
  );
  assert.deepEqual(result.projectContext.files[0].roles, ['changed']);
  assert.ok(!JSON.stringify(result.projectContext).includes('sk-1234567890abcdefghijkl'));
  assert.ok(!JSON.stringify(result.projectContext).includes('do-not-read'));
  assert.ok(!JSON.stringify(result.projectContext).includes('recursive'));
  assert.ok(result.projectContext.omissions.some(item => item.path === '.env' && item.reason === 'sensitive_file'));
  assert.equal(validateReviewEvidencePackage(result).valid, true);
});

test('reads an explicit revision without mixing in later working tree content', async () => {
  const root = await repositoryFixture();
  const revision = git(root, ['rev-parse', 'HEAD']).trim();
  await writeFile(path.join(root, 'src/parser.ts'), 'export const parse = () => "working tree";\n');

  const result = await enrichReviewEvidencePackageFromProject({
    evidencePackage: evidencePackageWithObservedFile(),
    repositoryRoot: root,
    revision,
  });

  assert.equal(result.projectContext.scope, 'revision');
  assert.equal(result.projectContext.revision, revision);
  assert.match(result.projectContext.files.find(file => file.path === 'src/parser.ts').content, /old/);
  assert.ok(!JSON.stringify(result.projectContext).includes('working tree'));
});

test('records truncation and rejects unsafe limits or a nested project path', async () => {
  const root = await repositoryFixture();
  await writeFile(path.join(root, 'src/parser.ts'), `export const text = "${'x'.repeat(200)}";\n`);
  const result = await enrichReviewEvidencePackageFromProject({
    evidencePackage: evidencePackage(),
    repositoryRoot: root,
    limits: { maxFiles: 1, maxFileChars: 20, maxTotalFileChars: 20, maxDiffChars: 20 },
  });

  assert.equal(result.projectContext.files.length, 1);
  assert.equal(result.projectContext.files[0].truncated, true);
  assert.equal(result.projectContext.diff.truncated, true);
  assert.ok(result.projectContext.omissions.some(item => item.reason === 'file_limit'));
  await assert.rejects(() => enrichReviewEvidencePackageFromProject({
    evidencePackage: evidencePackage(), repositoryRoot: root, limits: { maxFiles: 0 },
  }), /positive integer/);
  await assert.rejects(() => enrichReviewEvidencePackageFromProject({
    evidencePackage: evidencePackage(), repositoryRoot: path.join(root, 'src'),
  }), /repository root/);
});

async function repositoryFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-project-context-'));
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'test'));
  await writeFile(path.join(root, 'src/parser.ts'), 'export const parse = () => "old";\n');
  await writeFile(path.join(root, 'test/parser.test.mjs'), 'test("parser", () => {});\n');
  await writeFile(path.join(root, 'AGENTS.md'), '# Project rules\n');
  await writeFile(path.join(root, 'package.json'), '{"scripts":{"test":"node --test"}}\n');
  await writeFile(path.join(root, '.env'), 'API_KEY=committed-fixture-value\n');
  git(root, ['init']);
  git(root, ['config', 'user.email', 'review@example.test']);
  git(root, ['config', 'user.name', 'Review Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fixture']);
  return root;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function evidencePackage() {
  return {
    schemaVersion: '1.0-draft',
    evidenceSchemaVersion: 'review-evidence-1',
    caseId: 'case-context',
    projectId: 'project-1',
    builtAt: '2026-08-19T06:00:00.000Z',
    reviewability: 'needs_project_context',
    gaps: [{
      code: 'project_observation_unavailable',
      sessionId: 'session-1',
      turnId: 'turn-1',
      description: 'Project observation unavailable.',
    }],
    turns: [{
      sessionId: 'session-1',
      turnId: 'turn-1',
      sequence: 0,
      status: 'completed',
      userInput: 'Add a parser.',
      events: [],
      source: {
        agent: 'codex',
        sourceVersion: '1.0.0',
        adapterVersion: '0.1.0',
        capabilityManifest: { agent: 'codex', capabilities: {} },
      },
    }],
  };
}

function evidencePackageWithObservedFile() {
  const result = evidencePackage();
  result.reviewability = 'sufficient';
  result.gaps = [];
  result.turns[0].projectContext = {
    turnDiff: {
      diffId: 'diff-1', projectId: 'project-1', sessionId: 'session-1', turnId: 'turn-1',
      builderVersion: '0.1.0', baseRef: 'base', resultRef: 'result',
      filesChanged: [{ path: 'src/parser.ts', status: 'modified', binary: false }],
      unifiedDiff: '', generatedAt: '2026-08-19T06:00:00.000Z', contentHash: 'hash', isCurrent: true,
    },
    projectProfile: {
      profileId: 'profile-1', projectId: 'project-1', version: '1', generatedAt: '2026-08-19T06:00:00.000Z',
      technologyStack: [], packageManagers: [], keyDependencies: [], commands: [], ruleFiles: ['AGENTS.md'],
      skillFiles: [], mcpFiles: [], sourceFiles: ['package.json'],
      fingerprints: { configuration: 'a', rules: 'b', skills: 'c', mcp: 'd' },
    },
    environmentSnapshot: {
      snapshotId: 'snapshot-1', projectId: 'project-1', sessionId: 'session-1', generatorVersion: '1',
      capturedAt: '2026-08-19T06:00:00.000Z', projectProfileVersion: '1',
      git: { treeHash: 'tree', dirty: false }, runtime: { os: 'win32', arch: 'x64', nodeVersion: '22' },
    },
    environmentDelta: null,
  };
  return result;
}
