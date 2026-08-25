import * as React from 'react';
import type {
  SessionDetails,
  SessionHistoryResult,
  SessionProjectSummary,
  SessionSummary,
  CreateTaskInput,
  CreateProjectAssetDraftInput,
  DailyReviewScheduleState,
  ProjectAssetDocument,
  ProjectAssetDraft,
  ProjectAssetIndex,
  ProjectAssetResult,
  PublishRepositoryInput,
  RepositoryResult,
  RepositoryStatus,
  ReviewAnnotationInput,
  ReviewChangeEvent,
  ReviewEvidenceResolution,
  ReviewRecord,
  ReviewResult,
  ReviewStartInput,
  ReviewSummary,
  TemporaryPrompt,
  SaveTaskScriptInput,
  SyncResult,
  SyncTaskManifest,
  SyncTaskRecord,
  TaskRecord,
  TaskResult,
  TaskChangeEvent,
  TaskSummary,
  TrackedSessionSelection,
  WriteProjectAssetDraftInput,
  WorkbenchState,
} from './workbench-data';

export interface WorkbenchConnection {
  state: WorkbenchState | null;
  loading: boolean;
  bridgeAvailable: boolean;
  openProject(): Promise<WorkbenchState | null>;
  refresh(): Promise<WorkbenchState | null>;
  startLiveObservation(): Promise<WorkbenchState | null>;
  useHistoryObservation(): Promise<WorkbenchState | null>;
  listSessionProjects(): Promise<SessionHistoryResult<SessionProjectSummary[]>>;
  listSessions(projectRoot: string): Promise<SessionHistoryResult<SessionSummary[]>>;
  readSession(projectRoot: string, sessionId: string): Promise<SessionHistoryResult<SessionDetails | null>>;
  getTrackedSelection(projectRoot: string | null): Promise<SessionHistoryResult<TrackedSessionSelection>>;
  setTrackedSelection(projectRoot: string, sessionIds: string[]): Promise<SessionHistoryResult<TrackedSessionSelection>>;
  listTasks(projectRoot?: string | null): Promise<TaskResult<TaskSummary[]>>;
  readTask(taskId: string): Promise<TaskResult<TaskRecord | null>>;
  createTask(input: CreateTaskInput): Promise<TaskResult<TaskRecord | null>>;
  discussTask(taskId: string, message: string): Promise<TaskResult<TaskRecord | null>>;
  saveTaskScript(taskId: string, input: SaveTaskScriptInput): Promise<TaskResult<TaskRecord | null>>;
  startReview(input: ReviewStartInput): Promise<ReviewResult<{ caseId: string } | null>>;
  listReviews(projectRoot?: string | null): Promise<ReviewResult<ReviewSummary[]>>;
  getReview(projectRoot: string | null, caseId: string): Promise<ReviewResult<ReviewRecord | null>>;
  resolveReviewEvidence(projectRoot: string | null, caseId: string, evidenceId: string): Promise<ReviewResult<ReviewEvidenceResolution | null>>;
  appendReviewAnnotation(projectRoot: string | null, input: ReviewAnnotationInput): Promise<ReviewResult<ReviewRecord | null>>;
  listTemporaryPrompts(projectRoot?: string | null): Promise<ReviewResult<TemporaryPrompt[]>>;
  hideTemporaryPrompt(projectRoot: string | null, promptId: string): Promise<ReviewResult<TemporaryPrompt | null>>;
  dailyReviewSchedule: DailyReviewScheduleState | null;
  runPendingDailyReview(projectRoot: string, localDate: string): Promise<ReviewResult<null>>;
  snoozeDailyReview(projectRoot: string, localDate: string): Promise<DailyReviewScheduleState>;
  listSyncTasks(projectRoot?: string | null): Promise<SyncResult<SyncTaskManifest[]>>;
  readSyncTask(projectRoot: string, taskId: string): Promise<SyncResult<SyncTaskRecord | null>>;
  addTaskToSync(taskId: string): Promise<SyncResult<SyncTaskManifest | null>>;
  getRepositoryStatus(projectRoot?: string | null): Promise<RepositoryResult<RepositoryStatus | null>>;
  pullRepository(projectRoot?: string | null): Promise<RepositoryResult<RepositoryStatus | null>>;
  publishRepository(input: PublishRepositoryInput): Promise<RepositoryResult<RepositoryStatus | null>>;
  createGithubRepository(input: { projectRoot: string; name: string; privateRepository?: boolean }): Promise<RepositoryResult<RepositoryStatus | null>>;
  taskUpdates: TaskSummary[];
  taskActivities: TaskChangeEvent[];
  reviewUpdates: ReviewChangeEvent[];
  listProjectAssets(projectRoot?: string | null): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  readProjectAsset(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetDocument | null>>;
  createProjectAssetDraft(input: CreateProjectAssetDraftInput): Promise<ProjectAssetResult<ProjectAssetDraft | null>>;
  writeProjectAssetDraft(input: WriteProjectAssetDraftInput): Promise<ProjectAssetResult<ProjectAssetDocument | null>>;
  initializeProjectDocs(projectRoot: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  createProjectDocsFolder(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  renameProjectDocsFolder(projectRoot: string, relativePath: string, nextName: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  trashProjectDocsFolder(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  createProjectDocsDocument(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  renameProjectDocsDocument(projectRoot: string, relativePath: string, nextName: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  trashProjectDocsDocument(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
}

export function useWorkbenchState(): WorkbenchConnection {
  const bridge = window.workbench;
  const [state, setState] = React.useState<WorkbenchState | null>(null);
  const [loading, setLoading] = React.useState(Boolean(bridge));
  const [taskUpdates, setTaskUpdates] = React.useState<TaskSummary[]>([]);
  const [taskActivities, setTaskActivities] = React.useState<TaskChangeEvent[]>([]);
  const [reviewUpdates, setReviewUpdates] = React.useState<ReviewChangeEvent[]>([]);
  const [dailyReviewSchedule, setDailyReviewSchedule] = React.useState<DailyReviewScheduleState | null>(null);

  React.useEffect(() => {
    if (!bridge) return;
    let active = true;
    const unsubscribe = bridge.onState(next => {
      if (active) {
        setState(next);
        setLoading(false);
      }
    });
    void bridge.getState()
      .then(next => {
        if (active) setState(next);
      })
      .catch(error => {
        if (!active) return;
        setState(emptyState(error instanceof Error ? error.message : 'Unable to read project state.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    void bridge.getDailyReviewState().then(setDailyReviewSchedule).catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  React.useEffect(() => bridge?.onDailyReviewChanged(change => setDailyReviewSchedule(change)), [bridge]);

  React.useEffect(() => bridge?.onTaskChanged(change => {
    setTaskUpdates(current => [change.task, ...current.filter(item => item.id !== change.task.id)]);
    if (change.reason.startsWith('generation-')) {
      setTaskActivities(current => [change, ...current.filter(item => item.task.id !== change.task.id)]);
    }
  }), [bridge]);

  React.useEffect(() => bridge?.onReviewChanged(change => {
    setReviewUpdates(current => [change, ...current.filter(item => item.caseId !== change.caseId || item.state !== change.state)]);
  }), [bridge]);

  const openProject = React.useCallback(async () => {
    if (!bridge) return state;
    setLoading(true);
    try {
      const next = await bridge.openProject();
      setState(next);
      return next;
    } catch (error) {
      setState(current => ({
        ...(current ?? emptyState(null)),
        error: error instanceof Error ? error.message : 'Unable to open the project.',
      }));
      return null;
    } finally {
      setLoading(false);
    }
  }, [bridge, state]);

  const refresh = React.useCallback(async () => {
    if (!bridge) return state;
    setLoading(true);
    try {
      const next = await bridge.refresh();
      setState(next);
      return next;
    } catch (error) {
      setState(current => ({
        ...(current ?? emptyState(null)),
        error: error instanceof Error ? error.message : 'Unable to refresh project activity.',
      }));
      return null;
    } finally {
      setLoading(false);
    }
  }, [bridge, state]);

  const selectObservationMode = React.useCallback(async (mode: 'live' | 'history') => {
    if (!bridge) return state;
    setLoading(true);
    try {
      const next = mode === 'live'
        ? await bridge.startLiveObservation()
        : await bridge.useHistoryObservation();
      setState(next);
      return next;
    } catch (error) {
      setState(current => ({
        ...(current ?? emptyState(null)),
        error: error instanceof Error ? error.message : 'Unable to select the observation mode.',
      }));
      return null;
    } finally {
      setLoading(false);
    }
  }, [bridge, state]);

  const listSessionProjects = React.useCallback(async () => {
    if (!bridge) return unavailableHistory<SessionProjectSummary[]>([]);
    try {
      return await bridge.listSessionProjects();
    } catch (error) {
      return failedHistory<SessionProjectSummary[]>(error, []);
    }
  }, [bridge]);

  const listSessions = React.useCallback(async (projectRoot: string) => {
    if (!bridge) return unavailableHistory<SessionSummary[]>([]);
    try {
      return await bridge.listSessions(projectRoot);
    } catch (error) {
      return failedHistory<SessionSummary[]>(error, []);
    }
  }, [bridge]);

  const readSession = React.useCallback(async (projectRoot: string, sessionId: string) => {
    if (!bridge) return unavailableHistory<SessionDetails | null>(null);
    try {
      return await bridge.readSession(projectRoot, sessionId);
    } catch (error) {
      return failedHistory<SessionDetails | null>(error, null);
    }
  }, [bridge]);

  const getTrackedSelection = React.useCallback(async (projectRoot: string | null) => {
    if (!bridge) return unavailableHistory<TrackedSessionSelection>({ projectRoot: null, sessionIds: [] });
    try {
      return await bridge.getTrackedSelection(projectRoot);
    } catch (error) {
      return failedHistory<TrackedSessionSelection>(error, { projectRoot: null, sessionIds: [] });
    }
  }, [bridge]);

  const setTrackedSelection = React.useCallback(async (projectRoot: string, sessionIds: string[]) => {
    if (!bridge) return unavailableHistory<TrackedSessionSelection>({ projectRoot: null, sessionIds: [] });
    try {
      return await bridge.setTrackedSelection(projectRoot, sessionIds);
    } catch (error) {
      return failedHistory<TrackedSessionSelection>(error, { projectRoot: null, sessionIds: [] });
    }
  }, [bridge]);

  const listTasks = React.useCallback(async (projectRoot?: string | null) => {
    if (!bridge) return unavailableTask<TaskSummary[]>([]);
    try {
      return await bridge.listTasks(projectRoot);
    } catch (error) {
      return failedTask<TaskSummary[]>(error, []);
    }
  }, [bridge]);

  const readTask = React.useCallback(async (taskId: string) => {
    if (!bridge) return unavailableTask<TaskRecord | null>(null);
    try {
      return await bridge.readTask(taskId);
    } catch (error) {
      return failedTask<TaskRecord | null>(error, null);
    }
  }, [bridge]);

  const createTask = React.useCallback(async (input: CreateTaskInput) => {
    if (!bridge) return unavailableTask<TaskRecord | null>(null);
    try {
      return await bridge.createTask(input);
    } catch (error) {
      return failedTask<TaskRecord | null>(error, null);
    }
  }, [bridge]);

  const discussTask = React.useCallback(async (taskId: string, message: string) => {
    if (!bridge) return unavailableTask<TaskRecord | null>(null);
    try { return await bridge.discussTask(taskId, message); }
    catch (error) { return failedTask<TaskRecord | null>(error, null); }
  }, [bridge]);

  const saveTaskScript = React.useCallback(async (taskId: string, input: SaveTaskScriptInput) => {
    if (!bridge) return unavailableTask<TaskRecord | null>(null);
    try { return await bridge.saveTaskScript(taskId, input); }
    catch (error) { return failedTask<TaskRecord | null>(error, null); }
  }, [bridge]);

  const startReview = React.useCallback(async (input: ReviewStartInput) => {
    if (!bridge) return unavailableReview<{ caseId: string } | null>(null);
    try { return await bridge.startReview(input); }
    catch (error) { return failedReview<{ caseId: string } | null>(error, null); }
  }, [bridge]);

  const listReviews = React.useCallback(async (projectRoot?: string | null) => {
    if (!bridge) return unavailableReview<ReviewSummary[]>([]);
    try { return await bridge.listReviews(projectRoot); }
    catch (error) { return failedReview<ReviewSummary[]>(error, []); }
  }, [bridge]);

  const getReview = React.useCallback(async (projectRoot: string | null, caseId: string) => {
    if (!bridge) return unavailableReview<ReviewRecord | null>(null);
    try { return await bridge.getReview(projectRoot, caseId); }
    catch (error) { return failedReview<ReviewRecord | null>(error, null); }
  }, [bridge]);

  const resolveReviewEvidence = React.useCallback(async (projectRoot: string | null, caseId: string, evidenceId: string) => {
    if (!bridge) return unavailableReview<ReviewEvidenceResolution | null>(null);
    try { return await bridge.resolveReviewEvidence(projectRoot, caseId, evidenceId); }
    catch (error) { return failedReview<ReviewEvidenceResolution | null>(error, null); }
  }, [bridge]);

  const appendReviewAnnotation = React.useCallback(async (projectRoot: string | null, input: ReviewAnnotationInput) => {
    if (!bridge) return unavailableReview<ReviewRecord | null>(null);
    try { return await bridge.appendReviewAnnotation(projectRoot, input); }
    catch (error) { return failedReview<ReviewRecord | null>(error, null); }
  }, [bridge]);

  const listTemporaryPrompts = React.useCallback(async (projectRoot?: string | null) => {
    if (!bridge) return unavailableReview<TemporaryPrompt[]>([]);
    try { return await bridge.listTemporaryPrompts(projectRoot); }
    catch (error) { return failedReview<TemporaryPrompt[]>(error, []); }
  }, [bridge]);

  const hideTemporaryPrompt = React.useCallback(async (projectRoot: string | null, promptId: string) => {
    if (!bridge) return unavailableReview<TemporaryPrompt | null>(null);
    try { return await bridge.hideTemporaryPrompt(projectRoot, promptId); }
    catch (error) { return failedReview<TemporaryPrompt | null>(error, null); }
  }, [bridge]);

  const runPendingDailyReview = React.useCallback(async (projectRoot: string, localDate: string) => {
    if (!bridge) return unavailableReview<null>(null);
    try { return await bridge.runPendingDailyReview(projectRoot, localDate); }
    catch (error) { return failedReview<null>(error, null); }
  }, [bridge]);

  const snoozeDailyReview = React.useCallback(async (projectRoot: string, localDate: string) => {
    if (!bridge) return dailyReviewSchedule ?? { version: 1, started: false, projects: [], reminders: [] };
    try {
      const next = await bridge.snoozeDailyReview(projectRoot, localDate);
      setDailyReviewSchedule(next);
      return next;
    } catch {
      return dailyReviewSchedule ?? { version: 1, started: false, projects: [], reminders: [] };
    }
  }, [bridge, dailyReviewSchedule]);

  const listSyncTasks = React.useCallback(async (projectRoot?: string | null) => {
    if (!bridge) return unavailableSync<SyncTaskManifest[]>([]);
    try { return await bridge.listSyncTasks(projectRoot); }
    catch (error) { return failedSync<SyncTaskManifest[]>(error, []); }
  }, [bridge]);

  const readSyncTask = React.useCallback(async (projectRoot: string, taskId: string) => {
    if (!bridge) return unavailableSync<SyncTaskRecord | null>(null);
    try { return await bridge.readSyncTask(projectRoot, taskId); }
    catch (error) { return failedSync<SyncTaskRecord | null>(error, null); }
  }, [bridge]);

  const addTaskToSync = React.useCallback(async (taskId: string) => {
    if (!bridge) return unavailableSync<SyncTaskManifest | null>(null);
    try { return await bridge.addTaskToSync(taskId); }
    catch (error) { return failedSync<SyncTaskManifest | null>(error, null); }
  }, [bridge]);

  const getRepositoryStatus = React.useCallback(async (projectRoot?: string | null) => {
    if (!bridge) return unavailableSync<RepositoryStatus | null>(null);
    try { return await bridge.getRepositoryStatus(projectRoot); }
    catch (error) { return failedSync<RepositoryStatus | null>(error, null); }
  }, [bridge]);

  const pullRepository = React.useCallback(async (projectRoot?: string | null) => {
    if (!bridge) return unavailableSync<RepositoryStatus | null>(null);
    try { return await bridge.pullRepository(projectRoot); }
    catch (error) { return failedSync<RepositoryStatus | null>(error, null); }
  }, [bridge]);

  const publishRepository = React.useCallback(async (input: PublishRepositoryInput) => {
    if (!bridge) return unavailableSync<RepositoryStatus | null>(null);
    try { return await bridge.publishRepository(input); }
    catch (error) { return failedSync<RepositoryStatus | null>(error, null); }
  }, [bridge]);

  const createGithubRepository = React.useCallback(async (input: { projectRoot: string; name: string; privateRepository?: boolean }) => {
    if (!bridge) return unavailableSync<RepositoryStatus | null>(null);
    try { return await bridge.createGithubRepository(input); }
    catch (error) { return failedSync<RepositoryStatus | null>(error, null); }
  }, [bridge]);

  const listProjectAssets = React.useCallback(async (projectRoot?: string | null) => {
    if (!bridge) return unavailableAsset<ProjectAssetIndex | null>(null);
    try { return await bridge.listProjectAssets(projectRoot); }
    catch (error) { return failedAsset<ProjectAssetIndex | null>(error, null); }
  }, [bridge]);

  const readProjectAsset = React.useCallback(async (projectRoot: string, relativePath: string) => {
    if (!bridge) return unavailableAsset<ProjectAssetDocument | null>(null);
    try { return await bridge.readProjectAsset(projectRoot, relativePath); }
    catch (error) { return failedAsset<ProjectAssetDocument | null>(error, null); }
  }, [bridge]);

  const createProjectAssetDraft = React.useCallback(async (input: CreateProjectAssetDraftInput) => {
    if (!bridge) return unavailableAsset<ProjectAssetDraft | null>(null);
    try { return await bridge.createProjectAssetDraft(input); }
    catch (error) { return failedAsset<ProjectAssetDraft | null>(error, null); }
  }, [bridge]);

  const writeProjectAssetDraft = React.useCallback(async (input: WriteProjectAssetDraftInput) => {
    if (!bridge) return unavailableAsset<ProjectAssetDocument | null>(null);
    try { return await bridge.writeProjectAssetDraft(input); }
    catch (error) { return failedAsset<ProjectAssetDocument | null>(error, null); }
  }, [bridge]);

  const docsMutation = React.useCallback(async (
    action: 'initialize' | 'create-folder' | 'rename-folder' | 'trash-folder' | 'create-document' | 'rename-document' | 'trash-document',
    projectRoot: string,
    first?: string,
    second?: string,
  ) => {
    if (!bridge) return unavailableAsset<ProjectAssetIndex | null>(null);
    try {
      if (action === 'initialize') return await bridge.initializeProjectDocs(projectRoot);
      if (action === 'create-folder') return await bridge.createProjectDocsFolder(projectRoot, first ?? '');
      if (action === 'rename-folder') return await bridge.renameProjectDocsFolder(projectRoot, first ?? '', second ?? '');
      if (action === 'trash-folder') return await bridge.trashProjectDocsFolder(projectRoot, first ?? '');
      if (action === 'create-document') return await bridge.createProjectDocsDocument(projectRoot, first ?? '');
      if (action === 'rename-document') return await bridge.renameProjectDocsDocument(projectRoot, first ?? '', second ?? '');
      return await bridge.trashProjectDocsDocument(projectRoot, first ?? '');
    } catch (error) { return failedAsset<ProjectAssetIndex | null>(error, null); }
  }, [bridge]);

  return {
    state,
    loading,
    bridgeAvailable: Boolean(bridge),
    openProject,
    refresh,
    startLiveObservation: () => selectObservationMode('live'),
    useHistoryObservation: () => selectObservationMode('history'),
    listSessionProjects,
    listSessions,
    readSession,
    getTrackedSelection,
    setTrackedSelection,
    listTasks,
    readTask,
    createTask,
    discussTask,
    saveTaskScript,
    startReview,
    listReviews,
    getReview,
    resolveReviewEvidence,
    appendReviewAnnotation,
    listTemporaryPrompts,
    hideTemporaryPrompt,
    dailyReviewSchedule,
    runPendingDailyReview,
    snoozeDailyReview,
    listSyncTasks,
    readSyncTask,
    addTaskToSync,
    getRepositoryStatus,
    pullRepository,
    publishRepository,
    createGithubRepository,
    taskUpdates,
    taskActivities,
    reviewUpdates,
    listProjectAssets,
    readProjectAsset,
    createProjectAssetDraft,
    writeProjectAssetDraft,
    initializeProjectDocs: (root) => docsMutation('initialize', root),
    createProjectDocsFolder: (root, target) => docsMutation('create-folder', root, target),
    renameProjectDocsFolder: (root, target, name) => docsMutation('rename-folder', root, target, name),
    trashProjectDocsFolder: (root, target) => docsMutation('trash-folder', root, target),
    createProjectDocsDocument: (root, target) => docsMutation('create-document', root, target),
    renameProjectDocsDocument: (root, target, name) => docsMutation('rename-document', root, target, name),
    trashProjectDocsDocument: (root, target) => docsMutation('trash-document', root, target),
  };
}

function unavailableAsset<T>(data: T): ProjectAssetResult<T> {
  return { status: 'error', source: 'workbench-assets', data, error: 'Project assets are unavailable in the static preview.' };
}

function failedAsset<T>(error: unknown, data: T): ProjectAssetResult<T> {
  return { status: 'error', source: 'workbench-assets', data, error: error instanceof Error ? error.message : 'Unable to use project assets.' };
}

function unavailableHistory<T>(data: T): SessionHistoryResult<T> {
  return {
    status: 'unavailable',
    source: 'codex-rollout',
    data,
    error: 'Session history is unavailable in the static preview.',
  };
}

function failedHistory<T>(error: unknown, data: T): SessionHistoryResult<T> {
  return {
    status: 'error',
    source: 'codex-rollout',
    data,
    error: error instanceof Error ? error.message : 'Unable to read session history.',
  };
}

function unavailableTask<T>(data: T): TaskResult<T> {
  return {
    status: 'error',
    source: 'workbench-task',
    data,
    error: 'Tasks are unavailable in the static preview.',
  };
}

function failedTask<T>(error: unknown, data: T): TaskResult<T> {
  return {
    status: 'error',
    source: 'workbench-task',
    data,
    error: error instanceof Error ? error.message : 'Unable to read tasks.',
  };
}

function unavailableReview<T>(data: T): ReviewResult<T> {
  return { status: 'error', source: 'workbench-review', data, error: 'Reviews are unavailable in the static preview.' };
}

function failedReview<T>(error: unknown, data: T): ReviewResult<T> {
  return { status: 'error', source: 'workbench-review', data, error: error instanceof Error ? error.message : 'Unable to use reviews.' };
}

function unavailableSync<T>(data: T): SyncResult<T> {
  return { status: 'error', source: 'workbench-sync', data, error: 'Synchronization is unavailable in the static preview.' };
}

function failedSync<T>(error: unknown, data: T): SyncResult<T> {
  return { status: 'error', source: 'workbench-sync', data, error: error instanceof Error ? error.message : 'Unable to use synchronization.' };
}

function emptyState(error: string | null): WorkbenchState {
  return {
    projectRoot: null,
    turns: [],
    review: null,
    reviewsByTurn: {},
    validationResult: null,
    error,
    observation: null,
    adapters: {},
    sources: {},
    files: {},
    fileBus: {
      status: 'idle',
      directory: null,
      lastRefreshAt: null,
      error: null,
    },
  };
}
