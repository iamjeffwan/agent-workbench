export type DiffLayout = 'unified' | 'split';
export type ActivityFocus = 'all' | 'agent' | 'runtime' | 'tests' | 'changes' | 'errors';

export interface RecordShape {
  id: string;
  kind: string;
  method?: string;
  status?: string;
  children?: RecordShape[];
}

export interface PreviewState {
  selectedId?: string;
  expandedOperationIds: string[];
  diffLayout: DiffLayout;
  wideInspector: boolean;
  focusedChangedPath?: string;
  sourceModalPath?: string;
  query: string;
  focus: ActivityFocus;
  knownTopLevelIds: string[];
}

export type PreviewAction =
  | { type: 'select-record'; id: string }
  | { type: 'toggle-operation'; id: string }
  | { type: 'set-diff-layout'; layout: DiffLayout }
  | { type: 'open-project-file'; path: string; changed: boolean }
  | { type: 'close-source' }
  | { type: 'set-query'; query: string }
  | { type: 'set-focus'; focus: ActivityFocus }
  | { type: 'reconcile-records'; records: RecordShape[] };

export interface VisibleRow<T extends RecordShape = RecordShape> {
  record: T;
  depth: number;
}

export interface RowSpacing {
  top: 0 | 2;
  bottom: 0 | 2;
}

export function getRowHeight(row: VisibleRow | undefined): 34 | 43 {
  return row && row.depth === 0 && row.record.kind === 'operation' ? 43 : 34;
}

export function getRowSpacing<T extends RecordShape>(
  rows: VisibleRow<T>[],
  index: number,
): RowSpacing {
  const current = rows[index];
  if (!current || current.depth === 0) return { top: 0, bottom: 0 };
  return { top: 2, bottom: 2 };
}

function flattenRecords<T extends RecordShape>(records: T[]): T[] {
  return records.flatMap(record => [
    record,
    ...flattenRecords((record.children ?? []) as T[]),
  ]);
}

export function createPreviewState(records: RecordShape[]): PreviewState {
  return {
    selectedId: records[0]?.id,
    expandedOperationIds: records
      .filter(record => record.kind === 'operation' && record.children?.length)
      .map(record => record.id),
    diffLayout: 'unified',
    wideInspector: false,
    query: '',
    focus: 'all',
    knownTopLevelIds: records.map(record => record.id),
  };
}

export function getVisibleRows<T extends RecordShape>(records: T[], state: PreviewState): VisibleRow<T>[] {
  const query = state.query.trim().toLowerCase();
  const rows: VisibleRow<T>[] = [];

  if (state.focus !== 'all') {
    appendFocused(rows, records, 0, query, state.focus);
    return rows;
  }

  for (const record of records) {
    if (!query || recordMatches(record, query)) {
      rows.push({ record, depth: 0 });
      if (state.expandedOperationIds.includes(record.id)) {
        appendChildren(rows, (record.children ?? []) as T[], 1, query);
      }
    }
  }

  return rows;
}

export function resolveSelectedRecord<T extends RecordShape>(records: T[], state: PreviewState): T | undefined {
  return flattenRecords(records).find(record => record.id === state.selectedId);
}

export function reducePreviewState(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case 'select-record':
      return {
        ...state,
        selectedId: action.id,
        wideInspector: false,
        diffLayout: 'unified',
        sourceModalPath: undefined,
      };
    case 'toggle-operation':
      return state.expandedOperationIds.includes(action.id)
        ? { ...state, expandedOperationIds: state.expandedOperationIds.filter(id => id !== action.id) }
        : { ...state, expandedOperationIds: [...state.expandedOperationIds, action.id] };
    case 'set-diff-layout':
      return { ...state, diffLayout: action.layout, wideInspector: action.layout === 'split' };
    case 'open-project-file':
      return action.changed
        ? { ...state, focusedChangedPath: action.path, sourceModalPath: undefined }
        : { ...state, sourceModalPath: action.path };
    case 'close-source':
      return { ...state, sourceModalPath: undefined };
    case 'set-query':
      return { ...state, query: action.query };
    case 'set-focus':
      return { ...state, focus: action.focus, wideInspector: false, sourceModalPath: undefined };
    case 'reconcile-records': {
      const ids = new Set(flattenRecords(action.records).map(record => record.id));
      const known = new Set(state.knownTopLevelIds);
      const expandedOperationIds = [
        ...state.expandedOperationIds.filter(id => ids.has(id)),
        ...action.records
          .filter(record => !known.has(record.id) && record.kind === 'operation' && record.children?.length)
          .map(record => record.id),
      ];
      return {
        ...state,
        selectedId: ids.has(state.selectedId ?? '') ? state.selectedId : action.records[0]?.id,
        expandedOperationIds: [...new Set(expandedOperationIds)],
        knownTopLevelIds: action.records.map(record => record.id),
        wideInspector: ids.has(state.selectedId ?? '') ? state.wideInspector : false,
        diffLayout: ids.has(state.selectedId ?? '') ? state.diffLayout : 'unified',
        sourceModalPath: ids.has(state.selectedId ?? '') ? state.sourceModalPath : undefined,
      };
    }
  }
}

function appendFocused<T extends RecordShape>(
  rows: VisibleRow<T>[],
  records: T[],
  depth: number,
  query: string,
  focus: ActivityFocus,
) {
  for (const record of records) {
    const matches = matchesFocus(record, focus) && (!query || recordMatches(record, query));
    if (matches) rows.push({ record, depth });
    appendFocused(
      rows,
      (record.children ?? []) as T[],
      matches ? depth + 1 : depth,
      query,
      focus,
    );
  }
}

function matchesFocus(record: RecordShape, focus: ActivityFocus): boolean {
  if (focus === 'agent') return record.kind === 'operation' || record.kind === 'action';
  if (focus === 'runtime') return record.kind === 'call' || record.kind === 'network';
  if (focus === 'tests') return ['TEST', 'BUILD', 'LINT'].includes(record.method ?? '');
  if (focus === 'changes') return record.kind === 'changes';
  if (focus === 'errors') return record.status === 'ERROR';
  return true;
}

function recordMatches(record: RecordShape, query: string): boolean {
  if (JSON.stringify({ ...record, children: undefined }).toLowerCase().includes(query)) return true;
  return (record.children ?? []).some(child => recordMatches(child, query));
}

function appendChildren<T extends RecordShape>(
  rows: VisibleRow<T>[],
  children: T[],
  depth: number,
  query: string,
) {
  for (const child of children) {
    if (query && !recordMatches(child, query)) continue;
    rows.push({ record: child, depth });
    appendChildren(rows, (child.children ?? []) as T[], depth + 1, query);
  }
}
