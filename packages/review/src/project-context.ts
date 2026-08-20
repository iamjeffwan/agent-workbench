import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { redactCredentialText } from '@agent-workbench/security';

import type { ReviewEvidencePackage } from './evidence.js';

const execFile = promisify(execFileCallback);

const DEFAULT_LIMITS: ReviewProjectContextLimits = {
  maxFiles: 24,
  maxFileChars: 16_000,
  maxTotalFileChars: 96_000,
  maxDiffChars: 48_000,
};

const DEPENDENCY_FILES = new Set([
  'package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
  'pyproject.toml', 'requirements.txt', 'cargo.toml', 'go.mod',
]);
const RULE_FILES = new Set(['agents.md', 'claude.md', 'codex.md']);
const SENSITIVE_BASENAMES = new Set([
  '.npmrc', '.pypirc', '.netrc', 'id_rsa', 'id_ed25519',
]);
const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.review-runs', '.cache', 'node_modules', 'dist', 'build', 'coverage', 'target',
]);

export type ReviewProjectContextLimits = {
  maxFiles: number;
  maxFileChars: number;
  maxTotalFileChars: number;
  maxDiffChars: number;
};

export type ReviewProjectFileRole = 'changed' | 'test' | 'rule' | 'dependency' | 'source';

export type ReviewProjectFile = {
  path: string;
  roles: ReviewProjectFileRole[];
  content: string;
  contentHash: string;
  truncated: boolean;
};

export type ReviewProjectDiff = {
  targetId: string;
  content: string;
  contentHash: string;
  truncated: boolean;
};

export type ReviewProjectContextOmissionReason =
  | 'sensitive_file'
  | 'binary_file'
  | 'unavailable'
  | 'file_limit'
  | 'total_limit';

export type ReviewProjectContextOmission = {
  path?: string;
  reason: ReviewProjectContextOmissionReason;
  description: string;
};

export type ReviewProjectContext = {
  contextSchemaVersion: 'review-project-context-1';
  scope: 'working_tree' | 'revision';
  revision?: string;
  diff: ReviewProjectDiff | null;
  files: ReviewProjectFile[];
  omissions: ReviewProjectContextOmission[];
  limits: ReviewProjectContextLimits;
};

export type EnrichReviewEvidencePackageInput = {
  evidencePackage: ReviewEvidencePackage;
  repositoryRoot: string;
  revision?: string;
  limits?: Partial<ReviewProjectContextLimits>;
};

export async function enrichReviewEvidencePackageFromProject(
  input: EnrichReviewEvidencePackageInput,
): Promise<ReviewEvidencePackage> {
  const repositoryRoot = await resolveRepositoryRoot(input.repositoryRoot);
  const limits = validateLimits({ ...DEFAULT_LIMITS, ...input.limits });
  const revision = input.revision?.trim() || undefined;
  if (revision) await git(repositoryRoot, ['rev-parse', '--verify', `${revision}^{commit}`]);

  const projectFiles = await listProjectFiles(repositoryRoot, revision);
  const roles = await candidateRoles(input.evidencePackage, repositoryRoot, projectFiles, revision);
  const diffPaths = await candidateDiffPaths(input.evidencePackage, repositoryRoot, revision);
  const omissions: ReviewProjectContextOmission[] = [];
  const files = await readCandidates(repositoryRoot, revision, roles, limits, omissions);
  const diff = await collectDiff(input.evidencePackage, repositoryRoot, revision, diffPaths, limits.maxDiffChars);
  const projectContext: ReviewProjectContext = {
    contextSchemaVersion: 'review-project-context-1',
    scope: revision ? 'revision' : 'working_tree',
    ...(revision ? { revision } : {}),
    diff,
    files,
    omissions,
    limits,
  };

  const evidencePackage = structuredClone(input.evidencePackage);
  evidencePackage.projectContext = projectContext;
  const hasChangeEvidence = Boolean(diff) || files.some(file => file.roles.includes('changed'));
  if (evidencePackage.reviewability === 'needs_project_context' && hasChangeEvidence) {
    evidencePackage.reviewability = 'sufficient';
  }
  return evidencePackage;
}

async function candidateRoles(
  evidencePackage: ReviewEvidencePackage,
  repositoryRoot: string,
  projectFiles: string[],
  revision: string | undefined,
): Promise<Map<string, Set<ReviewProjectFileRole>>> {
  const roles = new Map<string, Set<ReviewProjectFileRole>>();
  const add = (file: string, role: ReviewProjectFileRole) => {
    const normalized = normalizeRelativePath(file);
    if (!normalized || isExcludedPath(normalized) || !projectFiles.includes(normalized)) return;
    const existing = roles.get(normalized) ?? new Set<ReviewProjectFileRole>();
    existing.add(role);
    roles.set(normalized, existing);
  };

  for (const turn of evidencePackage.turns) {
    const context = turn.projectContext;
    if (!context) continue;
    for (const changed of context.turnDiff.filesChanged) add(changed.path, 'changed');
    for (const file of context.projectProfile.ruleFiles) add(file, 'rule');
    for (const file of context.projectProfile.sourceFiles) add(file, 'source');
    for (const file of [...context.projectProfile.skillFiles, ...context.projectProfile.mcpFiles]) {
      add(file, 'rule');
    }
  }

  if (![...roles.values()].some(value => value.has('changed'))) {
    for (const file of await changedProjectFiles(repositoryRoot, revision)) add(file, 'changed');
  }
  for (const file of projectFiles) {
    const basename = path.posix.basename(file).toLowerCase();
    if (RULE_FILES.has(basename)) add(file, 'rule');
    if (DEPENDENCY_FILES.has(basename)) add(file, 'dependency');
  }

  const changedStems = [...roles.entries()]
    .filter(([, value]) => value.has('changed'))
    .map(([file]) => sourceStem(file));
  for (const file of projectFiles) {
    if (isTestFile(file) && changedStems.some(stem => testMatchesStem(file, stem))) add(file, 'test');
  }
  return roles;
}

async function readCandidates(
  repositoryRoot: string,
  revision: string | undefined,
  candidates: Map<string, Set<ReviewProjectFileRole>>,
  limits: ReviewProjectContextLimits,
  omissions: ReviewProjectContextOmission[],
): Promise<ReviewProjectFile[]> {
  const ordered = [...candidates.entries()].sort(([leftPath, leftRoles], [rightPath, rightRoles]) => (
    roleScore(rightRoles) - roleScore(leftRoles) || leftPath.localeCompare(rightPath)
  ));
  const readable = ordered.filter(([relativePath]) => {
    if (!isSensitivePath(relativePath)) return true;
    omissions.push({ path: relativePath, reason: 'sensitive_file', description: 'Sensitive file was excluded.' });
    return false;
  });
  if (readable.length > limits.maxFiles) {
    omissions.push({
      reason: 'file_limit',
      description: `${readable.length - limits.maxFiles} candidate files were omitted by the file count limit.`,
    });
  }

  const result: ReviewProjectFile[] = [];
  let totalChars = 0;
  for (const [relativePath, roles] of readable.slice(0, limits.maxFiles)) {
    let bytes: Buffer;
    try {
      bytes = revision
        ? Buffer.from(await git(repositoryRoot, ['show', `${revision}:${relativePath}`], true), 'utf8')
        : await readSafeFile(repositoryRoot, relativePath);
    } catch {
      omissions.push({ path: relativePath, reason: 'unavailable', description: 'File content is unavailable.' });
      continue;
    }
    if (bytes.includes(0)) {
      omissions.push({ path: relativePath, reason: 'binary_file', description: 'Binary file content was excluded.' });
      continue;
    }
    if (totalChars >= limits.maxTotalFileChars) {
      omissions.push({ reason: 'total_limit', description: 'Remaining files were omitted by the total content limit.' });
      break;
    }
    const redacted = redactCredentialText(bytes.toString('utf8'), { context: 'source' });
    const allowed = Math.min(limits.maxFileChars, limits.maxTotalFileChars - totalChars);
    const content = redacted.slice(0, allowed);
    result.push({
      path: relativePath,
      roles: orderedRoles(roles),
      content,
      contentHash: hash(redacted),
      truncated: content.length < redacted.length,
    });
    totalChars += content.length;
  }
  return result;
}

async function collectDiff(
  evidencePackage: ReviewEvidencePackage,
  repositoryRoot: string,
  revision: string | undefined,
  paths: string[],
  maxChars: number,
): Promise<ReviewProjectDiff | null> {
  if (paths.length === 0) return null;
  const observed = evidencePackage.turns
    .map(turn => turn.projectContext?.turnDiff.unifiedDiff)
    .filter((value): value is string => Boolean(value));
  let raw: string;
  if (observed.length > 0) {
    raw = filterDiffByPaths(observed.join('\n'), paths);
  } else if (revision) {
    const parent = await firstParentRevision(repositoryRoot, revision);
    raw = parent
      ? await git(repositoryRoot, ['diff', '--no-ext-diff', '--unified=3', parent, revision, '--', ...paths], true)
      : '';
  } else {
    raw = await git(repositoryRoot, ['diff', '--no-ext-diff', '--unified=3', 'HEAD', '--', ...paths], true);
  }
  if (!raw) return null;
  const redacted = redactCredentialText(raw, { context: 'source' });
  return {
    targetId: observed.length > 0 ? 'observed-turn-diff' : 'working-tree-diff',
    content: redacted.slice(0, maxChars),
    contentHash: hash(redacted),
    truncated: redacted.length > maxChars,
  };
}

async function candidateDiffPaths(
  evidencePackage: ReviewEvidencePackage,
  repositoryRoot: string,
  revision: string | undefined,
): Promise<string[]> {
  const observed = evidencePackage.turns.flatMap(turn => (
    turn.projectContext?.turnDiff.filesChanged.flatMap(file => [file.path, ...(file.previousPath ? [file.previousPath] : [])]) ?? []
  ));
  const candidates = observed.length > 0 ? observed : await changedProjectFiles(repositoryRoot, revision);
  return [...new Set(candidates.map(normalizeRelativePath))]
    .filter(file => Boolean(file) && !isExcludedPath(file) && !isSensitivePath(file))
    .sort()
    .slice(0, 200);
}

function filterDiffByPaths(diff: string, paths: string[]): string {
  const allowed = new Set(paths);
  return diff.split(/(?=^diff --git )/m).filter(section => {
    const header = section.split(/\r?\n/, 1)[0] ?? '';
    if (!header.startsWith('diff --git ')) return false;
    return [...allowed].some(file => header.includes(`a/${file}`) || header.includes(`b/${file}`));
  }).join('');
}

async function resolveRepositoryRoot(inputPath: string): Promise<string> {
  const requested = path.resolve(inputPath);
  const root = path.resolve((await git(requested, ['rev-parse', '--show-toplevel'])).trim());
  if (path.relative(root, requested) !== '') throw new TypeError('Project context path must be the repository root.');
  return root;
}

async function listProjectFiles(repositoryRoot: string, revision: string | undefined): Promise<string[]> {
  const output = revision
    ? await git(repositoryRoot, ['ls-tree', '-r', '--name-only', '-z', revision], true)
    : await git(repositoryRoot, ['ls-files', '-co', '--exclude-standard', '-z'], true);
  return output.split('\0')
    .filter(Boolean)
    .map(normalizeRelativePath)
    .filter(file => Boolean(file) && !isExcludedPath(file))
    .sort();
}

async function changedProjectFiles(repositoryRoot: string, revision: string | undefined): Promise<string[]> {
  if (revision) {
    const parent = await firstParentRevision(repositoryRoot, revision);
    if (!parent) return listProjectFiles(repositoryRoot, revision);
    const changed = await git(repositoryRoot, ['diff', '--name-only', '-z', parent, revision, '--'], true);
    return changed.split('\0')
      .filter(Boolean)
      .map(normalizeRelativePath)
      .filter(file => Boolean(file) && !isExcludedPath(file));
  }
  const [changed, untracked] = await Promise.all([
    git(repositoryRoot, ['diff', '--name-only', '-z', 'HEAD', '--'], true),
    git(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z'], true),
  ]);
  return `${changed}\0${untracked}`.split('\0')
    .filter(Boolean)
    .map(normalizeRelativePath)
    .filter(file => Boolean(file) && !isExcludedPath(file));
}

async function firstParentRevision(repositoryRoot: string, revision: string): Promise<string | undefined> {
  const parents = (await git(repositoryRoot, ['show', '-s', '--format=%P', revision]))
    .split(/\s+/)
    .filter(Boolean);
  return parents[0];
}

async function readSafeFile(repositoryRoot: string, relativePath: string): Promise<Buffer> {
  const absolute = path.resolve(repositoryRoot, ...relativePath.split('/'));
  const relative = path.relative(repositoryRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TypeError('Project context file must stay within the repository.');
  }
  return readFile(absolute);
}

async function git(cwd: string, args: string[], preserveWhitespace = false): Promise<string> {
  try {
    const { stdout } = await execFile('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return preserveWhitespace ? stdout : stdout.trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Git project context read failed (${args[0]}): ${detail}`, { cause: error });
  }
}

function validateLimits(limits: ReviewProjectContextLimits): ReviewProjectContextLimits {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`Project context limit must be a positive integer: ${name}`);
  }
  return limits;
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) return '';
  return normalized;
}

function isSensitivePath(value: string): boolean {
  const basename = path.posix.basename(value).toLowerCase();
  return basename === '.env'
    || basename.startsWith('.env.')
    || SENSITIVE_BASENAMES.has(basename)
    || /\.(?:pem|key|p12|pfx)$/i.test(basename);
}

function isExcludedPath(value: string): boolean {
  const segments = value.toLowerCase().split('/');
  return segments.some(segment => EXCLUDED_DIRECTORIES.has(segment))
    || segments[0]?.startsWith('.tmp') === true;
}

function isTestFile(value: string): boolean {
  return /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/i.test(value)
    || /(?:\.|_)(?:test|spec)\.[^/]+$/i.test(value);
}

function sourceStem(value: string): string {
  return path.posix.basename(value).replace(/(?:\.|_)(?:test|spec)(?=\.)/i, '').replace(/\.[^.]+$/, '').toLowerCase();
}

function testMatchesStem(testFile: string, stem: string): boolean {
  return stem.length > 0 && sourceStem(testFile) === stem;
}

function roleScore(roles: Set<ReviewProjectFileRole>): number {
  if (roles.has('changed')) return 50;
  if (roles.has('test')) return 40;
  if (roles.has('rule')) return 30;
  if (roles.has('dependency')) return 20;
  return 10;
}

function orderedRoles(roles: Set<ReviewProjectFileRole>): ReviewProjectFileRole[] {
  const order: ReviewProjectFileRole[] = ['changed', 'test', 'rule', 'dependency', 'source'];
  return order.filter(role => roles.has(role));
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
