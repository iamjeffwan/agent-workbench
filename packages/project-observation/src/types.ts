export type ProjectObservationContext = {
  projectId: string;
  sessionId: string;
  turnId: string;
  cwd: string;
};

export type ProjectProfile = {
  profileId: string;
  projectId: string;
  version: string;
  generatedAt: string;
  technologyStack: string[];
  packageManagers: string[];
  keyDependencies: string[];
  commands: string[];
  ruleFiles: string[];
  skillFiles: string[];
  mcpFiles: string[];
  sourceFiles: string[];
  fingerprints: {
    configuration: string;
    rules: string;
    skills: string;
    mcp: string;
  };
};

export type EnvironmentSnapshot = {
  snapshotId: string;
  projectId: string;
  sessionId: string;
  generatorVersion: string;
  capturedAt: string;
  projectProfileVersion: string;
  git: {
    branch?: string;
    commit?: string;
    treeHash: string;
    dirty: boolean;
  };
  runtime: {
    os: string;
    arch: string;
    nodeVersion: string;
  };
};

export type ProjectStateCapture = {
  repositoryRoot: string;
  profile: ProjectProfile;
  snapshot: EnvironmentSnapshot;
};

export type ProjectFileChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type_changed'
  | 'unmerged'
  | 'unknown';

export type ProjectFileChange = {
  path: string;
  previousPath?: string;
  status: ProjectFileChangeStatus;
  binary: boolean;
};

export type TurnDiff = {
  diffId: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  builderVersion: string;
  baseRef: string;
  resultRef: string;
  filesChanged: ProjectFileChange[];
  unifiedDiff: string;
  generatedAt: string;
  contentHash: string;
  isCurrent: true;
};

export type EnvironmentChangeKind =
  | 'git_branch'
  | 'git_commit'
  | 'runtime'
  | 'technology_stack'
  | 'package_manager'
  | 'dependency'
  | 'command'
  | 'configuration'
  | 'project_rule'
  | 'skill'
  | 'mcp';

export type EnvironmentChange = {
  kind: EnvironmentChangeKind;
  before: string | string[] | null;
  after: string | string[] | null;
};

export type EnvironmentDelta = {
  deltaId: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  generatorVersion: string;
  beforeSnapshotId: string;
  afterSnapshotId: string;
  generatedAt: string;
  changes: EnvironmentChange[];
};

export type ProjectTurnFacts = {
  turnDiff: TurnDiff;
  environmentDelta: EnvironmentDelta;
};
