import * as React from 'react';
import {
  CaretLeft,
  CaretRight,
  Check,
  ClipboardText,
  CloudArrowUp,
  MagnifyingGlass,
  SpinnerGap,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { styled, css } from '../upstream/theme';
import { AgentBrandIcon } from './AgentBrandIcon';
import type {
  SessionDetails,
  SessionHistoryResult,
  SessionSummary,
  CreateTaskInput,
  HistoryTurnSummary,
  TaskRecord,
  TaskResult,
  TaskSummary,
  TrackedSessionSelection,
  SyncResult,
  SyncTaskManifest,
  SyncTaskRecord,
} from './workbench-data';

const Overlay = styled.div`
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: flex;
  justify-content: flex-end;
  padding: 24px;
  box-sizing: border-box;
  background: rgba(30, 32, 40, 0.14);
`;

const Modal = styled.section<{ $wide?: boolean }>`
  width: ${p => p.$wide ? 'min(980px, calc(100vw - 48px))' : 'min(540px, calc(100vw - 48px))'};
  height: calc(100vh - 48px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 4px;
  background: ${p => p.theme.mainBackground};
  color: ${p => p.theme.mainColor};
  box-shadow: 0 8px 36px rgba(0, 0, 0, 0.45);
`;

const Header = styled.header`
  min-height: 58px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  padding: 10px 13px 9px 15px;
  color: ${p => p.theme.containerWatermark};
  border-bottom: 1px solid ${p => p.theme.containerBorder};
`;

const HeaderTitle = styled.h1`
  margin: 0;
  font-family: ${p => p.theme.titleTextFamily};
  font-size: 19px;
  font-weight: bold;
  line-height: 1;
  text-transform: uppercase;
`;

const IconButton = styled.button`
  min-width: 32px;
  min-height: 32px;
  padding: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  cursor: pointer;

  &:hover {
    background: ${p => p.theme.mainLowlightBackground};
    color: ${p => p.theme.mainColor};
  }

  &:focus-visible {
    outline: 1px dotted ${p => p.theme.popColor};
    outline-offset: -2px;
  }
`;

const BackButton = styled(IconButton)`
  width: max-content;
  padding-right: 9px;
  color: ${p => p.theme.mainLowlightColor};
  font-size: 13px;
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  border-bottom: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.mainLowlightBackground};
`;

const SearchField = styled.label`
  position: relative;
  display: block;

  svg {
    position: absolute;
    top: 50%;
    left: 9px;
    z-index: 1;
    color: ${p => p.theme.mainLowlightColor};
    transform: translateY(-50%);
    pointer-events: none;
  }

  input {
    width: 100%;
    height: 32px;
    padding: 5px 10px 5px 32px;
    border: 1px solid ${p => p.theme.containerBorder};
    border-radius: 3px;
    background: ${p => p.theme.inputBackground};
    color: ${p => p.theme.inputColor};
    font: inherit;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08);

    &::placeholder {
      color: ${p => p.theme.inputPlaceholderColor};
    }

    &:focus {
      outline: 1px solid ${p => p.theme.highlightColor};
      outline-offset: -1px;
    }
  }
`;

const SessionContext = styled.div`
  min-height: 64px;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.mainBackground};
`;

const ContextCopy = styled.div`
  min-width: 0;
`;

const ContextTitle = styled.strong`
  display: block;
  overflow: hidden;
  font-size: 14.5px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ContextMeta = styled.span`
  display: block;
  margin-top: 2px;
  color: ${p => p.theme.mainLowlightColor};
  font-size: 12px;
`;

const SelectionBadge = styled.span`
  min-width: 28px;
  padding: 3px 7px;
  border-radius: 3px;
  background: ${p => p.theme.mainLowlightBackground};
  color: ${p => p.theme.mainLowlightColor};
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 12px;
  text-align: center;
`;

const ContextActions = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

const TrackToggle = styled.button<{ $tracked: boolean }>`
  min-height: 27px;
  padding: 3px 8px;
  border: 1px solid ${p => p.$tracked ? p.theme.containerBorder : p.theme.popColor};
  border-radius: 3px;
  background: ${p => p.$tracked ? p.theme.mainLowlightBackground : p.theme.mainBackground};
  color: ${p => p.$tracked ? p.theme.mainLowlightColor : p.theme.popColor};
  font: inherit;
  font-size: 11.5px;
  font-weight: bold;
  cursor: pointer;

  &:hover { background: ${p => p.theme.highlightBackground}; }
  &:focus-visible { outline: 1px dotted ${p => p.theme.popColor}; }
`;

const HistoryBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 11px 16px;
  background: ${p => p.theme.containerBackground};
`;

const Day = styled.section`
  h2 {
    position: sticky;
    z-index: 2;
    top: 0;
    margin: 0 -11px 5px;
    padding: 9px 15px 7px;
    border-bottom: 1px solid ${p => p.theme.containerBorder};
    background: ${p => p.theme.containerBackground};
    color: ${p => p.theme.containerWatermark};
    font-family: ${p => p.theme.titleTextFamily};
    font-size: 13px;
    line-height: 1;
    text-transform: uppercase;
  }
`;

const SessionRow = styled.div<{ $current: boolean }>`
  width: 100%;
  min-height: 64px;
  margin: 0 0 5px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  border: 0;
  border-radius: 3px;
  background: ${p => p.theme.mainBackground};
  color: ${p => p.theme.mainColor};
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.13);
  &:hover {
    background: ${p => p.theme.highlightBackground};
    box-shadow: 0 2px 7px rgba(0, 0, 0, 0.2);
  }

  ${p => p.$current && css`
    outline: 1px dotted ${p.theme.popColor};
    outline-offset: -3px;
    background: ${p.theme.highlightBackground};
  `}
`;

const SessionButton = styled.button`
  min-width: 0;
  min-height: 64px;
  padding: 9px 8px 9px 12px;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto 18px;
  align-items: center;
  gap: 9px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;

  &:focus-visible {
    outline: 1px dotted ${p => p.theme.popColor};
    outline-offset: -3px;
  }
`;

const SessionTrackButton = styled.button<{ $tracked: boolean }>`
  min-width: 58px;
  min-height: 28px;
  margin-right: 9px;
  padding: 3px 7px;
  border: 1px solid ${p => p.$tracked ? p.theme.containerBorder : p.theme.popColor};
  border-radius: 3px;
  background: ${p => p.$tracked ? p.theme.mainLowlightBackground : p.theme.mainBackground};
  color: ${p => p.$tracked ? p.theme.mainLowlightColor : p.theme.popColor};
  font: inherit;
  font-size: 11px;
  font-weight: bold;
  cursor: pointer;

  &:hover { background: ${p => p.theme.highlightBackground}; }
  &:focus-visible { outline: 1px dotted ${p => p.theme.popColor}; }
`;

const SessionCopy = styled.span`
  min-width: 0;
  display: block;
`;

const SessionTitle = styled.strong`
  display: block;
  overflow: hidden;
  font-size: 14px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SessionMeta = styled.span`
  display: block;
  margin-top: 3px;
  overflow: hidden;
  color: ${p => p.theme.mainLowlightColor};
  font-size: 12px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SessionTime = styled.time`
  color: ${p => p.theme.mainLowlightColor};
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

const SyncTaskRow = styled.button`
  width: 100%;
  min-height: 70px;
  margin: 0 0 5px;
  padding: 10px 12px;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto 18px;
  align-items: center;
  gap: 9px;
  border: 0;
  border-radius: 3px;
  background: ${p => p.theme.mainBackground};
  color: ${p => p.theme.mainColor};
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.13);
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover, &:focus-visible {
    outline: none;
    background: ${p => p.theme.highlightBackground};
    box-shadow: 0 2px 7px rgba(0, 0, 0, 0.2);
  }
`;

const TurnButton = styled.button<{
  $selected: boolean;
  $status: HistoryTurnSummary['status'];
  $selectionEnabled: boolean;
}>`
  position: relative;
  width: 100%;
  min-height: 76px;
  margin: 0 0 5px;
  padding: 9px 11px 8px 13px;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  grid-template-areas:
    'check prompt time'
    'check tags tags'
    'check plans plans';
  align-items: start;
  gap: 6px 9px;
  border: 0;
  border-left: 4px solid ${p => statusColor(p.$status)};
  border-radius: 3px;
  background: ${p => p.theme.mainBackground};
  color: ${p => p.theme.mainColor};
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.13);
  cursor: ${p => p.$selectionEnabled ? 'pointer' : 'not-allowed'};
  text-align: left;

  &:not(:disabled):hover {
    background: ${p => p.theme.highlightBackground};
    box-shadow: 0 2px 7px rgba(0, 0, 0, 0.2);
  }

  &:focus-visible {
    outline: 1px dotted ${p => p.theme.popColor};
    outline-offset: -3px;
  }

  ${p => p.$selected && css`
    outline: 1px dotted ${p.theme.popColor};
    outline-offset: -3px;
    background: ${p.theme.highlightBackground};
  `}

  ${p => !p.$selectionEnabled && css`
    color: ${p.theme.mainLowlightColor};
    box-shadow: none;
    opacity: 0.78;
  `}
`;

const Checkmark = styled.span<{ $selected: boolean }>`
  grid-area: check;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid ${p => p.$selected ? p.theme.popColor : p.theme.containerBorder};
  border-radius: 2px;
  background: ${p => p.$selected ? p.theme.popColor : p.theme.inputBackground};
  color: ${p => p.theme.popOverlayColor};
`;

const Prompt = styled.strong`
  grid-area: prompt;
  min-width: 0;
  display: block;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.35;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`;

const TurnTime = styled.time`
  grid-area: time;
  padding-top: 1px;
  color: ${p => p.theme.mainLowlightColor};
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

const ActivityTags = styled.span`
  grid-area: tags;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const ActivityTag = styled.span<{ $muted?: boolean }>`
  padding: 2px 5px 1px;
  border-radius: 2px;
  background: ${p => p.$muted ? p.theme.mainLowlightBackground : '#dde8dc'};
  color: ${p => p.$muted ? p.theme.containerWatermark : '#315b38'};
  font-family: ${p => p.theme.titleTextFamily};
  font-size: 10.5px;
  font-weight: bold;
  line-height: 1.35;
  text-transform: uppercase;
`;

const PlanItems = styled.span`
  grid-area: plans;
  min-width: 0;
  display: grid;
  gap: 4px;
`;

const PlanItem = styled.span`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  color: ${p => p.theme.mainLowlightColor};
  font-size: 12px;
  line-height: 1.35;

  svg { flex: 0 0 auto; }
`;

const PlanTitle = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SelectionLockNotice = styled.div`
  margin: 10px 0 8px;
  padding: 9px 11px;
  border-left: 4px solid ${p => p.theme.warningColor};
  border-radius: 2px;
  background: ${p => p.theme.mainBackground};
  color: ${p => p.theme.mainLowlightColor};
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.11);
  font-size: 12.5px;
  line-height: 1.4;

  strong {
    color: ${p => p.theme.mainColor};
  }
`;

const Notice = styled.div<{ $error?: boolean }>`
  min-height: 180px;
  padding: 44px 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: ${p => p.$error ? p.theme.popColor : p.theme.containerWatermark};
  text-align: center;

  strong {
    color: ${p => p.$error ? p.theme.popColor : p.theme.mainLowlightColor};
  }

  span {
    max-width: 340px;
    font-size: 12.5px;
    line-height: 1.45;
  }
`;

const LoadingIcon = styled(SpinnerGap)`
  animation: history-spin 0.85s linear infinite;

  @keyframes history-spin {
    to { transform: rotate(360deg); }
  }
`;

const Footer = styled.footer`
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 9px 13px;
  border-top: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.mainBackground};
  color: ${p => p.theme.mainLowlightColor};
  font-size: 12px;
  text-align: right;
`;

const FooterMessage = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TaskTitleInput = styled.input`
  width: min(210px, 38vw);
  height: 28px;
  padding: 4px 7px;
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 3px;
  background: ${p => p.theme.inputBackground};
  color: ${p => p.theme.inputColor};
  font: inherit;

  &:focus {
    outline: 1px solid ${p => p.theme.highlightColor};
    outline-offset: -1px;
  }
`;

const CreateTaskButton = styled(TrackToggle)`
  min-height: 28px;
  white-space: nowrap;
`;

const CategoryTabs = styled.div`
  display: flex;
  flex: 0 0 auto;
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 3px;
  overflow: hidden;
`;

const CategoryButton = styled.button<{ $active: boolean }>`
  min-height: 32px;
  padding: 5px 10px;
  border: 0;
  border-right: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.$active ? p.theme.highlightBackground : p.theme.inputBackground};
  color: ${p => p.$active ? p.theme.mainColor : p.theme.mainLowlightColor};
  font: inherit;
  font-size: 12px;
  font-weight: ${p => p.$active ? 700 : 400};
  cursor: pointer;

  &:last-child { border-right: 0; }
  &:focus-visible { outline: 1px dotted ${p => p.theme.popColor}; outline-offset: -2px; }
`;

const SyncButton = styled(CreateTaskButton)`
  border-color: ${p => p.theme.highlightColor};
`;

interface HistoryModalProps {
  currentProjectRoot: string | null;
  selectedTurns: HistoryTurnSummary[];
  listSessions(projectRoot: string): Promise<SessionHistoryResult<SessionSummary[]>>;
  readSession(projectRoot: string, sessionId: string): Promise<SessionHistoryResult<SessionDetails | null>>;
  getTrackedSelection(projectRoot: string): Promise<SessionHistoryResult<TrackedSessionSelection>>;
  onTrackedSessions(projectRoot: string, sessionIds: string[]): Promise<SessionHistoryResult<TrackedSessionSelection>>;
  createTask(input: CreateTaskInput): Promise<TaskResult<TaskRecord | null>>;
  addTaskToSync(taskId: string): Promise<SyncResult<SyncTaskManifest | null>>;
  listSyncTasks(projectRoot: string): Promise<SyncResult<SyncTaskManifest[]>>;
  readSyncTask(projectRoot: string, taskId: string): Promise<SyncResult<SyncTaskRecord | null>>;
  onOpenSyncTask(task: SyncTaskRecord): void | Promise<void>;
  taskUpdates: TaskSummary[];
  onSelected(turns: HistoryTurnSummary[]): void;
  onClose(): void;
}

export function HistoryModal({
  currentProjectRoot,
  selectedTurns,
  listSessions,
  readSession,
  getTrackedSelection,
  onTrackedSessions,
  createTask,
  addTaskToSync,
  listSyncTasks,
  readSyncTask,
  onOpenSyncTask,
  taskUpdates,
  onSelected,
  onClose,
}: HistoryModalProps) {
  const [activeProject, setActiveProject] = React.useState<{ projectRoot: string } | null>(
    currentProjectRoot ? { projectRoot: currentProjectRoot } : null,
  );
  const [sessions, setSessions] = React.useState<SessionSummary[]>([]);
  const [activeTrackedSessionIds, setActiveTrackedSessionIds] = React.useState<string[]>([]);
  const [activeSession, setActiveSession] = React.useState<SessionSummary | null>(null);
  const [details, setDetails] = React.useState<SessionDetails | null>(null);
  const [historySection, setHistorySection] = React.useState<'sessions' | 'sync'>('sessions');
  const [syncTasks, setSyncTasks] = React.useState<SyncTaskManifest[]>([]);
  const [syncLoading, setSyncLoading] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);
  const [taskTitle, setTaskTitle] = React.useState('');
  const [creatingTask, setCreatingTask] = React.useState(false);
  const [createdTask, setCreatedTask] = React.useState<TaskSummary | null>(null);
  const [syncingTask, setSyncingTask] = React.useState(false);
  const [syncMessage, setSyncMessage] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [loadingList, setLoadingList] = React.useState(true);
  const [loadingTurns, setLoadingTurns] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const readRequest = React.useRef(0);

  React.useEffect(() => {
    if (taskUpdates.length === 0) return;
    setCreatedTask(current => current
      ? taskUpdates.find(update => update.id === current.id) ?? current
      : current);
  }, [taskUpdates]);

  React.useEffect(() => {
    let active = true;
    setLoadingList(true);
    setError(null);
    if (!currentProjectRoot) {
      setActiveProject(null);
      setSessions([]);
      setSyncTasks([]);
      setHistorySection('sessions');
      setLoadingList(false);
      setError('Open a project using the project button before browsing history.');
      return () => { active = false; };
    }
    setActiveProject({ projectRoot: currentProjectRoot });
    setHistorySection('sessions');
    void Promise.all([
      listSessions(currentProjectRoot),
      getTrackedSelection(currentProjectRoot),
      listSyncTasks(currentProjectRoot),
    ]).then(([sessionResult, trackedResult, syncResult]) => {
      if (!active) return;
      setSessions(sessionResult.data);
      setSyncTasks(syncResult.data);
      if (trackedResult.status === 'ready') setActiveTrackedSessionIds(trackedResult.data.sessionIds);
      if (sessionResult.status !== 'ready') setError(sessionResult.error ?? 'Project sessions could not be read.');
      else if (trackedResult.status !== 'ready') setError(trackedResult.error ?? 'Tracked sessions could not be read.');
      else if (syncResult.status !== 'ready') setSyncError(syncResult.error ?? 'Synchronized tasks could not be read.');
    }).finally(() => {
      if (active) setLoadingList(false);
    });
    return () => { active = false; };
  }, [currentProjectRoot, getTrackedSelection, listSessions, listSyncTasks]);

  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const filteredSessions = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...sessions]
      .filter(session => !needle || [session.title, session.id]
        .join(' ').toLowerCase().includes(needle))
      .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt));
  }, [sessions, query]);

  const filteredTurns = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(details?.turns ?? [])]
      .filter(turn => !needle || [turn.userInput, (turn.planTitles ?? []).join(' '), turn.activities.join(' '), turn.status]
        .join(' ').toLowerCase().includes(needle))
      .sort((left, right) => timestamp(right.startedAt) - timestamp(left.startedAt));
  }, [details, query]);

  const filteredSyncTasks = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...syncTasks]
      .filter(task => !needle || [task.title, task.projectFile, task.source.sessionId]
        .join(' ').toLowerCase().includes(needle))
      .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt));
  }, [query, syncTasks]);

  const openSession = async (session: SessionSummary) => {
    if (!activeProject) return;
    const request = ++readRequest.current;
    const selectedSessionId = selectedTurns[0]?.sessionId;
    setActiveSession(session);
    setDetails(null);
    setQuery('');
    setError(null);
    setLoadingTurns(true);
    const result = await readSession(activeProject.projectRoot, session.id);
    if (readRequest.current !== request) return;
    setLoadingTurns(false);
    if (result.status !== 'ready' || !result.data) {
      setError(result.error ?? 'This session could not be read.');
      return;
    }
    if (selectedSessionId && selectedSessionId !== session.id) onSelected([]);
    setDetails(result.data);
  };

  const goBack = () => {
    readRequest.current += 1;
    setQuery('');
    setError(null);
    if (activeSession) {
      setActiveSession(null);
      setDetails(null);
      setLoadingTurns(false);
      return;
    }
  };

  const toggleTurn = (turn: HistoryTurnSummary) => {
    if (!activeTrackedSessionIds.includes(turn.sessionId)) return;
    const isSelected = selectedTurns.some(selected => sameTurn(selected, turn));
    const next = isSelected
      ? selectedTurns.filter(selected => !sameTurn(selected, turn))
      : [...selectedTurns.filter(selected => selected.sessionId === turn.sessionId), turn]
        .sort((left, right) => timestamp(left.startedAt) - timestamp(right.startedAt));
    onSelected(next);
  };

  const toggleTrackedSession = async (sessionId: string) => {
    if (!activeProject) return;
    const next = activeTrackedSessionIds.includes(sessionId)
      ? activeTrackedSessionIds.filter(id => id !== sessionId)
      : [...activeTrackedSessionIds, sessionId];
    const result = await onTrackedSessions(activeProject.projectRoot, next);
    if (result.status !== 'ready') {
      setError(result.error ?? 'The tracked session selection could not be saved.');
      return;
    }
    setActiveTrackedSessionIds(result.data.sessionIds);
    setError(null);
  };

  const createSelectedTask = async () => {
    if (!activeProject || !activeSession || selectedInSession.length === 0) return;
    setCreatingTask(true);
    setError(null);
    const result = await createTask({
      projectRoot: activeProject.projectRoot,
      sessionId: activeSession.id,
      turnIds: selectedInSession.map(turn => turn.id),
      title: taskTitle.trim() || undefined,
    });
    setCreatingTask(false);
    if (result.status !== 'ready' || !result.data) {
      setError(result.error ?? 'The task document could not be created.');
      return;
    }
    const created = result.data;
    setTaskTitle('');
    setSyncMessage(null);
    setCreatedTask(toTaskSummary(created));
  };

  const openSyncTask = async (task: SyncTaskManifest) => {
    if (!activeProject) return;
    setSyncLoading(true);
    setSyncError(null);
    const result = await readSyncTask(activeProject.projectRoot, task.id);
    setSyncLoading(false);
    if (result.status !== 'ready' || !result.data) {
      setSyncError(result.error ?? 'This synchronized task could not be read.');
      return;
    }
    await onOpenSyncTask(result.data);
  };

  const addCreatedTaskToSync = async () => {
    if (!createdTask) return;
    setSyncingTask(true);
    setSyncMessage(null);
    const result = await addTaskToSync(createdTask.id);
    setSyncingTask(false);
    setSyncMessage(result.status === 'ready'
      ? 'Sync package saved in the project.'
      : result.error ?? 'The task could not be added to Sync.');
  };

  const inTurns = activeSession !== null;
  const inSessions = activeProject !== null && !inTurns;
  const activeSessionTracked = activeSession
    ? activeTrackedSessionIds.includes(activeSession.id)
    : false;
  const selectedInSession = selectedTurns.filter(
    turn => turn.sessionId === activeSession?.id,
  );

  return (
    <Overlay role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <Modal $wide={false} role="dialog" aria-modal="true" aria-label="Activity history">
        <Header>
          {activeSession ? (
            <BackButton type="button" onClick={goBack} aria-label={inTurns ? 'Back to sessions' : 'Back to projects'}>
              <CaretLeft size={17} weight="bold" /> Sessions
            </BackButton>
          ) : null}
          <HeaderTitle>{inTurns ? 'Turns' : inSessions ? 'History' : 'History'}</HeaderTitle>
          <IconButton type="button" onClick={onClose} aria-label="Close history">
            <X size={20} weight="bold" />
          </IconButton>
        </Header>

        {inTurns ? (
          <SessionContext>
            <AgentBrandIcon provider="Codex" size={22} />
            <ContextCopy>
              <ContextTitle title={activeSession.title}>{activeSession.title}</ContextTitle>
              <ContextMeta>
                {activeSession.turnCount} turns · {activeSession.observableTurnCount} with activity
              </ContextMeta>
            </ContextCopy>
            <ContextActions>
              <TrackToggle
                type="button"
                $tracked={activeSessionTracked}
                onClick={() => {
                  void toggleTrackedSession(activeSession.id);
                }}
              >
                {activeSessionTracked ? 'Tracked' : 'Track'}
              </TrackToggle>
              <SelectionBadge title="Selected turns">{selectedInSession.length}</SelectionBadge>
            </ContextActions>
          </SessionContext>
        ) : null}

        {!activeSession ? <Toolbar>
          <CategoryTabs role="tablist" aria-label="History categories">
            <CategoryButton type="button" role="tab" aria-selected={historySection === 'sessions'} $active={historySection === 'sessions'} onClick={() => { setHistorySection('sessions'); setQuery(''); setSyncError(null); }}>Sessions</CategoryButton>
            <CategoryButton type="button" role="tab" aria-selected={historySection === 'sync'} $active={historySection === 'sync'} onClick={() => { setHistorySection('sync'); setQuery(''); setError(null); }}>Sync</CategoryButton>
          </CategoryTabs>
            <SearchField>
              <MagnifyingGlass size={17} weight="bold" />
              <input
                autoFocus
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={inTurns ? 'Filter prompts or activity' : historySection === 'sync' ? 'Filter synchronized tasks' : 'Filter sessions'}
                aria-label={inTurns ? 'Filter turns' : historySection === 'sync' ? 'Filter synchronized tasks' : 'Filter sessions'}
              />
            </SearchField>
          </Toolbar> : <Toolbar>
          <SearchField>
            <MagnifyingGlass size={17} weight="bold" />
            <input autoFocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} placeholder="Filter prompts or activity" aria-label="Filter turns" />
          </SearchField>
        </Toolbar>}

        {createdTask ? <SessionContext>
          <ClipboardText size={20} />
          <ContextCopy><ContextTitle>{createdTask.title}</ContextTitle><ContextMeta>{syncMessage ?? (createdTask.status === 'ready' ? 'Flow document ready in Library' : createdTask.status === 'failed' ? `Generation failed · ${createdTask.error ?? 'Unknown error'}` : 'Task created · Generating flow document…')}</ContextMeta></ContextCopy>
          {createdTask.status === 'ready' ? <SyncButton
            type="button"
            $tracked={false}
            disabled={syncingTask}
            onClick={() => { void addCreatedTaskToSync(); }}
          >
            {syncingTask ? 'Saving…' : 'Add to Sync'}
          </SyncButton> : null}
        </SessionContext> : null}

        <HistoryBody>
          {!currentProjectRoot ? (
            <EmptyNotice title="No project open" message="Use the project button in View to open a project before browsing history." />
          ) : !inTurns && historySection === 'sync' ? (
            <SyncTaskList tasks={filteredSyncTasks} loading={syncLoading} error={syncError} onOpen={task => { void openSyncTask(task); }} />
          ) : !inTurns ? (
            <SessionList
              sessions={filteredSessions}
              selectedSessionId={selectedTurns[0]?.sessionId}
              trackedSessionIds={activeTrackedSessionIds}
              loading={loadingList}
              error={error}
              onOpen={session => { void openSession(session); }}
              onTrack={sessionId => { void toggleTrackedSession(sessionId); }}
            />
          ) : loadingTurns ? (
            <LoadingNotice label="Loading session turns…" />
          ) : error ? (
            <ErrorNotice message={error} />
          ) : (
            <TurnList
              turns={filteredTurns}
              selectedTurns={selectedTurns}
              selectionEnabled={activeSessionTracked}
              onToggle={toggleTurn}
            />
          )}
        </HistoryBody>

        <Footer>
          {inTurns && activeSessionTracked && selectedInSession.length > 0 ? (
            <>
              <TaskTitleInput
                value={taskTitle}
                onChange={event => setTaskTitle(event.target.value)}
                placeholder="Task name (optional)"
                aria-label="Task name"
              />
              <CreateTaskButton
                type="button"
                $tracked={false}
                disabled={creatingTask}
                onClick={() => { void createSelectedTask(); }}
              >
                {creatingTask ? 'Generating…' : 'Create task'}
              </CreateTaskButton>
            </>
          ) : (
            <FooterMessage>
              {inTurns
                    ? activeSessionTracked
                      ? 'Select one or more turns to create a task'
                      : 'Read-only · Track this session to select turns'
                    : inSessions
                      ? historySection === 'sync'
                        ? 'Select a synchronized task to open its document in View'
                        : 'Sessions are ordered by their latest activity'
                      : `Current project · ${currentProjectRoot ? projectName(currentProjectRoot) : 'None'}`}
            </FooterMessage>
          )}
        </Footer>
      </Modal>
    </Overlay>
  );
}

function SessionList({
  sessions,
  selectedSessionId,
  trackedSessionIds,
  loading,
  error,
  onOpen,
  onTrack,
}: {
  sessions: SessionSummary[];
  selectedSessionId?: string;
  trackedSessionIds: string[];
  loading: boolean;
  error: string | null;
  onOpen(session: SessionSummary): void;
  onTrack(sessionId: string): void;
}) {
  if (loading) return <LoadingNotice label="Loading sessions…" />;
  if (error) return <ErrorNotice message={error} />;
  if (sessions.length === 0) {
    return <EmptyNotice title="No project sessions" message="No Codex session contains turns for this project." />;
  }

  return <>
    {sessions.map(session => (
      <SessionRow
        key={session.id}
        $current={session.id === selectedSessionId}
      >
        <SessionButton type="button" onClick={() => onOpen(session)}>
          <AgentBrandIcon provider="Codex" size={21} />
          <SessionCopy>
            <SessionTitle title={session.title}>{session.title}</SessionTitle>
            <SessionMeta>
              {session.turnCount} turns · {session.observableTurnCount} with activity
            </SessionMeta>
          </SessionCopy>
          <SessionTime dateTime={session.updatedAt ?? undefined}>
            {formatTime(timestamp(session.updatedAt))}
          </SessionTime>
          <CaretRight size={16} weight="bold" />
        </SessionButton>
        <SessionTrackButton
          type="button"
          $tracked={trackedSessionIds.includes(session.id)}
          aria-pressed={trackedSessionIds.includes(session.id)}
          onClick={() => onTrack(session.id)}
        >
          {trackedSessionIds.includes(session.id) ? 'Tracked' : 'Track'}
        </SessionTrackButton>
      </SessionRow>
    ))}
  </>;
}

function SyncTaskList({
  tasks,
  loading,
  error,
  onOpen,
}: {
  tasks: SyncTaskManifest[];
  loading: boolean;
  error: string | null;
  onOpen(task: SyncTaskManifest): void;
}) {
  if (loading) return <LoadingNotice label="Loading synchronized tasks…" />;
  if (error) return <ErrorNotice message={error} />;
  if (tasks.length === 0) {
    return <EmptyNotice title="No synchronized tasks" message="Create a task from a tracked session, then add it to Sync." />;
  }

  return <>
    {tasks.map(task => (
      <SyncTaskRow key={task.id} type="button" onClick={() => onOpen(task)}>
        <CloudArrowUp size={21} weight="bold" />
        <SessionCopy>
          <SessionTitle title={task.title}>{task.title}</SessionTitle>
          <SessionMeta>{task.turns.length} turns · {task.eventCount} events · {task.projectFile}</SessionMeta>
        </SessionCopy>
        <SessionTime dateTime={task.updatedAt}>{formatTime(timestamp(task.updatedAt))}</SessionTime>
        <CaretRight size={16} weight="bold" />
      </SyncTaskRow>
    ))}
  </>;
}

function TurnList({
  turns,
  selectedTurns,
  selectionEnabled,
  onToggle,
}: {
  turns: HistoryTurnSummary[];
  selectedTurns: HistoryTurnSummary[];
  selectionEnabled: boolean;
  onToggle(turn: HistoryTurnSummary): void;
}) {
  if (turns.length === 0) {
    return <EmptyNotice title="No matching turns" message="Try a different prompt or activity filter." />;
  }

  return <>
    {!selectionEnabled ? (
      <SelectionLockNotice id="turn-selection-requires-tracking" role="note">
        <strong>Read-only preview.</strong> Track this session before selecting turns for the timeline.
      </SelectionLockNotice>
    ) : null}
    {groupByDay(turns, turn => timestamp(turn.startedAt)).map(([day, items]) => (
      <Day key={day}>
        <h2>{day}</h2>
        {items.map(turn => {
          const selected = selectedTurns.some(value => sameTurn(value, turn));
          const planTitles = turn.planTitles ?? [];
          return (
            <TurnButton
              type="button"
              key={`${turn.sessionId}:${turn.id}`}
              $selected={selected}
              $status={turn.status}
              $selectionEnabled={selectionEnabled}
              aria-pressed={selected}
              aria-describedby={!selectionEnabled ? 'turn-selection-requires-tracking' : undefined}
              disabled={!selectionEnabled}
              onClick={() => onToggle(turn)}
            >
              <Checkmark $selected={selected} aria-hidden="true">
                {selected ? <Check size={13} weight="bold" /> : null}
              </Checkmark>
              <Prompt title={turn.userInput || 'No user prompt captured'}>
                {turn.userInput || 'No user prompt captured'}
              </Prompt>
              <TurnTime dateTime={turn.startedAt ?? undefined}>{formatTime(timestamp(turn.startedAt))}</TurnTime>
              <ActivityTags>
                {turn.hasObservableActivity && turn.activities.length > 0
                  ? turn.activities.map(activity => <ActivityTag key={activity}>{activity}</ActivityTag>)
                  : <ActivityTag $muted>No observable activity</ActivityTag>}
              </ActivityTags>
              {planTitles.length > 0 ? <PlanItems>
                {planTitles.map((title, index) => <PlanItem key={`${title}:${index}`} title={title}>
                  <ClipboardText size={14} weight="bold" aria-hidden="true" />
                  <ActivityTag>Plan</ActivityTag>
                  <PlanTitle>{title}</PlanTitle>
                </PlanItem>)}
              </PlanItems> : null}
            </TurnButton>
          );
        })}
      </Day>
    ))}
  </>;
}

function LoadingNotice({ label }: { label: string }) {
  return <Notice role="status"><LoadingIcon size={28} weight="bold" /><strong>{label}</strong></Notice>;
}

function ErrorNotice({ message }: { message: string }) {
  return <Notice $error role="alert">
    <WarningCircle size={29} weight="bold" />
    <strong>History unavailable</strong>
    <span>{message}</span>
  </Notice>;
}

function EmptyNotice({ title, message }: { title: string; message: string }) {
  return <Notice><strong>{title}</strong><span>{message}</span></Notice>;
}

function sameTurn(left: HistoryTurnSummary, right: HistoryTurnSummary): boolean {
  return left.sessionId === right.sessionId && left.id === right.id;
}

function toTaskSummary(task: TaskRecord): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    projectRoot: task.projectRoot,
    sessionId: task.sessionId,
    turnIds: task.turnIds,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    eventCount: task.eventCount,
    status: task.status,
    error: task.error,
  };
}

function projectName(projectRoot: string): string {
  const parts = projectRoot.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts.at(-1) || projectRoot;
}

function groupByDay<T>(items: T[], getTimestamp: (item: T) => number): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const day = formatDay(getTimestamp(item));
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return [...groups.entries()];
}

const HISTORY_DATE_LOCALE = 'en-US';

function formatDay(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'Unknown date';
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(HISTORY_DATE_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return new Date(value).toLocaleTimeString(HISTORY_DATE_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function statusColor(status: HistoryTurnSummary['status']): string {
  if (status === 'failed' || status === 'aborted') return '#e1421f';
  if (status === 'running') return '#f1971f';
  if (status === 'completed') return '#5cb85c';
  return '#9a9da8';
}
