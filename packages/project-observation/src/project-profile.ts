import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { listProjectFiles } from './git-state.js';
import type { ProjectProfile } from './types.js';

const MAX_DEPENDENCIES = 200;

export function buildProjectProfile(
  repositoryRoot: string,
  projectId: string,
  generatedAt: string,
): ProjectProfile {
  const files = listProjectFiles(repositoryRoot);
  const packageJsonFiles = files.filter(file => path.posix.basename(file) === 'package.json');
  const manifests = files.filter(isProjectManifest);
  const ruleFiles = files.filter(isRuleFile);
  const skillFiles = files.filter(isSkillFile);
  const mcpFiles = files.filter(isMcpFile);
  const packageJsonProfiles = packageJsonFiles.map(file => readPackageJson(repositoryRoot, file));
  const keyDependencies = packageJsonProfiles
    .flatMap(profile => profile.dependencies)
    .sort()
    .slice(0, MAX_DEPENDENCIES);
  const commands = packageJsonProfiles.flatMap(profile => profile.commands).sort();
  const technologyStack = detectTechnologyStack(files);
  const packageManagers = detectPackageManagers(files);
  const sourceFiles = [...new Set([...manifests, ...ruleFiles, ...skillFiles, ...mcpFiles])].sort();
  const fingerprints = {
    configuration: fingerprintFiles(repositoryRoot, manifests),
    rules: fingerprintFiles(repositoryRoot, ruleFiles),
    skills: fingerprintFiles(repositoryRoot, skillFiles),
    mcp: fingerprintFiles(repositoryRoot, mcpFiles),
  };
  const version = hashJson({
    technologyStack,
    packageManagers,
    keyDependencies,
    commands,
    ruleFiles,
    skillFiles,
    mcpFiles,
    fingerprints,
  });

  return {
    profileId: `profile:${version.slice(0, 16)}`,
    projectId,
    version,
    generatedAt,
    technologyStack,
    packageManagers,
    keyDependencies,
    commands,
    ruleFiles,
    skillFiles,
    mcpFiles,
    sourceFiles,
    fingerprints,
  };
}

function readPackageJson(
  repositoryRoot: string,
  relativePath: string,
): { dependencies: string[]; commands: string[] } {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')) as unknown;
    if (!isRecord(value)) return { dependencies: [], commands: [] };
    const dependencies = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
      .flatMap(section => dependencyEntries(value[section]));
    const scripts = isRecord(value.scripts) ? value.scripts : {};
    const commands = Object.entries(scripts)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, command]) => `${relativePath}#${name}=${command}`);
    return { dependencies, commands };
  } catch {
    return { dependencies: [], commands: [] };
  }
}

function dependencyEntries(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, version]) => `${name}@${version}`);
}

function detectTechnologyStack(files: string[]): string[] {
  const stack = new Set<string>();
  if (files.some(file => file.endsWith('package.json'))) stack.add('Node.js');
  if (files.some(file => /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(file))) stack.add('TypeScript');
  if (files.includes('Cargo.toml')) stack.add('Rust');
  if (files.includes('pyproject.toml') || files.includes('requirements.txt')) stack.add('Python');
  if (files.includes('go.mod')) stack.add('Go');
  return [...stack].sort();
}

function detectPackageManagers(files: string[]): string[] {
  const managers = new Set<string>();
  if (files.includes('pnpm-lock.yaml')) managers.add('pnpm');
  if (files.includes('package-lock.json')) managers.add('npm');
  if (files.includes('yarn.lock')) managers.add('yarn');
  if (files.includes('bun.lock') || files.includes('bun.lockb')) managers.add('bun');
  if (files.includes('Cargo.lock')) managers.add('cargo');
  if (files.includes('uv.lock')) managers.add('uv');
  if (files.includes('poetry.lock')) managers.add('poetry');
  if (files.includes('go.mod')) managers.add('go');
  return [...managers].sort();
}

function isProjectManifest(file: string): boolean {
  const name = path.posix.basename(file);
  return name === 'package.json'
    || /^tsconfig(?:\.[^/]+)?\.json$/.test(name)
    || ['pnpm-workspace.yaml', 'Cargo.toml', 'pyproject.toml', 'requirements.txt', 'go.mod'].includes(name);
}

function isRuleFile(file: string): boolean {
  return ['AGENTS.md', 'CLAUDE.md'].includes(path.posix.basename(file));
}

function isSkillFile(file: string): boolean {
  return path.posix.basename(file) === 'SKILL.md'
    || file.startsWith('.agents/skills/')
    || file.startsWith('.codex/skills/');
}

function isMcpFile(file: string): boolean {
  const lower = file.toLowerCase();
  return lower === '.mcp.json'
    || lower === 'mcp.json'
    || lower.endsWith('/mcp.json')
    || lower.includes('/mcp-')
    || lower.includes('/mcp.');
}

function fingerprintFiles(repositoryRoot: string, files: string[]): string {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort()) {
    hash.update(file);
    try {
      hash.update(fs.readFileSync(path.join(repositoryRoot, file)));
    } catch {
      hash.update('<unreadable>');
    }
  }
  return hash.digest('hex');
}

function hashJson(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
