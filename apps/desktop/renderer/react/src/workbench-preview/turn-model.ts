import type { PreviewRecord } from './types.ts';
import {
  mapWorkbenchTurnsToRecords,
  type AgentProvider,
  type WorkbenchState,
  type WorkbenchTimelineNode,
} from './workbench-data.ts';

export type ObservableActivity =
  | 'SEARCH'
  | 'FUNCTION'
  | 'PROCESS'
  | 'REQUEST'
  | 'WRITE'
  | 'DIFF'
  | 'TEST'
  | 'TOOL'
  | 'DELEGATE'
  | 'ERROR';

export interface ObservableTurnSummary {
  id: string;
  provider: AgentProvider;
  conversationId: string;
  generationId: string;
  startedAt: number;
  lastObservableAt: number;
  status: 'OK' | 'ERROR' | 'RUNNING';
  activities: ObservableActivity[];
  scope: string;
  target: string;
  records: PreviewRecord[];
  eventIds: string[];
}

export type ViewRange =
  | { kind: 'latest'; turnIds: string[] }
  | { kind: 'live'; turnIds: string[]; knownEventIds: string[] }
  | { kind: 'history'; turnIds: string[] }
  | { kind: 'paused'; turnIds: string[] };

const EDIT_TOOLS = new Set([
  'apply_patch', 'edit', 'multiedit', 'strreplace', 'write', 'write_file',
  'delete', 'editnotebook',
]);
const SEARCH_TOOLS = new Set(['grep', 'glob', 'semanticsearch', 'rg', 'websearch']);
const PROCESS_TOOLS = new Set(['shell', 'shell_command', 'exec_command', 'awaitshell', 'task']);

export function buildObservableTurns(state: WorkbenchState): ObservableTurnSummary[] {
  return (state.turns ?? [])
    .filter(turn => turn.type === 'turn' && Boolean(turn.generationId))
    .map(turn => summarizeTurn(turn, state.projectRoot))
    .filter((turn): turn is ObservableTurnSummary => turn !== null)
    .sort(compareTurns);
}

export function buildStandaloneRecords(state: WorkbenchState): PreviewRecord[] {
  return mapWorkbenchTurnsToRecords(
    (state.turns ?? []).filter(root => root.type !== 'turn'),
    state.projectRoot,
  );
}

export function latestObservableTurn(turns: ObservableTurnSummary[]): ObservableTurnSummary | undefined {
  return [...turns].sort(compareTurns).at(-1);
}

export function recordsForTurnIds(
  turns: ObservableTurnSummary[],
  turnIds: string[],
): PreviewRecord[] {
  const selected = new Set(turnIds);
  return turns
    .filter(turn => selected.has(turn.id))
    .sort(compareTurns)
    .flatMap(turn => turn.records.map((record, index) => ({ record, index, turn })))
    .sort((left, right) =>
      (left.record.sortTimestamp ?? left.turn.startedAt) - (right.record.sortTimestamp ?? right.turn.startedAt) ||
      left.turn.startedAt - right.turn.startedAt ||
      left.index - right.index,
    )
    .map(item => item.record);
}

export function recordsForView(
  turns: ObservableTurnSummary[],
  turnIds: string[],
  standalone: PreviewRecord[],
): PreviewRecord[] {
  const selected = turns.filter(turn => turnIds.includes(turn.id));
  if (selected.length === 0) return sortRecords(standalone);
  const generationIds = new Set(selected.map(turn => turn.generationId));
  const start = Math.min(...selected.map(turn => turn.startedAt));
  const end = Math.max(...selected.map(turn => turn.lastObservableAt));
  const visibleEvidence = standalone.filter(record => {
    const observationTurn = observationGenerationId(record);
    if (observationTurn && generationIds.has(observationTurn)) return true;
    const time = record.sortTimestamp;
    return typeof time === 'number' && time >= start && time <= end;
  });
  return sortRecords([
    ...recordsForTurnIds(turns, turnIds),
    ...visibleEvidence,
  ]);
}

export function eventIdsForTurns(turns: ObservableTurnSummary[]): string[] {
  return [...new Set(turns.flatMap(turn => turn.eventIds))];
}

export function extendLiveRange(
  range: Extract<ViewRange, { kind: 'live' }>,
  turns: ObservableTurnSummary[],
): Extract<ViewRange, { kind: 'live' }> {
  const knownEvents = new Set(range.knownEventIds);
  const turnIds = new Set(range.turnIds);
  for (const turn of turns) {
    if (turn.eventIds.some(id => !knownEvents.has(id))) turnIds.add(turn.id);
  }
  return {
    kind: 'live',
    turnIds: turns.filter(turn => turnIds.has(turn.id)).map(turn => turn.id),
    knownEventIds: eventIdsForTurns(turns),
  };
}

export function createLiveRange(turns: ObservableTurnSummary[]): Extract<ViewRange, { kind: 'live' }> {
  const latest = latestObservableTurn(turns);
  return {
    kind: 'live',
    turnIds: latest ? [latest.id] : [],
    knownEventIds: eventIdsForTurns(turns),
  };
}

export function createFixtureTurns(records: PreviewRecord[]): ObservableTurnSummary[] {
  const groups = [
    { provider: 'Codex' as const, records: records.slice(0, 2), generationId: 'preview-codex-turn' },
    { provider: 'Cursor' as const, records: records.slice(2), generationId: 'preview-cursor-turn' },
  ];
  return groups.filter(group => group.records.length > 0).map((group, index) => {
    const eventIds = flattenRecords(group.records).map(record => record.id);
    const activities = uniqueActivities(group.records.flatMap(classifyPreviewRecord));
    const startedAt = Date.now() - (groups.length - index) * 60_000;
    const representative = group.records.at(-1)!;
    return {
      id: `${group.provider.toLowerCase()}:preview:${group.generationId}`,
      provider: group.provider,
      conversationId: 'preview-conversation',
      generationId: group.generationId,
      startedAt,
      lastObservableAt: startedAt + 30_000,
      status: group.records.some(record => record.status === 'ERROR') ? 'ERROR' : 'OK',
      activities,
      scope: representative.scope,
      target: representative.target,
      records: group.records,
      eventIds,
    };
  });
}

function summarizeTurn(
  turn: WorkbenchTimelineNode,
  projectRoot: string | null,
): ObservableTurnSummary | null {
  const activities = collectActivities(turn);
  if (activities.length === 0 || !turn.generationId) return null;
  const records = mapWorkbenchTurnsToRecords([turn], projectRoot);
  if (records.length === 0) return null;
  const provider = providerFrom(turn);
  const conversationId = turn.conversationId || turn.sessionFile || 'unassigned';
  const representative = records.at(-1)!;
  const times = collectNodes(turn)
    .filter(node => classifyNode(node).length > 0)
    .flatMap(node => [timestamp(node.startedAt), timestamp(node.endedAt)])
    .filter((value): value is number => value !== null);
  const fallback = timestamp(turn.startedAt) ?? 0;
  return {
    id: `${provider.toLowerCase()}:${conversationId}:${turn.generationId}`,
    provider,
    conversationId,
    generationId: turn.generationId,
    startedAt: times.length ? Math.min(...times) : fallback,
    lastObservableAt: times.length ? Math.max(...times) : fallback,
    status: statusForTurn(turn),
    activities,
    scope: representative.scope,
    target: representative.target,
    records,
    eventIds: collectNodes(turn)
      .filter(node => classifyNode(node).length > 0)
      .map(node => [
        provider.toLowerCase(),
        conversationId,
        turn.generationId,
        node.id,
        node.status ?? '',
        node.endedAt ?? '',
        node.failed ? 'failed' : '',
      ].join(':')),
  };
}

function collectActivities(turn: WorkbenchTimelineNode): ObservableActivity[] {
  return uniqueActivities(collectNodes(turn).flatMap(classifyNode));
}

function classifyNode(node: WorkbenchTimelineNode): ObservableActivity[] {
  if (node.type === 'program_call') return withError(['FUNCTION'], node);
  if (node.type === 'code_change') return withError(['DIFF'], node);
  if (node.type !== 'agent_tool') return [];
  if (node.display === false) return [];
  const method = node.method;
  if (method === 'SEARCH') return withError(['SEARCH'], node);
  if (method === 'EDIT') {
    const activities: ObservableActivity[] = ['WRITE'];
    if ((node.name ?? '').toLowerCase() === 'apply_patch') activities.push('DIFF');
    return withError(activities, node);
  }
  if (method === 'TEST' || method === 'BUILD' || method === 'LINT') return withError(['TEST'], node);
  if (method === 'SHELL') return withError(['PROCESS'], node);
  if (method === 'TOOL') return withError(['TOOL'], node);
  if (method === 'DELEGATE') return withError(['DELEGATE'], node);
  const name = (node.name ?? '').toLowerCase();
  if (name === 'read') return [];
  if (SEARCH_TOOLS.has(name)) return withError(['SEARCH'], node);
  if (name === 'webfetch' || name.includes('request') || name.includes('fetch')) {
    return withError(['REQUEST'], node);
  }
  if (EDIT_TOOLS.has(name)) return withError(['WRITE'], node);
  if (name === 'test' || name.endsWith('_test')) return withError(['TEST'], node);
  if (PROCESS_TOOLS.has(name) || node.launchesProcess) return withError(['PROCESS'], node);
  return [];
}

function classifyPreviewRecord(record: PreviewRecord): ObservableActivity[] {
  if (record.status === 'ERROR') return [...classifyPreviewRecordBase(record), 'ERROR'];
  return classifyPreviewRecordBase(record);
}

function classifyPreviewRecordBase(record: PreviewRecord): ObservableActivity[] {
  if (record.kind === 'call') return ['FUNCTION'];
  if (record.kind === 'network') return ['REQUEST'];
  if (record.kind === 'changes') return ['DIFF'];
  if (record.method === 'EDIT') return ['WRITE'];
  if (record.method === 'SHELL') return ['PROCESS'];
  if (record.method === 'SEARCH' || record.method === 'WEB') return ['SEARCH'];
  return ['FUNCTION'];
}

function withError(activities: ObservableActivity[], node: WorkbenchTimelineNode): ObservableActivity[] {
  return node.failed || node.error != null || `${node.status ?? ''}`.toLowerCase() === 'error'
    ? [...activities, 'ERROR']
    : activities;
}

function statusForTurn(turn: WorkbenchTimelineNode): ObservableTurnSummary['status'] {
  const nodes = collectNodes(turn);
  if (nodes.some(node => node.failed || node.error != null || `${node.status ?? ''}`.toLowerCase() === 'error')) {
    return 'ERROR';
  }
  if (nodes.some(node => node.incomplete || ['pending', 'running'].includes(`${node.status ?? ''}`.toLowerCase()))) {
    return 'RUNNING';
  }
  return 'OK';
}

function providerFrom(turn: WorkbenchTimelineNode): AgentProvider {
  const provider = `${turn.provider ?? ''} ${turn.source ?? ''}`.toLowerCase();
  return provider.includes('cursor') ? 'Cursor' : 'Codex';
}

function collectNodes(node: WorkbenchTimelineNode): WorkbenchTimelineNode[] {
  return (node.children ?? []).flatMap(child => [child, ...collectNodes(child)]);
}

function flattenRecords(records: PreviewRecord[]): PreviewRecord[] {
  return records.flatMap(record => [
    record,
    ...flattenRecords('children' in record ? record.children ?? [] : []),
  ]);
}

function uniqueActivities(activities: ObservableActivity[]): ObservableActivity[] {
  const order: ObservableActivity[] = ['SEARCH', 'FUNCTION', 'PROCESS', 'REQUEST', 'WRITE', 'DIFF', 'TEST', 'TOOL', 'DELEGATE', 'ERROR'];
  const values = new Set(activities);
  return order.filter(activity => values.has(activity));
}

function compareTurns(left: ObservableTurnSummary, right: ObservableTurnSummary): number {
  return left.startedAt - right.startedAt || left.lastObservableAt - right.lastObservableAt || left.id.localeCompare(right.id);
}

function timestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function observationGenerationId(record: PreviewRecord): string | null {
  if (record.kind !== 'changes' || !record.rawRecord) return null;
  const window = record.rawRecord.observationWindow;
  if (!window || typeof window !== 'object' || Array.isArray(window)) return null;
  const generationId = (window as Record<string, unknown>).generationId;
  return typeof generationId === 'string' ? generationId : null;
}

function sortRecords(records: PreviewRecord[]): PreviewRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort((left, right) =>
      (left.record.sortTimestamp ?? Number.MAX_SAFE_INTEGER) -
        (right.record.sortTimestamp ?? Number.MAX_SAFE_INTEGER) ||
      left.index - right.index,
    )
    .map(item => item.record);
}
