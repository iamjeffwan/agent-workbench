import crypto from 'node:crypto';
import os from 'node:os';

import type { ObservationSession } from '@agent-workbench/observation-schema';

import { captureGitState, diffGitTrees } from './git-state.js';
import { buildProjectProfile } from './project-profile.js';
import type {
  EnvironmentChange,
  EnvironmentChangeKind,
  EnvironmentDelta,
  EnvironmentSnapshot,
  ProjectObservationContext,
  ProjectStateCapture,
  ProjectTurnFacts,
  TurnDiff,
} from './types.js';

export const PROJECT_OBSERVATION_VERSION = '0.1.0';

export function projectContextFromObservation(
  observation: ObservationSession,
  turnId: string,
): ProjectObservationContext {
  const turn = observation.turns.find(candidate => candidate.turnId === turnId);
  if (!turn) throw new Error(`Observation turn not found: ${turnId}`);
  const projectId = observation.session.projectId;
  if (!projectId) throw new Error('Observation session is missing projectId');
  const cwd = turn.cwd ?? observation.session.cwd;
  if (!cwd) throw new Error(`Observation turn ${turnId} is missing cwd`);
  return {
    projectId,
    sessionId: observation.session.sessionId,
    turnId,
    cwd,
  };
}

export function captureProjectState(
  context: Pick<ProjectObservationContext, 'projectId' | 'sessionId' | 'cwd'>,
  now = new Date(),
): ProjectStateCapture {
  const capturedAt = now.toISOString();
  const git = captureGitState(context.cwd);
  const profile = buildProjectProfile(git.repositoryRoot, context.projectId, capturedAt);
  const runtime = {
    os: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
  };
  const snapshotIdentity = hashJson({
    projectId: context.projectId,
    sessionId: context.sessionId,
    treeHash: git.treeHash,
    branch: git.branch,
    commit: git.commit,
    profileVersion: profile.version,
    runtime,
    generatorVersion: PROJECT_OBSERVATION_VERSION,
  });
  const snapshot: EnvironmentSnapshot = {
    snapshotId: `snapshot:${snapshotIdentity.slice(0, 16)}`,
    projectId: context.projectId,
    sessionId: context.sessionId,
    generatorVersion: PROJECT_OBSERVATION_VERSION,
    capturedAt,
    projectProfileVersion: profile.version,
    git: {
      ...(git.branch ? { branch: git.branch } : {}),
      ...(git.commit ? { commit: git.commit } : {}),
      treeHash: git.treeHash,
      dirty: git.dirty,
    },
    runtime,
  };
  return { repositoryRoot: git.repositoryRoot, profile, snapshot };
}

export function deriveProjectTurnFacts(
  context: ProjectObservationContext,
  before: ProjectStateCapture,
  after: ProjectStateCapture,
  now = new Date(),
): ProjectTurnFacts {
  assertCompatibleCapture(context, before, after);
  const generatedAt = now.toISOString();
  const diffResult = diffGitTrees(
    before.repositoryRoot,
    before.snapshot.git.treeHash,
    after.snapshot.git.treeHash,
  );
  const contentHash = crypto.createHash('sha256').update(diffResult.unifiedDiff).digest('hex');
  const turnDiff: TurnDiff = {
    diffId: `diff:${hashJson({
      projectId: context.projectId,
      sessionId: context.sessionId,
      turnId: context.turnId,
      baseRef: before.snapshot.git.treeHash,
      resultRef: after.snapshot.git.treeHash,
      builderVersion: PROJECT_OBSERVATION_VERSION,
    }).slice(0, 16)}`,
    projectId: context.projectId,
    sessionId: context.sessionId,
    turnId: context.turnId,
    builderVersion: PROJECT_OBSERVATION_VERSION,
    baseRef: before.snapshot.git.treeHash,
    resultRef: after.snapshot.git.treeHash,
    filesChanged: diffResult.filesChanged,
    unifiedDiff: diffResult.unifiedDiff,
    generatedAt,
    contentHash,
    isCurrent: true,
  };
  const changes = buildEnvironmentChanges(before, after);
  const environmentDelta: EnvironmentDelta = {
    deltaId: `environment-delta:${hashJson({
      turnId: context.turnId,
      before: before.snapshot.snapshotId,
      after: after.snapshot.snapshotId,
      changes,
      generatorVersion: PROJECT_OBSERVATION_VERSION,
    }).slice(0, 16)}`,
    projectId: context.projectId,
    sessionId: context.sessionId,
    turnId: context.turnId,
    generatorVersion: PROJECT_OBSERVATION_VERSION,
    beforeSnapshotId: before.snapshot.snapshotId,
    afterSnapshotId: after.snapshot.snapshotId,
    generatedAt,
    changes,
  };
  return { turnDiff, environmentDelta };
}

function assertCompatibleCapture(
  context: ProjectObservationContext,
  before: ProjectStateCapture,
  after: ProjectStateCapture,
): void {
  if (before.repositoryRoot !== after.repositoryRoot) {
    throw new Error('Project state captures belong to different repositories');
  }
  for (const capture of [before, after]) {
    if (capture.snapshot.projectId !== context.projectId) {
      throw new Error('Project state capture does not match projectId');
    }
    if (capture.snapshot.sessionId !== context.sessionId) {
      throw new Error('Project state capture does not match sessionId');
    }
  }
}

function buildEnvironmentChanges(
  before: ProjectStateCapture,
  after: ProjectStateCapture,
): EnvironmentChange[] {
  const changes: EnvironmentChange[] = [];
  addChange(changes, 'git_branch', before.snapshot.git.branch ?? null, after.snapshot.git.branch ?? null);
  addChange(changes, 'git_commit', before.snapshot.git.commit ?? null, after.snapshot.git.commit ?? null);
  addChange(changes, 'runtime', runtimeValue(before.snapshot), runtimeValue(after.snapshot));
  addChange(changes, 'technology_stack', before.profile.technologyStack, after.profile.technologyStack);
  addChange(changes, 'package_manager', before.profile.packageManagers, after.profile.packageManagers);
  addChange(changes, 'dependency', before.profile.keyDependencies, after.profile.keyDependencies);
  addChange(changes, 'command', before.profile.commands, after.profile.commands);
  addFingerprintChange(changes, 'configuration', before.profile.fingerprints.configuration, after.profile.fingerprints.configuration);
  addFingerprintChange(changes, 'project_rule', before.profile.fingerprints.rules, after.profile.fingerprints.rules);
  addFingerprintChange(changes, 'skill', before.profile.fingerprints.skills, after.profile.fingerprints.skills);
  addFingerprintChange(changes, 'mcp', before.profile.fingerprints.mcp, after.profile.fingerprints.mcp);
  return changes;
}

function addChange(
  changes: EnvironmentChange[],
  kind: EnvironmentChangeKind,
  before: string | string[] | null,
  after: string | string[] | null,
): void {
  if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ kind, before, after });
}

function addFingerprintChange(
  changes: EnvironmentChange[],
  kind: EnvironmentChangeKind,
  before: string,
  after: string,
): void {
  if (before !== after) changes.push({ kind, before, after });
}

function runtimeValue(snapshot: EnvironmentSnapshot): string {
  return `${snapshot.runtime.os}/${snapshot.runtime.arch}/${snapshot.runtime.nodeVersion}`;
}

function hashJson(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
