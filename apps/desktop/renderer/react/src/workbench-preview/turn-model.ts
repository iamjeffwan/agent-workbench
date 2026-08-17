import type { PreviewRecord } from './types.ts';
import type { HistoryTurnSummary } from './workbench-data.ts';
import {
  mapWorkbenchTurnsToRecords,
  mapRecordedChangesForTurn,
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
  sessionId: string;
  generationId: string;
  startedAt: number;
  lastObservableAt: number;
  status: 'OK' | 'ERROR' | 'RUNNING';
  activities: ObservableActivity[];
  scope: string;
  target: string;
  records: PreviewRecord[];
  eventIds: string[];
  recordedChanges: PreviewRecord | null;
}

export interface HistoryTurnSection {
  id: string;
  turnId: string;
  sessionId: string;
  provider: AgentProvider;
  userInput: string;
  startedAt: string | null;
  status: HistoryTurnSummary['status'];
  records: PreviewRecord[];
}

export type ViewRange =
  | { kind: 'latest'; turnIds: string[] }
  | { kind: 'live'; turnIds: string[]; baselineRecordIds: string[] }
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

export function observableTurnIdsForHistorySelection(
  turns: ObservableTurnSummary[],
  selected: HistoryTurnSummary[],
): string[] {
  const identities = new Set(
    selected.map(turn => `${turn.sessionId}:${turn.id}`),
  );
  return turns
    .filter(turn => identities.has(`${turn.sessionId}:${turn.generationId}`))
    .map(turn => turn.id);
}

export function recordsForView(
  turns: ObservableTurnSummary[],
  turnIds: string[],
  standalone: PreviewRecord[],
  options: { includeRecordedChanges?: boolean } = {},
): PreviewRecord[] {
  const selected = turns.filter(turn => turnIds.includes(turn.id));
  if (selected.length === 0) return sortRecords(standalone);
  const selectedIdentities = new Set(
    selected.map(turn => `${turn.sessionId}:${turn.generationId}`),
  );
  const visibleEvidence = standalone.filter(record => {
    const observation = observationIdentity(record);
    return observation !== null && selectedIdentities.has(
      `${observation.sessionId}:${observation.generationId}`,
    );
  });
  return sortRecords([
    ...recordsForTurnIds(turns, turnIds),
    ...(options.includeRecordedChanges
      ? selected.flatMap(turn => turn.recordedChanges ? [turn.recordedChanges] : [])
      : []),
    ...visibleEvidence,
  ]);
}

export function buildHistoryTurnSections(
  turns: ObservableTurnSummary[],
  selectedTurns: HistoryTurnSummary[],
  standalone: PreviewRecord[],
): HistoryTurnSection[] {
  const observableByIdentity = new Map(
    turns.map(turn => [`${turn.sessionId}:${turn.generationId}`, turn]),
  );
  return [...selectedTurns]
    .sort((left, right) => historyTimestamp(left.startedAt) - historyTimestamp(right.startedAt))
    .map(selected => {
      const turn = observableByIdentity.get(`${selected.sessionId}:${selected.id}`);
      const identity = `${selected.sessionId}:${selected.id}`;
      const evidence = standalone.filter(record => {
        const observation = observationIdentity(record);
        return observation !== null && `${observation.sessionId}:${observation.generationId}` === identity;
      });
      return {
        id: identity,
        turnId: selected.id,
        sessionId: selected.sessionId,
        provider: turn?.provider ?? 'Codex',
        userInput: selected.userInput,
        startedAt: selected.startedAt,
        status: selected.status,
        records: [
          ...sortRecords([...(turn?.records ?? []), ...evidence]),
          ...(turn?.recordedChanges ? [turn.recordedChanges] : []),
        ],
      };
    });
}

export function recordsForLiveRange(
  turns: ObservableTurnSummary[],
  range: Extract<ViewRange, { kind: 'live' }>,
  standalone: PreviewRecord[],
): PreviewRecord[] {
  const baseline = new Set(range.baselineRecordIds);
  return filterRecordsAfterBaseline(
    sortRecords([...turns.flatMap(turn => turn.records), ...standalone]),
    baseline,
  );
}

export function eventIdsForTurns(turns: ObservableTurnSummary[]): string[] {
  return [...new Set(turns.flatMap(turn => turn.eventIds))];
}

export function extendLiveRange(
  range: Extract<ViewRange, { kind: 'live' }>,
  _turns: ObservableTurnSummary[],
): Extract<ViewRange, { kind: 'live' }> {
  return range;
}

export function createLiveRange(
  turns: ObservableTurnSummary[],
  standalone: PreviewRecord[] = [],
): Extract<ViewRange, { kind: 'live' }> {
  return {
    kind: 'live',
    turnIds: [],
    baselineRecordIds: flattenRecords([
      ...turns.flatMap(turn => turn.records),
      ...standalone,
    ]).map(record => record.id),
  };
}

export function createFixtureTurns(records: PreviewRecord[]): ObservableTurnSummary[] {
  const groups = [
    { provider: 'Codex' as const, records, generationId: 'preview-codex-turn' },
  ];
  return groups.filter(group => group.records.length > 0).map((group, index) => {
    const eventIds = flattenRecords(group.records).map(record => record.id);
    const activities = uniqueActivities(group.records.flatMap(classifyPreviewRecord));
    const startedAt = Date.now() - (groups.length - index) * 60_000;
    const representative = group.records.at(-1)!;
    return {
      id: `${group.provider.toLowerCase()}:preview:${group.generationId}`,
      provider: group.provider,
      sessionId: 'preview-session',
      generationId: group.generationId,
      startedAt,
      lastObservableAt: startedAt + 30_000,
      status: group.records.some(record => {
        const status = record.status.toLowerCase();
        return status === 'error' || status === 'failed';
      }) ? 'ERROR' : 'OK',
      activities,
      scope: representative.scope,
      target: representative.target,
      records: group.records,
      recordedChanges: null,
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
  const sessionId = turn.sessionId || turn.sessionFile || 'unassigned';
  const representative = records.at(-1)!;
  const times = collectNodes(turn)
    .filter(node => classifyNode(node).length > 0)
    .flatMap(node => [timestamp(node.startedAt), timestamp(node.endedAt)])
    .filter((value): value is number => value !== null);
  const fallback = timestamp(turn.startedAt) ?? 0;
  return {
    id: `${provider.toLowerCase()}:${sessionId}:${turn.generationId}`,
    provider,
    sessionId,
    generationId: turn.generationId,
    startedAt: times.length ? Math.min(...times) : fallback,
    lastObservableAt: times.length ? Math.max(...times) : fallback,
    status: statusForTurn(turn),
    activities,
    scope: representative.scope,
    target: representative.target,
    records,
    recordedChanges: mapRecordedChangesForTurn(turn, projectRoot),
    eventIds: collectNodes(turn)
      .filter(node => classifyNode(node).length > 0)
      .map(node => [
        provider.toLowerCase(),
        sessionId,
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
  if (node.type === 'event') {
    if (node.display === false) return [];
    if (node.eventKind === 'file_change') {
      return withError(['WRITE', 'DIFF'], node);
    }
    if (node.eventKind === 'test_result') {
      return withError(['TEST'], node);
    }
    if (node.eventKind === 'command') {
      return withError(['PROCESS'], node);
    }
    if (node.failed || node.error != null || `${node.status ?? ''}`.toLowerCase() === 'error') {
      return ['ERROR'];
    }
    return [];
  }
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
  const status = record.status.toLowerCase();
  if (status === 'error' || status === 'failed') {
    return [...classifyPreviewRecordBase(record), 'ERROR'];
  }
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
  return 'Codex';
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

function observationIdentity(record: PreviewRecord): {
  sessionId: string;
  generationId: string;
} | null {
  if (record.kind !== 'changes' || !record.rawRecord) return null;
  const window = record.rawRecord.observationWindow;
  if (!window || typeof window !== 'object' || Array.isArray(window)) return null;
  const observation = window as Record<string, unknown>;
  const sessionId = observation.sessionId;
  const generationId = observation.generationId;
  return typeof sessionId === 'string' && typeof generationId === 'string'
    ? { sessionId, generationId }
    : null;
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

function filterRecordsAfterBaseline(
  records: PreviewRecord[],
  baseline: Set<string>,
): PreviewRecord[] {
  return records.flatMap(record => {
    const children = 'children' in record
      ? filterRecordsAfterBaseline(record.children ?? [], baseline)
      : [];
    if (!baseline.has(record.id)) {
      return [{ ...record, ...('children' in record ? { children } : {}) } as PreviewRecord];
    }
    if (children.length > 0 && 'children' in record) {
      return [{ ...record, children } as PreviewRecord];
    }
    return [];
  });
}

function historyTimestamp(value: string | null): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}
