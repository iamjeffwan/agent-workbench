import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildInstallCommand, describeInstallFailure } from './install-dependencies.mjs';
import {
  createRunOwnership,
  matchesProcessIdentity,
  stopProcessTree,
  trashOwnedPath,
} from './local-operation-safety.mjs';

test('ownership registry rejects paths created before the run', () => {
  const ownership = createRunOwnership({ startedAt: 100 });
  assert.equal(ownership.registerCreatedPath('tmp/existing', { createdAt: 99 }).status, 'rejected');
  assert.equal(ownership.isOwned('tmp/existing'), false);
  assert.equal(ownership.registerCreatedPath('tmp/new', { createdAt: 100 }).status, 'registered');
  assert.equal(ownership.isOwned('tmp/new'), true);
});

test('trashOwnedPath only moves registered paths and verifies removal', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operation-safety-'));
  const oldPath = path.join(root, 'old');
  const newPath = path.join(root, 'new');
  fs.mkdirSync(oldPath);
  fs.mkdirSync(newPath);
  const ownership = createRunOwnership({ startedAt: 100 });
  ownership.registerCreatedPath(newPath, { createdAt: 100 });
  const skipped = await trashOwnedPath({ target: oldPath, ownership, trashItem: async target => fs.rmSync(target, { recursive: true }) });
  assert.equal(skipped.status, 'skipped');
  const trashed = await trashOwnedPath({ target: newPath, ownership, trashItem: async target => fs.rmSync(target, { recursive: true }) });
  assert.equal(trashed.status, 'trashed');
  assert.equal(fs.existsSync(newPath), false);
});

test('process termination skips when identity is unavailable or mismatched', () => {
  const child = { pid: 123, exitCode: null, signalCode: null, kill: () => assert.fail('must not signal') };
  assert.equal(stopProcessTree(child, { inspect: () => ({ status: 'unavailable' }) }).status, 'skipped');
  assert.equal(stopProcessTree(child, {
    inspect: () => ({ status: 'ready', pid: 123, parentPid: 1, commandLine: 'other process' }),
    expected: { parentPid: 2, commandLineIncludes: ['pnpm'] },
  }).status, 'skipped');
  assert.equal(matchesProcessIdentity({ status: 'ready', parentPid: 2, commandLine: 'PNPM install' }, { parentPid: 2, commandLineIncludes: ['pnpm'] }), true);
});

test('dependency install defaults to non-interactive frozen lockfile mode', () => {
  const command = buildInstallCommand();
  assert.equal(command.args.includes('install'), true);
  assert.equal(command.args.includes('--frozen-lockfile'), true);
  if (process.platform === 'win32') assert.equal(command.executable.toLowerCase().endsWith('node.exe'), true);
  else assert.equal(command.executable, 'pnpm');
  const offline = buildInstallCommand({ updateLockfile: true, offline: true });
  assert.deepEqual(offline.args.slice(-2), ['install', '--offline']);
  assert.match(describeInstallFailure({ code: 1, stderr: 'ERR_PNPM_OUTDATED_LOCKFILE' }), /锁文件/);
  assert.match(describeInstallFailure({ timedOut: true }), /超时/);
});
