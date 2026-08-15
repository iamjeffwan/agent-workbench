import * as React from 'react';
import {
  CaretLeft,
  CaretRight,
  Check,
  ClipboardText,
  MagnifyingGlass,
  SpinnerGap,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { styled, css } from '../upstream/theme';
import { AgentBrandIcon } from './AgentBrandIcon';
import type {
  ConversationDetails,
  ConversationHistoryResult,
  ConversationSummary,
  CreateTaskInput,
  HistoryTurnSummary,
  TaskRecord,
  TaskResult,
  TaskSummary,
  TrackedConversationSelection,
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

const ConversationContext = styled.div`
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

const ConversationRow = styled.div<{ $current: boolean }>`
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

const ConversationButton = styled.button`
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

const ConversationTrackButton = styled.button<{ $tracked: boolean }>`
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

const ConversationCopy = styled.span`
  min-width: 0;
  display: block;
`;

const ConversationTitle = styled.strong`
  display: block;
  overflow: hidden;
  font-size: 14px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ConversationMeta = styled.span`
  display: block;
  margin-top: 3px;
  overflow: hidden;
  color: ${p => p.theme.mainLowlightColor};
  font-size: 12px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ConversationTime = styled.time`
  color: ${p => p.theme.mainLowlightColor};
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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
    'check tags tags';
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

interface HistoryModalProps {
  currentProjectRoot: string | null;
  selectedTurns: HistoryTurnSummary[];
  listConversations(projectRoot: string): Promise<ConversationHistoryResult<ConversationSummary[]>>;
  readConversation(projectRoot: string, conversationId: string): Promise<ConversationHistoryResult<ConversationDetails | null>>;
  getTrackedSelection(projectRoot: string): Promise<ConversationHistoryResult<TrackedConversationSelection>>;
  onTrackedConversations(projectRoot: string, conversationIds: string[]): Promise<ConversationHistoryResult<TrackedConversationSelection>>;
  createTask(input: CreateTaskInput): Promise<TaskResult<TaskRecord | null>>;
  taskUpdates: TaskSummary[];
  onSelected(turns: HistoryTurnSummary[]): void;
  onClose(): void;
}

export function HistoryModal({
  currentProjectRoot,
  selectedTurns,
  listConversations,
  readConversation,
  getTrackedSelection,
  onTrackedConversations,
  createTask,
  taskUpdates,
  onSelected,
  onClose,
}: HistoryModalProps) {
  const [activeProject, setActiveProject] = React.useState<{ projectRoot: string } | null>(
    currentProjectRoot ? { projectRoot: currentProjectRoot } : null,
  );
  const [conversations, setConversations] = React.useState<ConversationSummary[]>([]);
  const [activeTrackedConversationIds, setActiveTrackedConversationIds] = React.useState<string[]>([]);
  const [activeConversation, setActiveConversation] = React.useState<ConversationSummary | null>(null);
  const [details, setDetails] = React.useState<ConversationDetails | null>(null);
  const [taskTitle, setTaskTitle] = React.useState('');
  const [creatingTask, setCreatingTask] = React.useState(false);
  const [createdTask, setCreatedTask] = React.useState<TaskSummary | null>(null);
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
      setConversations([]);
      setLoadingList(false);
      setError('Open a project using the project button before browsing history.');
      return () => { active = false; };
    }
    setActiveProject({ projectRoot: currentProjectRoot });
    void Promise.all([
      listConversations(currentProjectRoot),
      getTrackedSelection(currentProjectRoot),
    ]).then(([conversationResult, trackedResult]) => {
      if (!active) return;
      setConversations(conversationResult.data);
      if (trackedResult.status === 'ready') setActiveTrackedConversationIds(trackedResult.data.conversationIds);
      if (conversationResult.status !== 'ready') setError(conversationResult.error ?? 'Project conversations could not be read.');
      else if (trackedResult.status !== 'ready') setError(trackedResult.error ?? 'Tracked conversations could not be read.');
    }).finally(() => {
      if (active) setLoadingList(false);
    });
    return () => { active = false; };
  }, [currentProjectRoot, getTrackedSelection, listConversations]);

  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const filteredConversations = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...conversations]
      .filter(conversation => !needle || [conversation.title, conversation.id]
        .join(' ').toLowerCase().includes(needle))
      .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt));
  }, [conversations, query]);

  const filteredTurns = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(details?.turns ?? [])]
      .filter(turn => !needle || [turn.userInput, turn.activities.join(' '), turn.status]
        .join(' ').toLowerCase().includes(needle))
      .sort((left, right) => timestamp(right.startedAt) - timestamp(left.startedAt));
  }, [details, query]);

  const openConversation = async (conversation: ConversationSummary) => {
    if (!activeProject) return;
    const request = ++readRequest.current;
    const selectedConversationId = selectedTurns[0]?.conversationId;
    setActiveConversation(conversation);
    setDetails(null);
    setQuery('');
    setError(null);
    setLoadingTurns(true);
    const result = await readConversation(activeProject.projectRoot, conversation.id);
    if (readRequest.current !== request) return;
    setLoadingTurns(false);
    if (result.status !== 'ready' || !result.data) {
      setError(result.error ?? 'This conversation could not be read.');
      return;
    }
    if (selectedConversationId && selectedConversationId !== conversation.id) onSelected([]);
    setDetails(result.data);
  };

  const goBack = () => {
    readRequest.current += 1;
    setQuery('');
    setError(null);
    if (activeConversation) {
      setActiveConversation(null);
      setDetails(null);
      setLoadingTurns(false);
      return;
    }
  };

  const toggleTurn = (turn: HistoryTurnSummary) => {
    if (!activeTrackedConversationIds.includes(turn.conversationId)) return;
    const isSelected = selectedTurns.some(selected => sameTurn(selected, turn));
    const next = isSelected
      ? selectedTurns.filter(selected => !sameTurn(selected, turn))
      : [...selectedTurns.filter(selected => selected.conversationId === turn.conversationId), turn]
        .sort((left, right) => timestamp(left.startedAt) - timestamp(right.startedAt));
    onSelected(next);
  };

  const toggleTrackedConversation = async (conversationId: string) => {
    if (!activeProject) return;
    const next = activeTrackedConversationIds.includes(conversationId)
      ? activeTrackedConversationIds.filter(id => id !== conversationId)
      : [...activeTrackedConversationIds, conversationId];
    const result = await onTrackedConversations(activeProject.projectRoot, next);
    if (result.status !== 'ready') {
      setError(result.error ?? 'The tracked conversation selection could not be saved.');
      return;
    }
    setActiveTrackedConversationIds(result.data.conversationIds);
    setError(null);
  };

  const createSelectedTask = async () => {
    if (!activeProject || !activeConversation || selectedInConversation.length === 0) return;
    setCreatingTask(true);
    setError(null);
    const result = await createTask({
      projectRoot: activeProject.projectRoot,
      conversationId: activeConversation.id,
      turnIds: selectedInConversation.map(turn => turn.id),
      title: taskTitle.trim() || undefined,
    });
    setCreatingTask(false);
    if (result.status !== 'ready' || !result.data) {
      setError(result.error ?? 'The task document could not be created.');
      return;
    }
    const created = result.data;
    setTaskTitle('');
    setCreatedTask(toTaskSummary(created));
  };

  const inTurns = activeConversation !== null;
  const inConversations = activeProject !== null && !inTurns;
  const activeConversationTracked = activeConversation
    ? activeTrackedConversationIds.includes(activeConversation.id)
    : false;
  const selectedInConversation = selectedTurns.filter(
    turn => turn.conversationId === activeConversation?.id,
  );

  return (
    <Overlay role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <Modal $wide={false} role="dialog" aria-modal="true" aria-label="Activity history">
        <Header>
          {activeConversation ? (
            <BackButton type="button" onClick={goBack} aria-label={inTurns ? 'Back to conversations' : 'Back to projects'}>
              <CaretLeft size={17} weight="bold" /> Conversations
            </BackButton>
          ) : null}
          <HeaderTitle>{inTurns ? 'Turns' : inConversations ? 'Conversations' : 'History'}</HeaderTitle>
          <IconButton type="button" onClick={onClose} aria-label="Close history">
            <X size={20} weight="bold" />
          </IconButton>
        </Header>

        {inTurns ? (
          <ConversationContext>
            <AgentBrandIcon provider="Codex" size={22} />
            <ContextCopy>
              <ContextTitle title={activeConversation.title}>{activeConversation.title}</ContextTitle>
              <ContextMeta>
                {activeConversation.turnCount} turns · {activeConversation.observableTurnCount} with activity
              </ContextMeta>
            </ContextCopy>
            <ContextActions>
              <TrackToggle
                type="button"
                $tracked={activeConversationTracked}
                onClick={() => {
                  void toggleTrackedConversation(activeConversation.id);
                }}
              >
                {activeConversationTracked ? 'Tracked' : 'Track'}
              </TrackToggle>
              <SelectionBadge title="Selected turns">{selectedInConversation.length}</SelectionBadge>
            </ContextActions>
          </ConversationContext>
        ) : null}

        <Toolbar>
          <SearchField>
            <MagnifyingGlass size={17} weight="bold" />
            <input
              autoFocus
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={inTurns ? 'Filter prompts or activity' : 'Filter conversations'}
              aria-label={inTurns ? 'Filter turns' : 'Filter conversations'}
            />
          </SearchField>
        </Toolbar>

        {createdTask ? <ConversationContext>
          <ClipboardText size={20} />
          <ContextCopy><ContextTitle>{createdTask.title}</ContextTitle><ContextMeta>{createdTask.status === 'ready' ? 'Flow document ready in Library' : createdTask.status === 'failed' ? `Generation failed · ${createdTask.error ?? 'Unknown error'}` : 'Task created · Generating flow document…'}</ContextMeta></ContextCopy>
        </ConversationContext> : null}

        <HistoryBody>
          {!currentProjectRoot ? (
            <EmptyNotice title="No project open" message="Use the project button in View to open a project before browsing history." />
          ) : !inTurns ? (
            <ConversationList
              conversations={filteredConversations}
              selectedConversationId={selectedTurns[0]?.conversationId}
              trackedConversationIds={activeTrackedConversationIds}
              loading={loadingList}
              error={error}
              onOpen={conversation => { void openConversation(conversation); }}
              onTrack={conversationId => { void toggleTrackedConversation(conversationId); }}
            />
          ) : loadingTurns ? (
            <LoadingNotice label="Loading conversation turns…" />
          ) : error ? (
            <ErrorNotice message={error} />
          ) : (
            <TurnList
              turns={filteredTurns}
              selectedTurns={selectedTurns}
              selectionEnabled={activeConversationTracked}
              onToggle={toggleTurn}
            />
          )}
        </HistoryBody>

        <Footer>
          {inTurns && activeConversationTracked && selectedInConversation.length > 0 ? (
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
                    ? activeConversationTracked
                      ? 'Select one or more turns to create a task'
                      : 'Read-only · Track this conversation to select turns'
                    : inConversations
                      ? 'Conversations are ordered by their latest activity'
                      : `Current project · ${currentProjectRoot ? projectName(currentProjectRoot) : 'None'}`}
            </FooterMessage>
          )}
        </Footer>
      </Modal>
    </Overlay>
  );
}

function ConversationList({
  conversations,
  selectedConversationId,
  trackedConversationIds,
  loading,
  error,
  onOpen,
  onTrack,
}: {
  conversations: ConversationSummary[];
  selectedConversationId?: string;
  trackedConversationIds: string[];
  loading: boolean;
  error: string | null;
  onOpen(conversation: ConversationSummary): void;
  onTrack(conversationId: string): void;
}) {
  if (loading) return <LoadingNotice label="Loading conversations…" />;
  if (error) return <ErrorNotice message={error} />;
  if (conversations.length === 0) {
    return <EmptyNotice title="No project conversations" message="No Codex conversation contains turns for this project." />;
  }

  return <>
    {conversations.map(conversation => (
      <ConversationRow
        key={conversation.id}
        $current={conversation.id === selectedConversationId}
      >
        <ConversationButton type="button" onClick={() => onOpen(conversation)}>
          <AgentBrandIcon provider="Codex" size={21} />
          <ConversationCopy>
            <ConversationTitle title={conversation.title}>{conversation.title}</ConversationTitle>
            <ConversationMeta>
              {conversation.turnCount} turns · {conversation.observableTurnCount} with activity
            </ConversationMeta>
          </ConversationCopy>
          <ConversationTime dateTime={conversation.updatedAt ?? undefined}>
            {formatTime(timestamp(conversation.updatedAt))}
          </ConversationTime>
          <CaretRight size={16} weight="bold" />
        </ConversationButton>
        <ConversationTrackButton
          type="button"
          $tracked={trackedConversationIds.includes(conversation.id)}
          aria-pressed={trackedConversationIds.includes(conversation.id)}
          onClick={() => onTrack(conversation.id)}
        >
          {trackedConversationIds.includes(conversation.id) ? 'Tracked' : 'Track'}
        </ConversationTrackButton>
      </ConversationRow>
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
        <strong>Read-only preview.</strong> Track this conversation before selecting turns for the timeline.
      </SelectionLockNotice>
    ) : null}
    {groupByDay(turns, turn => timestamp(turn.startedAt)).map(([day, items]) => (
      <Day key={day}>
        <h2>{day}</h2>
        {items.map(turn => {
          const selected = selectedTurns.some(value => sameTurn(value, turn));
          return (
            <TurnButton
              type="button"
              key={`${turn.conversationId}:${turn.id}`}
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
  return left.conversationId === right.conversationId && left.id === right.id;
}

function toTaskSummary(task: TaskRecord): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    projectRoot: task.projectRoot,
    conversationId: task.conversationId,
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
