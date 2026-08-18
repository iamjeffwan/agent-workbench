import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ProjectFileChange, ProjectFileChangeStatus } from './types.js';

type GitState = {
  repositoryRoot: string;
  branch?: string;
  commit?: string;
  headTree?: string;
  treeHash: string;
  dirty: boolean;
};

export function captureGitState(cwd: string): GitState {
  const repositoryRoot = git(cwd, ['rev-parse', '--show-toplevel']);
  const commit = optionalGit(repositoryRoot, ['rev-parse', '--verify', 'HEAD']);
  const headTree = optionalGit(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{tree}']);
  const branch = optionalGit(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workbench-index-'));
  const temporaryIndex = path.join(temporaryDirectory, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex };

  try {
    if (headTree) {
      git(repositoryRoot, ['read-tree', headTree], env);
    } else {
      git(repositoryRoot, ['read-tree', '--empty'], env);
    }
    git(repositoryRoot, ['add', '-A', '--', '.'], env);
    const treeHash = git(repositoryRoot, ['write-tree'], env);
    return {
      repositoryRoot: path.resolve(repositoryRoot),
      ...(branch ? { branch } : {}),
      ...(commit ? { commit } : {}),
      ...(headTree ? { headTree } : {}),
      treeHash,
      dirty: treeHash !== headTree,
    };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function diffGitTrees(
  repositoryRoot: string,
  beforeTree: string,
  afterTree: string,
): { unifiedDiff: string; filesChanged: ProjectFileChange[] } {
  const unifiedDiff = git(repositoryRoot, [
    'diff', '--binary', '--no-ext-diff', '--find-renames', beforeTree, afterTree, '--',
  ], undefined, true);
  const statusOutput = git(repositoryRoot, [
    'diff', '--name-status', '-z', '--find-renames', beforeTree, afterTree, '--',
  ], undefined, true);
  const filesChanged = parseNameStatus(statusOutput).map(change => ({
    ...change,
    binary: isBinaryChange(repositoryRoot, beforeTree, afterTree, change),
  }));
  return { unifiedDiff, filesChanged };
}

export function listProjectFiles(repositoryRoot: string): string[] {
  const output = git(repositoryRoot, ['ls-files', '-co', '--exclude-standard', '-z'], undefined, true);
  return output.split('\0').filter(Boolean).map(normalizePath).sort();
}

function parseNameStatus(output: string): Array<Omit<ProjectFileChange, 'binary'>> {
  const parts = output.split('\0').filter(Boolean);
  const changes: Array<Omit<ProjectFileChange, 'binary'>> = [];
  for (let index = 0; index < parts.length;) {
    const code = parts[index++];
    const status = statusFor(code[0]);
    if (code[0] === 'R' || code[0] === 'C') {
      const previousPath = parts[index++];
      const currentPath = parts[index++];
      if (previousPath && currentPath) {
        changes.push({
          path: normalizePath(currentPath),
          previousPath: normalizePath(previousPath),
          status,
        });
      }
      continue;
    }
    const currentPath = parts[index++];
    if (currentPath) changes.push({ path: normalizePath(currentPath), status });
  }
  return changes;
}

function statusFor(code: string | undefined): ProjectFileChangeStatus {
  if (code === 'A') return 'added';
  if (code === 'M') return 'modified';
  if (code === 'D') return 'deleted';
  if (code === 'R') return 'renamed';
  if (code === 'C') return 'copied';
  if (code === 'T') return 'type_changed';
  if (code === 'U') return 'unmerged';
  return 'unknown';
}

function isBinaryChange(
  repositoryRoot: string,
  beforeTree: string,
  afterTree: string,
  change: Omit<ProjectFileChange, 'binary'>,
): boolean {
  const paths = change.previousPath && change.previousPath !== change.path
    ? [change.previousPath, change.path]
    : [change.path];
  const output = git(repositoryRoot, [
    'diff', '--numstat', beforeTree, afterTree, '--', ...paths,
  ], undefined, true);
  return output.split(/\r?\n/).some(line => line.startsWith('-\t-\t'));
}

function git(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  preserveTrailingWhitespace = false,
): string {
  try {
    const output = execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return preserveTrailingWhitespace ? output : output.trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Git project observation failed (${args[0]}): ${detail}`, { cause: error });
  }
}

function optionalGit(cwd: string, args: string[]): string | undefined {
  try {
    const value = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/');
}

export type { GitState };
