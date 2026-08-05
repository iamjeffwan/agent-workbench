import * as React from 'react';
import { styled } from '../upstream/theme';
import { SplitPane } from '../upstream/SplitPane';
import type { SidebarPage } from '../upstream/Sidebar';
import { ActivityList } from './ActivityList';
import { HistoryModal } from './HistoryModal';
import { Inspector } from './Inspector';
import { SourcesPage } from './SourcesPage';
import { previewRecords } from './fixtures';
import { useWorkbenchState } from './use-workbench-state';
import {
  buildObservableTurns,
  buildStandaloneRecords,
  createFixtureTurns,
  createLiveRange,
  extendLiveRange,
  recordsForView,
  type ObservableTurnSummary,
  type ViewRange,
} from './turn-model';
import type { PreviewRecord } from './types';
import type { WorkbenchState } from './workbench-data';
import {
  createPreviewState,
  getVisibleRows,
  reducePreviewState,
  resolveSelectedRecord,
  type PreviewAction,
} from './view-model';

const Page = styled.main`
  width: 100%;
  height: 100vh;
  min-width: 0;
  position: relative;
`;

const ListPane = styled.div`
  width: 100%;
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
`;

const emptyWorkbenchState: WorkbenchState = {
  projectRoot: null,
  turns: [],
  error: null,
  observation: null,
  adapters: {},
  sources: {},
  files: {},
  fileBus: { status: 'idle', directory: null, lastRefreshAt: null, error: null },
};

export function PreviewApp({ page }: { page: SidebarPage }) {
  const connection = useWorkbenchState();
  const workbenchState = connection.state ?? emptyWorkbenchState;
  const turns = React.useMemo(
    () => connection.bridgeAvailable
      ? buildObservableTurns(workbenchState)
      : createFixtureTurns(previewRecords),
    [connection.bridgeAvailable, workbenchState],
  );
  const projectRoot = connection.bridgeAvailable ? workbenchState.projectRoot : 'F:\\agent-workbench';
  const standaloneRecords = React.useMemo(
    () => connection.bridgeAvailable ? buildStandaloneRecords(workbenchState) : [],
    [connection.bridgeAvailable, workbenchState],
  );
  const projectKey = connection.bridgeAvailable ? projectRoot ?? 'no-project' : 'static-fixtures';

  return <PreviewWorkspace
    key={projectKey}
    page={page}
    turns={turns}
    standaloneRecords={standaloneRecords}
    projectRoot={projectRoot}
    workbenchState={connection.bridgeAvailable ? workbenchState : fixtureWorkbenchState()}
    loading={connection.loading}
    bridgeAvailable={connection.bridgeAvailable}
    onOpenProject={connection.bridgeAvailable ? connection.openProject : undefined}
    onRefresh={connection.refresh}
  />;
}

function PreviewWorkspace({
  page,
  turns,
  standaloneRecords,
  projectRoot,
  workbenchState,
  loading,
  bridgeAvailable,
  onOpenProject,
  onRefresh,
}: {
  page: SidebarPage;
  turns: ObservableTurnSummary[];
  standaloneRecords: PreviewRecord[];
  projectRoot: string | null;
  workbenchState: WorkbenchState;
  loading: boolean;
  bridgeAvailable: boolean;
  onOpenProject?: () => Promise<void>;
  onRefresh(): Promise<WorkbenchState | null>;
}) {
  const [range, setRange] = React.useState<ViewRange>(() => createLiveRange(turns));
  const [frozenRecords, setFrozenRecords] = React.useState<PreviewRecord[]>([]);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [state, dispatch] = React.useReducer(
    (current: ReturnType<typeof createPreviewState>, action: PreviewAction) => reducePreviewState(current, action),
    recordsForView(turns, range.turnIds, standaloneRecords),
    createPreviewState,
  );
  const [width, setWidth] = React.useState(() => window.innerWidth);

  const liveRecords = React.useMemo(
    () => recordsForView(turns, range.turnIds, standaloneRecords),
    [turns, range.turnIds, standaloneRecords],
  );
  const records = range.kind === 'paused' ? frozenRecords : liveRecords;

  React.useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  React.useEffect(() => {
    if (range.kind !== 'live') return;
    setRange(current => current.kind === 'live' ? extendLiveRange(current, turns) : current);
  }, [turns]);

  React.useEffect(() => {
    dispatch({ type: 'reconcile-records', records });
  }, [records]);

  React.useEffect(() => {
    if (page !== 'view') setHistoryOpen(false);
  }, [page]);

  const following = range.kind === 'live';
  const rows = getVisibleRows(records, state);
  const selected = resolveSelectedRecord(records, state);
  React.useEffect(() => {
    if (rows.length > 0 && !rows.some(row => row.record.id === state.selectedId)) {
      dispatch({ type: 'select-record', id: rows[0].record.id });
    }
  }, [rows, state.selectedId]);
  if (page === 'sources') return <SourcesPage state={workbenchState} />;
  const message = loading
    ? 'Loading project activity...'
    : workbenchState.error && records.length === 0
      ? workbenchState.error
      : bridgeAvailable && !projectRoot
        ? 'Open a project using the project button below.'
        : records.length === 0 && following
          ? 'Waiting for observable agent activity...'
          : records.length === 0
            ? 'No observable activity is selected.'
            : undefined;

  const handleFollowing = async () => {
    if (following) {
      setFrozenRecords(records);
      setRange({ kind: 'paused', turnIds: range.turnIds });
      return;
    }
    const refreshed = await onRefresh();
    const refreshedTurns = refreshed
      ? buildObservableTurns(refreshed)
      : turns;
    setHistoryOpen(false);
    setFrozenRecords([]);
    dispatch({ type: 'set-query', query: '' });
    setRange(createLiveRange(refreshedTurns));
  };

  const selectHistory = (turnIds: string[]) => {
    setFrozenRecords([]);
    dispatch({ type: 'set-query', query: '' });
    setRange({ kind: 'history', turnIds });
  };

  const inspector = (
    <Inspector
      record={selected}
      diffLayout={state.diffLayout}
      focusedChangedPath={state.focusedChangedPath}
      sourceModalPath={state.sourceModalPath}
      onDiffLayout={layout => dispatch({ type: 'set-diff-layout', layout })}
      onProjectFile={(path, changed) => dispatch({ type: 'open-project-file', path, changed })}
      onCloseSource={() => dispatch({ type: 'close-source' })}
    />
  );

  if (state.wideInspector) return <Page data-preview-mode="wide">{inspector}</Page>;

  const split = width >= 1100 ? 'vertical' : 'horizontal';
  const minSize = split === 'vertical' ? 360 : 210;
  return (
    <Page aria-label="Agent Workbench isolated UI preview" data-preview-mode="standard">
      <SplitPane split={split} primary="second" defaultSize="52%" minSize={minSize} maxSize={-minSize}>
        <ListPane>
          <ActivityList
            rows={rows}
            state={state}
            message={message}
            messageIsError={Boolean(workbenchState.error && records.length === 0)}
            projectRoot={projectRoot}
            following={following}
            onSelected={id => dispatch({ type: 'select-record', id })}
            onToggle={id => dispatch({ type: 'toggle-operation', id })}
            onQuery={query => dispatch({ type: 'set-query', query })}
            onFocus={focus => dispatch({ type: 'set-focus', focus })}
            onOpenProject={onOpenProject ? () => { void onOpenProject(); } : undefined}
            onToggleFollowing={() => { void handleFollowing(); }}
            onHistory={() => setHistoryOpen(true)}
          />
        </ListPane>
        {inspector}
      </SplitPane>
      {historyOpen ? <HistoryModal
        turns={turns}
        selectedTurnIds={range.turnIds}
        onSelected={selectHistory}
        onClose={() => setHistoryOpen(false)}
      /> : null}
    </Page>
  );
}

function fixtureWorkbenchState(): WorkbenchState {
  return {
    ...emptyWorkbenchState,
    projectRoot: 'F:\\agent-workbench',
    observation: { installed: true },
    adapters: {
      codex: { status: 'ready', stepCount: 14, sessionCount: 2, lastSyncAt: new Date().toISOString() },
      cursor: { status: 'ready', stepCount: 8, lastEventAt: new Date(Date.now() - 45_000).toISOString() },
    },
    sources: {
      codex: { sourceRecords: 14, assignedToTurn: 14, assignedToProject: 14, normalized: 14, rendered: 9, hidden: 5, unknown: 0, invalid: 0 },
      cursor: { sourceRecords: 8, assignedToTurn: 8, assignedToProject: 8, normalized: 8, rendered: 6, hidden: 2, unknown: 0, invalid: 0 },
    },
    files: {
      agentSteps: 'F:\\agent-workbench\\.agent-workbench\\agent-steps.jsonl',
      codexAgentSteps: 'F:\\agent-workbench\\.agent-workbench\\codex-agent-steps.jsonl',
    },
    fileBus: {
      status: 'watching',
      directory: 'F:\\agent-workbench\\.agent-workbench',
      lastRefreshAt: new Date().toISOString(),
      error: null,
    },
  };
}
