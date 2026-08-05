import type {
  AgentOperation,
  CodeChanges,
  PreviewRecord,
  ProgramCall,
} from './types';
import { parsePatchFiles } from './patch-files.ts';

export type AgentProvider = 'Codex' | 'Cursor';

export interface WorkbenchAdapterState {
  status?: string;
  stepCount?: number;
  sessionCount?: number;
  lastEventAt?: string | null;
  lastSyncAt?: string | null;
  error?: string | null;
  [key: string]: unknown;
}

export interface WorkbenchTimelineNode {
  type: string;
  id: string;
  parentId?: string | null;
  name?: string;
  status?: string;
  children?: WorkbenchTimelineNode[];
  startedAt?: string | number | null;
  endedAt?: string | number | null;
  durationMs?: number;
  provider?: string | null;
  source?: string | null;
  generationId?: string | null;
  conversationId?: string | null;
  sessionFile?: string | null;
  arguments?: unknown;
  output?: unknown;
  args?: unknown;
  result?: unknown;
  error?: unknown;
  failed?: boolean;
  incomplete?: boolean;
  sourceFile?: string;
  changed?: boolean | null;
  beforeHash?: string | null;
  afterHash?: string | null;
  beforePatch?: string | null;
  afterPatch?: string | null;
  summary?: unknown;
  method?: string;
  category?: string;
  normalized?: boolean;
  display?: boolean;
  cwd?: string | null;
  projectAssignment?: string | null;
  attribution?: string | null;
  projectRoot?: string | null;
  observationWindow?: unknown;
  outcome?: string | null;
  [key: string]: unknown;
}

export interface WorkbenchSourceCoverage {
  sourceRecords: number;
  assignedToTurn: number;
  assignedToProject: number;
  normalized: number;
  rendered: number;
  hidden: number;
  unknown: number;
  invalid: number;
  unassigned?: number;
}

export interface WorkbenchState {
  projectRoot: string | null;
  turns: WorkbenchTimelineNode[];
  error: string | null;
  observation: Record<string, unknown> | null;
  adapters: Record<string, WorkbenchAdapterState>;
  sources: Record<string, WorkbenchSourceCoverage>;
  files: Record<string, string | null>;
  fileBus: {
    status: 'idle' | 'watching' | 'error';
    directory: string | null;
    lastRefreshAt: string | null;
    error: string | null;
  };
}

export interface WorkbenchBridge {
  openProject(): Promise<WorkbenchState>;
  getState(): Promise<WorkbenchState>;
  refresh(): Promise<WorkbenchState>;
  onState(handler: (state: WorkbenchState) => void): () => void;
}

declare global {
  interface Window {
    workbench?: WorkbenchBridge;
  }
}

interface OrderedRecord {
  record: PreviewRecord;
  timestamp: number | null;
  order: number;
}

const EDIT_TOOLS = new Set([
  'apply_patch',
  'edit',
  'multiedit',
  'strreplace',
  'write',
  'write_file',
  'delete',
  'editnotebook',
]);

export function mapWorkbenchStateToRecords(state: WorkbenchState): PreviewRecord[] {
  return mapWorkbenchTurnsToRecords(state.turns ?? [], state.projectRoot);
}

export function mapWorkbenchTurnsToRecords(
  turns: WorkbenchTimelineNode[],
  projectRoot: string | null,
): PreviewRecord[] {
  const ordered: OrderedRecord[] = [];
  let order = 0;

  for (const turn of turns) {
    if (turn.type === 'code_change') {
      if (turn.display === false) continue;
      ordered.push({
        record: mapCodeChange(turn, projectRoot),
        timestamp: toTimestamp(turn.endedAt ?? turn.startedAt),
        order: order++,
      });
      continue;
    }
    if (turn.type === 'program_group') {
      for (const [index, node] of (turn.children ?? []).entries()) {
        ordered.push({
          record: mapProgramCall(node, `${turn.id}:call:${node.id || index}`, projectRoot),
          timestamp: toTimestamp(node.startedAt ?? turn.startedAt),
          order: order++,
        });
      }
      continue;
    }
    if (turn.type !== 'turn') continue;
    const turnProvider = providerFrom(turn);
    const nodes = turn.children ?? [];
    const topLevel: AgentOperation[] = [];
    const positions = new Map<string, number>();

    nodes.forEach((node, position) => {
      if (node.type === 'agent_tool') {
        if (node.display === false) return;
        if (isReadTool(node.name)) return;
        const operation = mapAgentOperation(node, turn, projectRoot, turnProvider);
        topLevel.push(operation);
        positions.set(operation.id, position);
      }
    });

    for (const record of topLevel) {
      const sourceNode = nodes[positions.get(record.id) ?? 0] ?? turn;
      ordered.push({
        record,
        timestamp: toTimestamp(sourceNode.startedAt ?? turn.startedAt),
        order: order++,
      });
    }
  }

  return ordered
    .sort((left, right) => {
      if (left.timestamp === null && right.timestamp === null) return left.order - right.order;
      if (left.timestamp === null) return 1;
      if (right.timestamp === null) return -1;
      return left.timestamp - right.timestamp || left.order - right.order;
    })
    .map(item => item.record);
}

function mapAgentOperation(
  node: WorkbenchTimelineNode,
  turn: WorkbenchTimelineNode,
  projectRoot: string | null,
  fallbackProvider: AgentProvider,
): AgentOperation {
  const provider = providerFrom(node, fallbackProvider);
  const args = asRecord(node.arguments);
  const method = node.method || methodForTool(node.name);
  const id = scopedId(turn, node, provider);
  const children: PreviewRecord[] = mapProgramChildren(node.children ?? [], id, projectRoot);
  const exactPatch = exactPatchFor(node);
  if (exactPatch) children.push(mapExactPatch(node, exactPatch, id, projectRoot));
  return {
    ...baseRow(node, 'operation', method, provider, projectRoot, args),
    id,
    sortTimestamp: toTimestamp(node.startedAt) ?? undefined,
    provider,
    startedAt: formatStartedAt(node.startedAt),
    duration: formatDuration(node),
    workingDirectory: workingDirectory(args, projectRoot),
    arguments: args,
    result: node.output,
    error: errorText(node),
    rawRecord: rawRecord(node, turn),
    children,
  };
}

function mapProgramChildren(
  nodes: WorkbenchTimelineNode[],
  parentId: string,
  projectRoot: string | null,
): ProgramCall[] {
  return nodes
    .filter(node => node.type === 'program_call')
    .map((node, index) => mapProgramCall(node, `${parentId}:call:${node.id || index}`, projectRoot));
}

function mapProgramCall(
  node: WorkbenchTimelineNode,
  id: string,
  projectRoot: string | null,
): ProgramCall {
  const file = node.sourceFile || 'Source unavailable';
  return {
    ...baseRow(node, 'call', node.name || 'function', 'Codex', projectRoot),
    id,
    source: 'Function',
    scope: directoryName(file),
    target: fileName(file),
    functionName: node.name || 'function',
    file,
    startedAt: formatStartedAt(node.startedAt),
    duration: formatDuration(node),
    arguments: node.args,
    result: node.result,
    error: errorText(node),
    rawRecord: { ...node },
    children: mapProgramChildren(node.children ?? [], id, projectRoot),
  };
}

function mapCodeChange(
  node: WorkbenchTimelineNode,
  projectRoot: string | null,
): CodeChanges {
  const changed = node.changed === true;
  const before = shortHash(node.beforeHash);
  const after = shortHash(node.afterHash);
  const summary = changed
    ? `${before} → ${after}`
    : node.changed === false
      ? 'No code changes'
      : 'Code state unavailable';
  const files = parsePatchFiles(node.afterPatch);
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const target = files.length > 0
    ? `${files.length} ${files.length === 1 ? 'file' : 'files'} · +${additions} −${deletions}`
    : summary;
  return {
    id: node.id,
    kind: 'changes',
    method: 'DIFF',
    status: node.status === 'error' ? 'ERROR' : 'OBSERVED',
    source: node.source === 'filesystem' ? 'Filesystem' : 'Git',
    scope: node.projectRoot || projectRoot || 'Project',
    target,
    color: node.status === 'error' ? '#e1421f' : '#f1971f',
    sortTimestamp: toTimestamp(node.endedAt ?? node.startedAt) ?? undefined,
    summary,
    files,
    projectFiles: files.map(file => ({
      path: file.path,
      language: file.language,
      source: file.after,
      change: file.change,
    })),
    rawRecord: { ...node },
    detailMode: files.length > 0 ? 'files' : 'summary',
  };
}

function mapExactPatch(
  node: WorkbenchTimelineNode,
  patch: string,
  parentId: string,
  projectRoot: string | null,
): CodeChanges {
  const files = parsePatchFiles(patch);
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const summary = `${files.length} ${files.length === 1 ? 'file' : 'files'} · +${additions} −${deletions}`;
  return {
    id: `${parentId}:exact-diff`,
    kind: 'changes',
    method: 'DIFF',
    status: node.failed ? 'ERROR' : 'CHANGED',
    source: 'Exact Patch',
    scope: node.cwd || projectRoot || 'Project',
    target: summary,
    color: node.failed ? '#e1421f' : '#f1971f',
    sortTimestamp: toTimestamp(node.startedAt) ?? undefined,
    summary,
    files,
    projectFiles: files.map(file => ({ path: file.path, language: file.language, source: file.after, change: file.change })),
    rawRecord: { attribution: 'exact', source: 'apply_patch', patch, operationId: node.id },
    detailMode: 'files',
  };
}

function exactPatchFor(node: WorkbenchTimelineNode): string | null {
  if ((node.name ?? '').toLowerCase() !== 'apply_patch') return null;
  if (node.outcome !== 'exact' || node.failed || node.status !== 'completed') return null;
  if (typeof node.arguments === 'string' && node.arguments.includes('*** Begin Patch')) return node.arguments;
  const args = asRecord(node.arguments);
  for (const key of ['patch', 'input', 'value']) {
    if (typeof args[key] === 'string' && args[key].includes('*** Begin Patch')) return args[key];
  }
  return null;
}

function baseRow<K extends PreviewRecord['kind']>(
  node: WorkbenchTimelineNode,
  kind: K,
  method: string,
  provider: AgentProvider,
  projectRoot: string | null,
  args: Record<string, unknown> = {},
): {
  id: string;
  kind: K;
  method: string;
  status: string;
  source: string;
  scope: string;
  target: string;
  color: string;
} {
  const status = statusFor(node);
  return {
    id: node.id,
    kind,
    method,
    status,
    source: provider,
    scope: scopeFor(args, projectRoot),
    target: targetFor(node, args),
    color: colorFor(status, provider, kind),
  };
}

function methodForTool(name: string | undefined): string {
  const normalized = (name ?? '').toLowerCase();
  if (['shell', 'shell_command', 'exec_command', 'awaitshell'].includes(normalized)) return 'SHELL';
  if (EDIT_TOOLS.has(normalized)) return 'EDIT';
  if (normalized === 'task') return 'TASK';
  return compactMethod(name);
}

function isReadTool(name: string | undefined): boolean {
  return (name ?? '').toLowerCase() === 'read';
}

function compactMethod(name: string | undefined): string {
  if (!name) return 'ACTION';
  const normalized = name.toLowerCase();
  if (normalized === 'semanticsearch') return 'SEARCH';
  if (normalized === 'websearch' || normalized === 'webfetch') return 'WEB';
  return name.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
}

function statusFor(node: WorkbenchTimelineNode): string {
  const status = (node.status ?? '').toLowerCase();
  if (node.failed || node.error != null || outputFailed(node.output) || status === 'error' || status === 'failed') return 'ERROR';
  if (node.incomplete || status === 'pending' || status === 'running') return 'RUNNING';
  if (node.outcome === 'transport-only') return 'UNKNOWN';
  return 'OK';
}

function outputFailed(value: unknown): boolean {
  let candidate = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return false;
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const record = candidate as Record<string, unknown>;
  return record.isError === true ||
    record.success === false ||
    record.status === 'failed' ||
    record.status === 'error' ||
    (typeof record.exit_code === 'number' && record.exit_code !== 0) ||
    (typeof record.exitCode === 'number' && record.exitCode !== 0);
}

function providerFrom(node: WorkbenchTimelineNode, fallback: AgentProvider = 'Codex'): AgentProvider {
  const value = `${node.provider ?? ''} ${node.source ?? ''}`.toLowerCase();
  if (value.includes('cursor')) return 'Cursor';
  if (value.includes('codex')) return 'Codex';
  return fallback;
}

function colorFor(status: string, provider: AgentProvider, kind: PreviewRecord['kind']): string {
  if (status === 'ERROR') return '#e1421f';
  if (status === 'RUNNING' || status === 'CHANGED' || status === 'OBSERVED') return '#f1971f';
  if (kind === 'call') return '#5b96a3';
  return provider === 'Cursor' ? '#7547d8' : '#6284fa';
}

function scopedId(turn: WorkbenchTimelineNode, node: WorkbenchTimelineNode, provider: AgentProvider): string {
  const session = turn.conversationId || turn.generationId || 'session';
  return `${provider.toLowerCase()}:${session}:${node.id}`;
}

function rawRecord(node: WorkbenchTimelineNode, turn: WorkbenchTimelineNode): Record<string, unknown> {
  return {
    ...node,
    session: {
      conversationId: node.conversationId ?? turn.conversationId ?? null,
      generationId: node.generationId ?? turn.generationId ?? null,
      sessionFile: node.sessionFile ?? null,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { value };
    }
    return { value };
  }
  return value == null ? {} : { value };
}

function errorText(node: WorkbenchTimelineNode): string | undefined {
  if (node.error instanceof Error) return node.error.message;
  if (typeof node.error === 'string') return node.error;
  if (node.error != null) return stringify(node.error);
  if (!node.failed && !outputFailed(node.output)) return undefined;
  if (typeof node.output === 'string') return node.output;
  if (node.output != null) return stringify(node.output);
  return 'The operation failed.';
}

function targetFor(node: WorkbenchTimelineNode, args: Record<string, unknown>): string {
  for (const key of ['command', 'cmd', 'path', 'file', 'filePath', 'query', 'pattern', 'prompt', 'task']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return oneLine(value);
  }
  return node.name || 'Activity';
}

function scopeFor(args: Record<string, unknown>, projectRoot: string | null): string {
  for (const key of ['cwd', 'workdir', 'workingDirectory']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  for (const key of ['path', 'file', 'filePath']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return directoryName(value) || projectRoot || 'Project';
  }
  return projectRoot ?? 'Project';
}

function workingDirectory(args: Record<string, unknown>, projectRoot: string | null): string {
  return scopeFor(args, projectRoot);
}

function formatStartedAt(value: unknown): string {
  const timestamp = toTimestamp(value);
  if (timestamp === null) return 'Unknown';
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  });
}

function formatDuration(node: WorkbenchTimelineNode): string {
  const duration = typeof node.durationMs === 'number'
    ? node.durationMs
    : elapsed(node.startedAt, node.endedAt);
  if (duration === null) return 'Unknown';
  if (duration < 1000) return `${Math.max(0, Math.round(duration))} ms`;
  return `${(duration / 1000).toFixed(duration < 10000 ? 1 : 0)} s`;
}

function elapsed(start: unknown, end: unknown): number | null {
  const started = toTimestamp(start);
  const ended = toTimestamp(end);
  return started === null || ended === null ? null : Math.max(0, ended - started);
}

function toTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function directoryName(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '' : normalized.slice(0, index);
}

function fileName(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || value;
}

function shortHash(value: unknown): string {
  return typeof value === 'string' && value ? value.slice(0, 8) : 'unknown';
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
