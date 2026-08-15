import type { MockEvent } from '../upstream/EventList';

export type PreviewStatus = 'OK' | 'ERROR' | 'RUNNING' | 'CHANGED' | string;

export interface PreviewRowBase {
  id: string;
  kind: 'operation' | 'action' | 'call' | 'network' | 'changes';
  method: string;
  status: PreviewStatus;
  source: string;
  scope: string;
  target: string;
  color: string;
  sortTimestamp?: number;
}

export interface AgentOperation extends PreviewRowBase {
  kind: 'operation';
  provider: 'Codex' | 'Cursor';
  startedAt: string;
  duration: string;
  workingDirectory: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  rawRecord: Record<string, unknown>;
  children: PreviewRecord[];
  /** Exact edit content shown on the Edit row itself (not as a Diff child). */
  embeddedChanges?: CodeChanges;
  /** Full relative path shown on Scope hover. */
  scopeTooltip?: string;
}

export interface AgentAction extends PreviewRowBase {
  kind: 'action';
  provider: AgentOperation['provider'];
  startedAt: string;
  duration: string;
  workingDirectory: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  rawRecord: Record<string, unknown>;
  children?: PreviewRecord[];
}

export interface ProgramCall extends PreviewRowBase {
  kind: 'call';
  functionName: string;
  file: string;
  startedAt: string;
  duration: string;
  arguments: unknown;
  result?: unknown;
  error?: string;
  rawRecord: Record<string, unknown>;
  children?: PreviewRecord[];
}

export interface NetworkRequest extends PreviewRowBase {
  kind: 'network';
  event: MockEvent;
}

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  path: string;
  previousPath?: string;
  change: ChangeKind;
  language: 'typescript' | 'javascript' | 'json' | 'css' | 'markdown';
  before: string;
  after: string;
  additions: number;
  deletions: number;
}

export interface ProjectFile {
  path: string;
  language: ChangedFile['language'];
  source: string;
  change?: ChangeKind;
}

export interface CodeChanges extends PreviewRowBase {
  kind: 'changes';
  summary: string;
  files: ChangedFile[];
  projectFiles: ProjectFile[];
  rawRecord?: Record<string, unknown>;
  detailMode?: 'summary' | 'files';
}

export type PreviewRecord = AgentOperation | AgentAction | ProgramCall | NetworkRequest | CodeChanges;
