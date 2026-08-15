import * as React from 'react';
import { styled } from '../upstream/theme';
import { SplitPane } from '../upstream/SplitPane';
import type { SidebarPage } from '../upstream/Sidebar';
import { ActivityList } from './ActivityList';
import { AssetsPage } from './AssetsPage';
import { HistoryModal } from './HistoryModal';
import { Inspector } from './Inspector';
import { SourcesPage } from './SourcesPage';
import { previewRecords } from './fixtures';
import { useWorkbenchState } from './use-workbench-state';
import {
  buildObservableTurns,
  buildHistoryTurnSections,
  buildStandaloneRecords,
  createFixtureTurns,
  createLiveRange,
  observableTurnIdsForHistorySelection,
  recordsForLiveRange,
  recordsForView,
  type ObservableTurnSummary,
  type ViewRange,
} from './turn-model';
import type { PreviewRecord } from './types';
import type {
  ConversationDetails,
  ConversationHistoryResult,
  ConversationSummary,
  CreateTaskInput,
  CreateProjectAssetDraftInput,
  HistoryTurnSummary,
  ProjectAssetDocument,
  ProjectAssetDraft,
  ProjectAssetIndex,
  ProjectAssetResult,
  SaveTaskScriptInput,
  TaskRecord,
  TaskResult,
  TaskSummary,
  TrackedConversationSelection,
  WriteProjectAssetDraftInput,
  WorkbenchState,
} from './workbench-data';
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
    onStartLiveObservation={connection.startLiveObservation}
    onUseHistoryObservation={connection.useHistoryObservation}
    onListConversations={connection.listConversations}
    onReadConversation={connection.readConversation}
    onGetTrackedSelection={connection.getTrackedSelection}
    onSetTrackedSelection={connection.setTrackedSelection}
    onListTasks={connection.listTasks}
    onReadTask={connection.readTask}
    onCreateTask={connection.createTask}
    onDiscussTask={connection.discussTask}
    onSaveTaskScript={connection.saveTaskScript}
    taskUpdates={connection.taskUpdates}
    onListProjectAssets={connection.listProjectAssets}
    onReadProjectAsset={connection.readProjectAsset}
    onCreateProjectAssetDraft={connection.createProjectAssetDraft}
    onWriteProjectAssetDraft={connection.writeProjectAssetDraft}
    onInitializeProjectDocs={connection.initializeProjectDocs}
    onCreateProjectDocsFolder={connection.createProjectDocsFolder}
    onRenameProjectDocsFolder={connection.renameProjectDocsFolder}
    onTrashProjectDocsFolder={connection.trashProjectDocsFolder}
    onCreateProjectDocsDocument={connection.createProjectDocsDocument}
    onRenameProjectDocsDocument={connection.renameProjectDocsDocument}
    onTrashProjectDocsDocument={connection.trashProjectDocsDocument}
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
  onStartLiveObservation,
  onUseHistoryObservation,
  onListConversations,
  onReadConversation,
  onGetTrackedSelection,
  onSetTrackedSelection,
  onListTasks,
  onReadTask,
  onCreateTask,
  onDiscussTask,
  onSaveTaskScript,
  taskUpdates,
  onListProjectAssets,
  onReadProjectAsset,
  onCreateProjectAssetDraft,
  onWriteProjectAssetDraft,
  onInitializeProjectDocs,
  onCreateProjectDocsFolder,
  onRenameProjectDocsFolder,
  onTrashProjectDocsFolder,
  onCreateProjectDocsDocument,
  onRenameProjectDocsDocument,
  onTrashProjectDocsDocument,
}: {
  page: SidebarPage;
  turns: ObservableTurnSummary[];
  standaloneRecords: PreviewRecord[];
  projectRoot: string | null;
  workbenchState: WorkbenchState;
  loading: boolean;
  bridgeAvailable: boolean;
  onOpenProject?: () => Promise<WorkbenchState | null>;
  onStartLiveObservation(): Promise<WorkbenchState | null>;
  onUseHistoryObservation(): Promise<WorkbenchState | null>;
  onListConversations(projectRoot: string): Promise<ConversationHistoryResult<ConversationSummary[]>>;
  onReadConversation(projectRoot: string, conversationId: string): Promise<ConversationHistoryResult<ConversationDetails | null>>;
  onGetTrackedSelection(projectRoot: string | null): Promise<ConversationHistoryResult<TrackedConversationSelection>>;
  onSetTrackedSelection(projectRoot: string, conversationIds: string[]): Promise<ConversationHistoryResult<TrackedConversationSelection>>;
  onListTasks(projectRoot?: string | null): Promise<TaskResult<TaskSummary[]>>;
  onReadTask(taskId: string): Promise<TaskResult<TaskRecord | null>>;
  onCreateTask(input: CreateTaskInput): Promise<TaskResult<TaskRecord | null>>;
  onDiscussTask(taskId: string, message: string): Promise<TaskResult<TaskRecord | null>>;
  onSaveTaskScript(taskId: string, input: SaveTaskScriptInput): Promise<TaskResult<TaskRecord | null>>;
  taskUpdates: TaskSummary[];
  onListProjectAssets(projectRoot?: string | null): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  onReadProjectAsset(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetDocument | null>>;
  onCreateProjectAssetDraft(input: CreateProjectAssetDraftInput): Promise<ProjectAssetResult<ProjectAssetDraft | null>>;
  onWriteProjectAssetDraft(input: WriteProjectAssetDraftInput): Promise<ProjectAssetResult<ProjectAssetDocument | null>>;
  onInitializeProjectDocs(projectRoot: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  onCreateProjectDocsFolder(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  onRenameProjectDocsFolder(projectRoot: string, relativePath: string, nextName: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  onTrashProjectDocsFolder(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  onCreateProjectDocsDocument(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  onRenameProjectDocsDocument(projectRoot: string, relativePath: string, nextName: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  onTrashProjectDocsDocument(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
}) {
  const [range, setRange] = React.useState<ViewRange>(() => createLiveRange(turns, standaloneRecords));
  const [frozenRecords, setFrozenRecords] = React.useState<PreviewRecord[]>([]);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [modeChoiceOpen, setModeChoiceOpen] = React.useState(false);
  const [historySelection, setHistorySelection] = React.useState<HistoryTurnSummary[]>([]);
  const [trackedConversationIds, setTrackedConversationIds] = React.useState<string[]>([]);
  const trackingProjectRoot = React.useRef<string | null>(null);
  const promptedProjectRoot = React.useRef<string | null>(null);
  const [state, dispatch] = React.useReducer(
    (current: ReturnType<typeof createPreviewState>, action: PreviewAction) => reducePreviewState(current, action),
    recordsForView(turns, range.turnIds, standaloneRecords),
    createPreviewState,
  );
  const [width, setWidth] = React.useState(() => window.innerWidth);

  const liveRecords = React.useMemo(
    () => range.kind === 'live'
      ? recordsForLiveRange(turns, range, standaloneRecords)
      : range.kind === 'history' && range.turnIds.length === 0
        ? []
        : recordsForView(turns, range.turnIds, standaloneRecords, {
            includeRecordedChanges: range.kind === 'history',
          }),
    [turns, range, standaloneRecords],
  );
  const records = range.kind === 'paused' ? frozenRecords : liveRecords;

  React.useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  React.useEffect(() => {
    if (range.kind !== 'history') return;
    const turnIds = observableTurnIdsForHistorySelection(turns, historySelection);
    setRange(current => {
      if (current.kind !== 'history' || sameIds(current.turnIds, turnIds)) return current;
      return { kind: 'history', turnIds };
    });
  }, [turns, historySelection, range.kind]);

  React.useEffect(() => {
    dispatch({ type: 'reconcile-records', records });
  }, [records]);

  React.useEffect(() => {
    if (page !== 'view') setHistoryOpen(false);
  }, [page]);

  React.useEffect(() => {
    if (trackingProjectRoot.current !== projectRoot) {
      trackingProjectRoot.current = projectRoot;
      promptedProjectRoot.current = null;
    }
    let active = true;
    void onGetTrackedSelection(projectRoot).then(result => {
      if (!active) return;
      setTrackedConversationIds(result.data.conversationIds);
      if (result.status === 'ready' && projectRoot && promptedProjectRoot.current !== projectRoot) {
        promptedProjectRoot.current = projectRoot;
        setModeChoiceOpen(true);
      }
    });
    return () => { active = false; };
  }, [onGetTrackedSelection, projectRoot]);

  const following = range.kind === 'live';
  const rows = getVisibleRows(records, state);
  const selected = resolveSelectedRecord(records, state);
  React.useEffect(() => {
    if (rows.length > 0 && !rows.some(row => row.record.id === state.selectedId)) {
      const first = rows[0].record;
      dispatch({
        type: 'select-record',
        id: first.id,
        wideInspector: false,
      });
    }
  }, [rows, state.selectedId]);
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
    const refreshed = await onStartLiveObservation();
    const refreshedTurns = refreshed
      ? buildObservableTurns(refreshed)
      : turns;
    const refreshedStandalone = refreshed
      ? buildStandaloneRecords(refreshed)
      : standaloneRecords;
    setHistoryOpen(false);
    setHistorySelection([]);
    setFrozenRecords([]);
    dispatch({ type: 'set-query', query: '' });
    setRange(createLiveRange(refreshedTurns, refreshedStandalone));
  };

  const selectHistory = (selectedTurns: HistoryTurnSummary[]) => {
    const turnIds = observableTurnIdsForHistorySelection(turns, selectedTurns);
    setHistorySelection(selectedTurns);
    setFrozenRecords([]);
    dispatch({ type: 'set-query', query: '' });
    setRange({ kind: 'history', turnIds });
    if (selectedTurns.length > 0) void onUseHistoryObservation();
  };

  const historySections = React.useMemo(() => range.kind === 'history'
    ? buildHistoryTurnSections(turns, historySelection, standaloneRecords).map((section, index) => ({
        id: section.id,
        label: `Turn ${index + 1}`,
        userInput: section.userInput,
        startedAt: section.startedAt,
        status: section.status,
        rows: getVisibleRows(section.records, state),
      }))
    : undefined, [historySelection, range.kind, standaloneRecords, state, turns]);

  const chooseLive = async () => {
    setModeChoiceOpen(false);
    const refreshed = await onStartLiveObservation();
    const refreshedTurns = refreshed ? buildObservableTurns(refreshed) : turns;
    const refreshedStandalone = refreshed ? buildStandaloneRecords(refreshed) : standaloneRecords;
    setHistoryOpen(false);
    setHistorySelection([]);
    setFrozenRecords([]);
    dispatch({ type: 'set-query', query: '' });
    setRange(createLiveRange(refreshedTurns, refreshedStandalone));
  };

  const chooseHistory = async () => {
    setModeChoiceOpen(false);
    await onUseHistoryObservation();
    setHistorySelection([]);
    setFrozenRecords([]);
    dispatch({ type: 'set-query', query: '' });
    setRange({ kind: 'history', turnIds: [] });
    setHistoryOpen(true);
  };

  const updateTrackedConversations = async (selectionProjectRoot: string, conversationIds: string[]) => {
    const result = await onSetTrackedSelection(selectionProjectRoot, conversationIds);
    if (result.status !== 'ready') return result;
    setTrackedConversationIds(result.data.conversationIds);
    if (
      historySelection[0] &&
      !result.data.conversationIds.includes(historySelection[0].conversationId)
    ) {
      selectHistory([]);
    }
    return result;
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

  if (page === 'sources') return <SourcesPage state={workbenchState} />;
  if (page === 'library') return <AssetsPage
    projectRoot={projectRoot}
    listAssets={onListProjectAssets}
    readAsset={onReadProjectAsset}
    listTasks={onListTasks}
    taskUpdates={taskUpdates}
    readTask={onReadTask}
    discussTask={onDiscussTask}
    saveTaskScript={onSaveTaskScript}
    createDraft={onCreateProjectAssetDraft}
    writeDraft={onWriteProjectAssetDraft}
    initializeDocs={onInitializeProjectDocs}
    createFolder={onCreateProjectDocsFolder}
    renameFolder={onRenameProjectDocsFolder}
    trashFolder={onTrashProjectDocsFolder}
    createDocument={onCreateProjectDocsDocument}
    renameFile={onRenameProjectDocsDocument}
    trashFile={onTrashProjectDocsDocument}
  />;
  if (state.wideInspector) return <Page data-preview-mode="wide">{inspector}</Page>;

  const split = width >= 1100 ? 'vertical' : 'horizontal';
  const minSize = split === 'vertical' ? 360 : 210;
  return (
    <Page aria-label="Agent Workbench isolated UI preview" data-preview-mode="standard">
      <SplitPane split={split} primary="second" defaultSize="52%" minSize={minSize} maxSize={-minSize}>
        <ListPane>
          <ActivityList
            rows={rows}
            historySections={historySections}
            state={state}
            message={message}
            messageIsError={Boolean(workbenchState.error && records.length === 0)}
            projectRoot={projectRoot}
            following={following}
            viewMode={range.kind === 'history' ? 'historical' : range.kind === 'paused' ? 'paused' : 'live'}
            onSelected={id => {
              dispatch({
                type: 'select-record',
                id,
                wideInspector: false,
              });
            }}
            onToggle={id => dispatch({ type: 'toggle-operation', id })}
            onQuery={query => dispatch({ type: 'set-query', query })}
            onFocus={focus => dispatch({ type: 'set-focus', focus })}
            onOpenProject={onOpenProject ? () => { void onOpenProject(); } : undefined}
            onToggleFollowing={() => { void handleFollowing(); }}
            onHistory={() => { void onUseHistoryObservation().then(() => {
              setRange({ kind: 'history', turnIds: observableTurnIdsForHistorySelection(turns, historySelection) });
              setHistoryOpen(true);
            }); }}
          />
        </ListPane>
        {inspector}
      </SplitPane>
      {historyOpen ? <HistoryModal
        currentProjectRoot={projectRoot}
        selectedTurns={historySelection}
        listConversations={onListConversations}
        readConversation={onReadConversation}
        getTrackedSelection={onGetTrackedSelection}
        onTrackedConversations={updateTrackedConversations}
        createTask={onCreateTask}
        taskUpdates={taskUpdates}
        onSelected={selectHistory}
        onClose={() => setHistoryOpen(false)}
      /> : null}
      {modeChoiceOpen && projectRoot ? <ObservationModeDialog
        projectRoot={projectRoot}
        onLive={() => { void chooseLive(); }}
        onHistory={() => { void chooseHistory(); }}
      /> : null}
    </Page>
  );
}

const ModeOverlay = styled.div`
  position: fixed;
  z-index: 1500;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(30, 32, 40, 0.28);
`;

const ModeDialog = styled.section`
  width: min(520px, calc(100vw - 48px));
  padding: 22px;
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 4px;
  background: ${p => p.theme.mainBackground};
  box-shadow: 0 8px 36px rgba(0, 0, 0, 0.28);

  h2 { margin: 0; font: 600 20px ${p => p.theme.titleTextFamily}; }
  > p { margin: 7px 0 18px; color: ${p => p.theme.mainLowlightColor}; overflow-wrap: anywhere; }
  > div { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  button { min-height: 92px; padding: 13px; border: 1px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.mainLowlightBackground}; color: inherit; text-align: left; cursor: pointer; }
  button:hover, button:focus-visible { border-color: ${p => p.theme.highlightColor}; outline: none; }
  strong, span { display: block; }
  span { margin-top: 5px; color: ${p => p.theme.mainLowlightColor}; font-size: 12px; line-height: 1.4; }
`;

function ObservationModeDialog({ projectRoot, onLive, onHistory }: { projectRoot: string; onLive(): void; onHistory(): void }) {
  return <ModeOverlay role="presentation">
    <ModeDialog role="dialog" aria-modal="true" aria-labelledby="observation-mode-title" aria-describedby="observation-mode-description">
      <h2 id="observation-mode-title">Choose what to view</h2>
      <p id="observation-mode-description">{projectRoot}</p>
      <div>
        <button type="button" autoFocus onClick={onLive}><strong>Live</strong><span>Start empty and show only commands recorded from now on.</span></button>
        <button type="button" onClick={onHistory}><strong>History</strong><span>Select a conversation, then one or more turns.</span></button>
      </div>
    </ModeDialog>
  </ModeOverlay>;
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
    },
    fileBus: {
      status: 'watching',
      directory: 'F:\\agent-workbench\\.agent-workbench',
      lastRefreshAt: new Date().toISOString(),
      error: null,
    },
  };
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
