import type {
  AgentOperation,
  ChangedFile,
  CodeChanges,
  PreviewRecord,
  ProgramCall,
} from './types';
import { languageForPath, parsePatchFiles } from './patch-files.ts';

export type AgentProvider = 'Codex';

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
  sessionId?: string | null;
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
  appliedChanges?: Record<string, unknown> | null;
  appliedChangeSuccess?: boolean | null;
  mergedRecords?: WorkbenchTimelineNode[];
  eventKind?: string;
  content?: string | null;
  role?: 'user' | 'assistant' | null;
  tokenUsage?: Record<string, number | null | undefined> | null;
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

export interface WorkbenchReviewFinding {
  id: string;
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  summary: string;
  status: 'open';
  eventIds: string[];
  evidenceIds: string[];
  expected?: string;
  actual?: string;
}

export interface WorkbenchResultReview {
  status: 'passed' | 'failed' | 'incomplete' | 'unknown';
  profileId: string | null;
  checkedEventCount: number;
  checkedEventIds: string[];
  checks: WorkbenchValidationCheckResult[];
  evidence: WorkbenchReviewEvidence[];
  findings: WorkbenchReviewFinding[];
}

export interface WorkbenchValidationCheckResult {
  id: string;
  label?: string;
  command?: string;
  result?: string;
  kind?: 'command' | 'test' | 'build' | 'lint' | 'playwright' | 'artifact';
  status: 'passed' | 'failed' | 'incomplete' | 'not_run' | 'unknown';
  summary?: string;
  durationMs?: number | null;
  artifacts?: Array<{
    path: string;
    kind: 'screenshot' | 'trace' | 'video' | 'report' | 'other';
  }>;
}

export interface WorkbenchReviewEvidence {
  id: string;
  kind: string;
  summary: string;
  source?: {
    sessionFile?: string | null;
    line?: number | null;
    path?: string | null;
  };
}

export interface WorkbenchState {
  projectRoot: string | null;
  turns: WorkbenchTimelineNode[];
  review: WorkbenchResultReview | null;
  reviewsByTurn: Record<string, WorkbenchResultReview>;
  validationResult: WorkbenchValidationResult | null;
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

export type HistoryActivity =
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

export interface HistoryTurnSummary {
  id: string;
  sessionId: string;
  userInput: string;
  startedAt: string | null;
  updatedAt: string | null;
  cwd: string;
  status: 'completed' | 'running' | 'aborted' | 'failed' | 'unknown';
  hasObservableActivity: boolean;
  activities: HistoryActivity[];
  planTitles?: string[];
}

export interface SessionSummary {
  id: string;
  provider: 'codex';
  title: string;
  startedAt: string | null;
  updatedAt: string | null;
  turnCount: number;
  observableTurnCount: number;
}

export interface SessionProjectSummary {
  projectRoot: string;
  updatedAt: string | null;
  sessionCount: number;
}

export interface SessionDetails extends SessionSummary {
  turns: HistoryTurnSummary[];
}

export interface TrackedSessionSelection {
  projectRoot: string | null;
  sessionIds: string[];
}

export interface SessionHistoryResult<T> {
  status: 'ready' | 'unavailable' | 'error';
  source: 'codex-rollout';
  data: T;
  error: string | null;
}

export interface TaskSummary {
  id: string;
  title: string;
  projectRoot: string;
  sessionId: string;
  turnIds: string[];
  createdAt: string;
  updatedAt: string;
  eventCount: number;
  status: 'queued' | 'generating' | 'ready' | 'failed';
  error: string | null;
}

export interface TaskScript {
  id: string;
  title: string;
  language: 'shell' | 'javascript' | 'typescript' | 'python' | 'other';
  content: string;
  status: 'draft';
  createdAt: string;
  updatedAt: string;
}

export interface SaveTaskScriptInput {
  id?: string;
  title: string;
  language: TaskScript['language'];
  content: string;
}

export type TaskChangeReason =
  | 'generation-queued'
  | 'generation-started'
  | 'generation-ready'
  | 'generation-failed'
  | 'discussion-updated'
  | 'script-saved';

export interface TaskChangeEvent {
  task: TaskSummary;
  reason: TaskChangeReason;
}

export interface TaskRecord extends TaskSummary {
  version: number;
  evidence: {
    source: 'codex-rollout';
    sessionFile: string;
    eventCount: number;
  };
  document: {
    format: 'markdown';
    generatedAt: string;
    markdown: string;
    projectFile?: string;
    generator?: {
      type: 'model';
      provider: 'deepseek';
      model: string;
      callId: string;
      skill: {
        name: string;
        digest: string;
      };
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    };
  } | null;
  discussion: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
    callId?: string;
  }>;
  scripts: TaskScript[];
}

export interface CreateTaskInput {
  projectRoot: string;
  sessionId: string;
  turnIds: string[];
  title?: string;
}

export interface TaskResult<T> {
  status: 'ready' | 'error';
  source: 'workbench-task';
  data: T;
  error: string | null;
}

export type ReviewRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ReviewSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ReviewAnnotationVerdict = 'correct' | 'incorrect';
export type ReviewCategory = 'process_efficiency' | 'tool_usage' | 'repeated_failure' | 'architecture' | 'maintainability' | 'performance' | 'security' | 'testability';

export interface ReviewSummary {
  caseId: string;
  sourceType: 'task' | 'manual_turn_selection' | 'daily_auto' | 're_review';
  sourceTaskId: string | null;
  turnCount: number;
  createdAt: string;
  runStatus: ReviewRunStatus;
  completedAt: string | null;
  failureReason: string | null;
  judgementCount: number;
  reviewedCount: number;
  highestSeverity: ReviewSeverity | null;
}

export interface ReviewRecord {
  schemaVersion: '1.0-draft';
  reviewCase: {
    caseId: string;
    projectId: string;
    sourceType: ReviewSummary['sourceType'];
    sourceTaskId?: string;
    turns: Array<{ sessionId: string; turnId: string }>;
    createdAt: string;
  };
  runs: Array<{
    runId: string;
    caseId: string;
    invocation: { provider: string; model: string; modelVersion?: string; promptVersion: string; reviewPolicyVersion: string; evidenceSchemaVersion: string };
    startedAt: string;
    completedAt?: string;
    status: ReviewRunStatus;
    latencyMs?: number;
    failureReason?: string;
  }>;
  judgements: Array<{
    judgementId: string;
    runId: string;
    category: ReviewCategory;
    title: string;
    summary: string;
    severity: ReviewSeverity;
    confidence: number;
    impact: string;
    alternativeExplanation: string;
    recommendation: string;
    reviewability: 'sufficient' | 'insufficient' | 'needs_raw' | 'needs_project_context';
    createdAt: string;
  }>;
  evidence: Array<{
    evidenceId: string;
    judgementId: string;
    evidenceType: string;
    targetType: 'event' | 'turn_diff' | 'project_profile' | 'environment_snapshot' | 'environment_delta' | 'project_diff' | 'raw_ref' | 'project_file';
    targetId: string;
    description: string;
    cachedExcerpt?: string;
    contentHash?: string;
  }>;
  annotations: Array<{
    annotationId: string;
    judgementId: string;
    annotatorId: string;
    verdict: ReviewAnnotationVerdict;
    reason?: string;
    missingIssue?: string;
    createdAt: string;
  }>;
}

export type ReviewStartInput =
  | { source: 'task'; taskId: string }
  | { source: 'turns'; projectRoot: string; sessionId: string; turnIds: string[] };

export interface ReviewAnnotationInput {
  caseId: string;
  judgementId: string;
  verdict: ReviewAnnotationVerdict;
  reason?: string;
  missingIssue?: string;
  immediateOptimize?: boolean;
}

export interface TemporaryPrompt {
  promptId: string;
  projectId: string;
  projectName: string;
  caseId: string;
  runId: string;
  judgementId: string;
  title: string;
  content: string;
  createdAt: string;
  status: 'visible' | 'hidden';
}

export interface ReviewEvidenceResolution {
  evidence: ReviewRecord['evidence'][number];
  availability: 'available' | 'changed' | 'unavailable';
  content: string;
  currentContentHash?: string;
  message?: string;
  location: { kind: 'activity'; sessionId: string; turnId: string; eventId: string } | { kind: 'project_file'; relativePath: string } | { kind: 'inline' };
}

export interface ReviewChangeEvent {
  caseId: string;
  projectId: string;
  state: 'created' | 'running' | 'completed' | 'failed' | 'annotated';
  error?: string;
}

export interface ReviewResult<T> {
  status: 'ready' | 'error';
  source: 'workbench-review';
  data: T;
  error: string | null;
}

export interface DailyReviewScheduleProject {
  projectRoot: string;
  registeredAt: string;
  pendingDates: string[];
  status: 'idle' | 'queued' | 'running' | 'completed' | 'failed';
  lastRun: { localDate: string; status: 'completed' | 'failed'; completedAt: string; error: string | null } | null;
  lastError: string | null;
}

export interface DailyReviewScheduleState {
  version: 1;
  started: boolean;
  projects: DailyReviewScheduleProject[];
  reminders: Array<{ projectRoot: string; localDate: string; status: DailyReviewScheduleProject['status']; lastError: string | null }>;
}

export interface SyncTaskManifest {
  version: number;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  projectFile: string;
  source: {
    provider: 'codex';
    sessionId: string;
    turnIds: string[];
  };
  turns: Array<{
    id: string;
    sessionId: string;
    cwd: string | null;
    userInput: string;
    startedAt: string | null;
    updatedAt: string | null;
    status: HistoryTurnSummary['status'];
    metrics: Record<string, unknown>;
    eventCount: number;
  }>;
  eventCount: number;
  privacy: {
    redacted: boolean;
    absolutePathsRemoved: boolean;
    rawSessionIncluded: boolean;
  };
}

export interface WorkbenchValidationResult {
  version: 1;
  profileId: string;
  status: 'passed' | 'failed' | 'incomplete' | 'unknown';
  checks: WorkbenchValidationCheckResult[];
  generatedAt?: string;
  sessionId?: string;
  generationId?: string;
}

export interface SyncEvidenceRecord {
  version: number;
  taskId: string;
  sessionId: string;
  turnId: string;
  sequence: number;
  event: {
    kind: string;
    timestamp: string | null;
    name: string;
    detail: string;
    callId: string | null;
    success: boolean | null;
  };
  evidence: {
    sourceLine: number | null;
  };
}

export interface SyncTaskRecord extends SyncTaskManifest {
  evidence: SyncEvidenceRecord[];
}

export interface SyncResult<T> {
  status: 'ready' | 'error';
  source: 'workbench-sync';
  data: T;
  error: string | null;
}

export interface RepositoryChange {
  path: string;
  status: string;
  kind: 'modified' | 'deleted' | 'untracked';
  blocked: boolean;
}

export interface RepositoryStatus {
  root: string;
  branch: string;
  remoteName: string | null;
  remoteUrl: string | null;
  remote: string | null;
  changes: RepositoryChange[];
  clean: boolean;
  localAhead: number;
  remoteAhead: number;
  diverged: boolean;
}

export interface RepositoryResult<T> {
  status: 'ready' | 'error';
  source: 'workbench-sync';
  data: T;
  error: string | null;
}

export interface PublishRepositoryInput {
  projectRoot: string;
  selectedPaths?: string[];
  message?: string;
}

export type ProjectAssetCategoryId =
  | 'agent-instructions'
  | 'project-overview'
  | 'design-decisions'
  | 'development-standards'
  | 'testing-standards'
  | 'skills'
  | 'reference'
  | 'task-flows';

export interface ProjectAssetFile {
  relativePath: string;
  name: string;
  size: number;
  updatedAt: string;
}

export interface ProjectAssetCategory {
  id: ProjectAssetCategoryId;
  label: string;
  basePath: string;
  writable: boolean;
  files: ProjectAssetFile[];
}

export interface ProjectAssetIndex {
  projectRoot: string;
  initialized: boolean;
  tree: ProjectDocumentNode[];
  categories: ProjectAssetCategory[];
}

export interface ProjectDocumentNode {
  type: 'folder' | 'file';
  name: string;
  relativePath: string;
  children: ProjectDocumentNode[];
}

export interface ProjectAssetDocument {
  projectRoot: string;
  category: ProjectAssetCategoryId;
  relativePath: string;
  markdown: string;
}

export interface ProjectAssetDraft {
  projectRoot: string;
  taskId: string;
  category: ProjectAssetCategoryId;
  relativePath: string;
  before: string;
  beforeHash: string;
  after: string;
  generatedAt: string;
  model: string;
  callId: string;
}

export interface CreateProjectAssetDraftInput {
  projectRoot: string;
  taskId: string;
  experience: string;
  category: ProjectAssetCategoryId;
  relativePath: string;
}

export interface WriteProjectAssetDraftInput {
  projectRoot: string;
  category: ProjectAssetCategoryId;
  relativePath: string;
  beforeHash: string;
  markdown: string;
}

export interface ProjectAssetResult<T> {
  status: 'ready' | 'error';
  source: 'workbench-assets';
  data: T;
  error: string | null;
}

export interface ModelStatus {
  provider: 'deepseek';
  model: 'deepseek-v4-flash';
  configured: boolean;
  credentialSource: 'saved' | 'environment' | null;
}

export interface ModelCompletion {
  callId: string;
  id: string | null;
  model: string;
  content: string;
  reasoningContent: string | null;
  finishReason: string | null;
  latencyMs?: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface ModelCallSummary {
  callId: string;
  purpose: string;
  projectRoot: string | null;
  taskId: string | null;
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
  status: 'running' | 'completed' | 'failed';
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelCallEvent {
  version: number;
  event: 'request.started' | 'response.completed' | 'response.failed';
  callId: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface ModelResult<T> {
  status: 'ready' | 'unavailable' | 'error';
  source: 'deepseek';
  data: T;
  error: string | null;
}

export interface WorkbenchBridge {
  openProject(): Promise<WorkbenchState>;
  getState(): Promise<WorkbenchState>;
  refresh(): Promise<WorkbenchState>;
  startLiveObservation(): Promise<WorkbenchState>;
  useHistoryObservation(): Promise<WorkbenchState>;
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
  getDailyReviewState(): Promise<DailyReviewScheduleState>;
  registerDailyReviewProject(projectRoot?: string | null): Promise<DailyReviewScheduleState>;
  unregisterDailyReviewProject(projectRoot?: string | null): Promise<DailyReviewScheduleState>;
  runPendingDailyReview(projectRoot: string, localDate: string): Promise<ReviewResult<null>>;
  snoozeDailyReview(projectRoot: string, localDate: string): Promise<DailyReviewScheduleState>;
  listSyncTasks(projectRoot?: string | null): Promise<SyncResult<SyncTaskManifest[]>>;
  readSyncTask(projectRoot: string, taskId: string): Promise<SyncResult<SyncTaskRecord | null>>;
  addTaskToSync(taskId: string): Promise<SyncResult<SyncTaskManifest | null>>;
  getRepositoryStatus(projectRoot?: string | null): Promise<RepositoryResult<RepositoryStatus | null>>;
  pullRepository(projectRoot?: string | null): Promise<RepositoryResult<RepositoryStatus | null>>;
  publishRepository(input: PublishRepositoryInput): Promise<RepositoryResult<RepositoryStatus | null>>;
  createGithubRepository(input: { projectRoot: string; name: string; privateRepository?: boolean }): Promise<RepositoryResult<RepositoryStatus | null>>;
  onTaskChanged(handler: (change: TaskChangeEvent) => void): () => void;
  onReviewChanged(handler: (change: ReviewChangeEvent) => void): () => void;
  onDailyReviewChanged(handler: (state: DailyReviewScheduleState) => void): () => void;
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
  getModelStatus(): Promise<ModelResult<ModelStatus>>;
  saveDeepSeekApiKey(apiKey: string): Promise<ModelResult<ModelStatus>>;
  clearDeepSeekApiKey(): Promise<ModelResult<ModelStatus>>;
  testDeepSeekConnection(): Promise<ModelResult<ModelCompletion | null>>;
  listModelCalls(): Promise<ModelResult<ModelCallSummary[]>>;
  readModelCall(callId: string): Promise<ModelResult<ModelCallEvent[] | null>>;
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
    const nodes = mergeContentNodes(turn.children ?? []);
    const topLevel: AgentOperation[] = [];
    const positions = new Map<string, number>();

    nodes.forEach((node, position) => {
      if (node.type === 'agent_tool' || node.type === 'event') {
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

  let embeddedChanges: CodeChanges | undefined;
  const appliedChanges = appliedChangesFor(node);
  if (appliedChanges) embeddedChanges = mapAppliedChanges(node, appliedChanges, id, projectRoot);
  const writeContent = null;
  if (!embeddedChanges && writeContent) embeddedChanges = mapWriteContent(node, writeContent, id, projectRoot);
  const replaceContent = null;
  if (!embeddedChanges && replaceContent) {
    embeddedChanges = mapStrReplaceContent(node, replaceContent, id, projectRoot);
  }

  const row = baseRow(node, 'operation', method, provider, projectRoot, args);
  if (isContentMethod(method)) row.target = '';
  const editPath = editPathFor(node, args, embeddedChanges, projectRoot);
  if (method === 'EDIT' && editPath) {
    row.scope = lastPathSegment(editPath.relative);
    row.target = node.name || 'Edit';
  }

  return {
    ...row,
    id,
    sortTimestamp: toTimestamp(node.startedAt) ?? undefined,
    provider,
    startedAt: formatStartedAt(node.startedAt),
    duration: formatDuration(node),
    workingDirectory: editPath?.relative || workingDirectory(args, projectRoot),
    arguments: args,
    result: node.output,
    error: errorText(node),
    content: contentForNode(node),
    rawRecord: rawRecord(node, turn),
    children,
    embeddedChanges,
    scopeTooltip: editPath?.relative,
  };
}

function editPathFor(
  node: WorkbenchTimelineNode,
  args: Record<string, unknown>,
  embedded: CodeChanges | undefined,
  projectRoot: string | null,
): { absolute: string; relative: string } | null {
  const fromArgs = firstString(args, ['file_path', 'path', 'filePath', 'file']);
  if (fromArgs) {
    const relative = displayPathFor(fromArgs, projectRoot);
    return { absolute: fromArgs, relative };
  }
  const firstFile = embedded?.files[0]?.path;
  if (firstFile) {
    return { absolute: firstFile, relative: displayPathFor(firstFile, projectRoot) };
  }
  if (typeof node.output === 'object' && node.output && !Array.isArray(node.output)) {
    const outputPath = firstString(node.output as Record<string, unknown>, ['file_path', 'path']);
    if (outputPath) {
      return { absolute: outputPath, relative: displayPathFor(outputPath, projectRoot) };
    }
  }
  return null;
}

function lastPathSegment(relativePath: string): string {
  const parts = relativePath.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.at(-1) || relativePath;
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

function mapAppliedChanges(
  node: WorkbenchTimelineNode,
  changes: Record<string, unknown>,
  parentId: string,
  projectRoot: string | null,
): CodeChanges {
  const files: ChangedFile[] = Object.entries(changes).flatMap<ChangedFile>(([filePath, rawChange]) => {
    if (!rawChange || typeof rawChange !== 'object' || Array.isArray(rawChange)) return [];
    const change = rawChange as Record<string, unknown>;
    const type = typeof change.type === 'string' ? change.type : 'update';
    const displayPath = displayPathFor(filePath, projectRoot);
    if (type === 'add' && typeof change.content === 'string') {
      return [{
        path: displayPath,
        change: 'added' as const,
        language: languageForPath(displayPath),
        before: '',
        after: change.content,
        additions: lineCount(change.content),
        deletions: 0,
      }];
    }
    const unified = typeof change.unified_diff === 'string' ? change.unified_diff : '';
    const parsed = parsePatchFiles(`diff --git a/${displayPath} b/${displayPath}\n--- a/${displayPath}\n+++ b/${displayPath}\n${unified}`);
    return parsed.map(file => ({
      ...file,
      path: displayPath,
      previousPath: typeof change.move_path === 'string'
        ? displayPathFor(change.move_path, projectRoot)
        : file.previousPath,
      change: type === 'delete' ? 'deleted' as const
        : type === 'move' || change.move_path ? 'renamed' as const
          : file.change,
    }));
  });
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const summary = `${files.length} ${files.length === 1 ? 'file' : 'files'} · +${additions} −${deletions}`;
  return {
    id: `${parentId}:exact-diff`,
    kind: 'changes',
    method: 'DIFF',
    status: node.failed ? 'ERROR' : 'CHANGED',
    source: 'Applied patch',
    scope: node.cwd || projectRoot || 'Project',
    target: summary,
    color: node.failed ? '#e1421f' : '#f1971f',
    sortTimestamp: toTimestamp(node.startedAt) ?? undefined,
    summary,
    files,
    projectFiles: files.map(file => ({ path: file.path, language: file.language, source: file.after, change: file.change })),
    rawRecord: { attribution: 'exact', source: 'patch_apply_end', changes, operationId: node.id },
    detailMode: 'files',
  };
}

function appliedChangesFor(node: WorkbenchTimelineNode): Record<string, unknown> | null {
  if ((node.name ?? '').toLowerCase() !== 'apply_patch') return null;
  if (node.appliedChangeSuccess !== true || node.failed || node.status !== 'completed') return null;
  return node.appliedChanges && typeof node.appliedChanges === 'object' && !Array.isArray(node.appliedChanges)
    ? node.appliedChanges as Record<string, unknown>
    : null;
}

export function mapRecordedChangesForTurn(
  turn: WorkbenchTimelineNode,
  projectRoot: string | null,
): CodeChanges | null {
  const patches = (turn.children ?? [])
    .filter(node => node.type === 'agent_tool')
    .map(node => ({ node, changes: appliedChangesFor(node) }))
    .filter((item): item is { node: WorkbenchTimelineNode; changes: Record<string, unknown> } => item.changes !== null);
  if (patches.length === 0) return null;

  const files = patches.flatMap(({ node, changes }) =>
    mapAppliedChanges(node, changes, turn.id, projectRoot).files,
  );
  const uniquePaths = new Set(files.map(file => file.path));
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const summary = `${uniquePaths.size} ${uniquePaths.size === 1 ? 'file' : 'files'} · ${patches.length} recorded ${patches.length === 1 ? 'patch' : 'patches'} · +${additions} −${deletions}`;
  const projectFiles = [...new Map(files.map(file => [file.path, {
    path: file.path,
    language: file.language,
    source: file.after,
    change: file.change,
  }])).values()];

  return {
    id: `${turn.id}:recorded-changes`,
    kind: 'changes',
    method: 'RECORDED CHANGES',
    status: 'CHANGED',
    source: 'Codex',
    scope: projectRoot || 'Project',
    target: summary,
    color: '#f1971f',
    sortTimestamp: toTimestamp(turn.endedAt ?? turn.startedAt) ?? undefined,
    summary,
    files,
    projectFiles,
    rawRecord: {
      attribution: 'recorded-patches',
      sessionId: turn.sessionId ?? null,
      turnId: turn.generationId ?? null,
      patchOperationIds: patches.map(item => item.node.id),
    },
    detailMode: 'files',
  };
}

function lineCount(value: string): number {
  return value === '' ? 0 : value.split(/\r?\n/).length;
}

type WriteContent = {
  path: string;
  content: string;
  truncated: boolean;
};

function writeContentFor(node: WorkbenchTimelineNode): WriteContent | null {
  const name = (node.name ?? '').toLowerCase();
  if (!['write', 'write_file'].includes(name)) return null;
  if (node.failed) return null;
  return extractWriteContent(node.arguments);
}

type StrReplaceContent = {
  path: string;
  before: string;
  after: string;
};

function strReplaceContentFor(node: WorkbenchTimelineNode): StrReplaceContent | null {
  const name = (node.name ?? '').toLowerCase();
  if (!['strreplace', 'search_replace', 'edit'].includes(name)) return null;
  if (node.failed) return null;
  const args = asRecord(node.arguments);
  if (args.$summary === 'truncated') return null;
  const filePath = firstString(args, ['file_path', 'path', 'filePath', 'file']);
  const before = firstString(args, ['old_string', 'oldString', 'old_str']);
  const after = firstString(args, ['new_string', 'newString', 'new_str']);
  if (!filePath || before == null || after == null) return null;
  return { path: filePath, before, after };
}

function mapStrReplaceContent(
  node: WorkbenchTimelineNode,
  replace: StrReplaceContent,
  parentId: string,
  projectRoot: string | null,
): CodeChanges {
  const displayPath = displayPathFor(replace.path, projectRoot);
  const additions = replace.after === '' ? 0 : replace.after.split(/\r?\n/).length;
  const deletions = replace.before === '' ? 0 : replace.before.split(/\r?\n/).length;
  const summary = `1 file · +${additions} −${deletions}`;
  const file = {
    path: displayPath,
    change: 'modified' as const,
    language: languageForPath(displayPath),
    before: replace.before,
    after: replace.after,
    additions,
    deletions,
  };
  return {
    id: `${parentId}:strreplace-content`,
    kind: 'changes',
    method: 'DIFF',
    status: node.failed ? 'ERROR' : 'CHANGED',
    source: 'StrReplace',
    scope: node.cwd || projectRoot || 'Project',
    target: summary,
    color: node.failed ? '#e1421f' : '#f1971f',
    sortTimestamp: toTimestamp(node.startedAt) ?? undefined,
    summary,
    files: [file],
    projectFiles: [{ path: displayPath, language: file.language, source: replace.after, change: 'modified' }],
    rawRecord: {
      attribution: 'exact',
      source: 'strreplace',
      filePath: replace.path,
      operationId: node.id,
    },
    detailMode: 'files',
  };
}

function extractWriteContent(args: unknown): WriteContent | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const record = args as Record<string, unknown>;

  if (record.$summary === 'truncated' && typeof record.$preview === 'string') {
    return parseWritePreview(record.$preview, true);
  }

  const filePath = firstString(record, ['file_path', 'path', 'filePath', 'file']);
  const content = firstString(record, ['content', 'contents', 'text']);
  if (!filePath || content == null) return null;
  return { path: filePath, content, truncated: false };
}

function parseWritePreview(preview: string, truncated: boolean): WriteContent | null {
  try {
    const parsed = JSON.parse(preview) as Record<string, unknown>;
    const filePath = firstString(parsed, ['file_path', 'path', 'filePath', 'file']);
    const content = firstString(parsed, ['content', 'contents', 'text']);
    if (filePath && content != null) return { path: filePath, content, truncated };
  } catch {
    // Preview is often cut mid-string; recover fields with regex.
  }

  const pathMatch = /"(?:file_path|path|filePath|file)"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(preview);
  const contentMatch = /"(?:content|contents|text)"\s*:\s*"((?:\\.|[^"\\])*)/.exec(preview);
  if (!pathMatch || !contentMatch) return null;
  return {
    path: unescapeJsonString(pathMatch[1]),
    content: unescapeJsonString(contentMatch[1]),
    truncated,
  };
}

function mapWriteContent(
  node: WorkbenchTimelineNode,
  write: WriteContent,
  parentId: string,
  projectRoot: string | null,
): CodeChanges {
  const displayPath = displayPathFor(write.path, projectRoot);
  const lines = write.content === '' ? 0 : write.content.split(/\r?\n/).length;
  const summary = write.truncated
    ? `1 file · +${lines} (truncated preview)`
    : `1 file · +${lines}`;
  const file = {
    path: displayPath,
    change: 'added' as const,
    language: languageForPath(displayPath),
    before: '',
    after: write.content,
    additions: lines,
    deletions: 0,
  };
  return {
    id: `${parentId}:write-content`,
    kind: 'changes',
    method: 'DIFF',
    status: node.failed ? 'ERROR' : 'CHANGED',
    source: write.truncated ? 'Write Preview' : 'Write',
    scope: node.cwd || projectRoot || 'Project',
    target: summary,
    color: node.failed ? '#e1421f' : '#f1971f',
    sortTimestamp: toTimestamp(node.startedAt) ?? undefined,
    summary,
    files: [file],
    projectFiles: [{ path: displayPath, language: file.language, source: write.content, change: 'added' }],
    rawRecord: {
      attribution: 'exact',
      source: 'write',
      truncated: write.truncated,
      filePath: write.path,
      operationId: node.id,
    },
    detailMode: 'files',
  };
}

function displayPathFor(filePath: string, projectRoot: string | null): string {
  const normalized = filePath.replaceAll('\\', '/');
  if (!projectRoot) return normalized;
  const root = projectRoot.replaceAll('\\', '/').replace(/\/$/, '');
  const lowerPath = normalized.toLowerCase();
  const lowerRoot = root.toLowerCase();
  if (lowerPath.startsWith(`${lowerRoot}/`)) return normalized.slice(root.length + 1);
  return normalized;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

function unescapeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
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
  const status = statusFor(node, method);
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

const CONTENT_METHODS = new Set(['REASONING', 'USER INPUT', 'ASSISTANT']);
const MERGEABLE_CONTENT_METHODS = new Set(['REASONING', 'ASSISTANT']);

function isContentMethod(method: string): boolean {
  return CONTENT_METHODS.has(method);
}

function contentForNode(node: WorkbenchTimelineNode): string | undefined {
  if (!isContentMethod(node.method || methodForTool(node.name))) return undefined;
  if (typeof node.content !== 'string') return undefined;
  const content = node.content.trim();
  return content || undefined;
}

function mergeContentNodes(nodes: WorkbenchTimelineNode[]): WorkbenchTimelineNode[] {
  const merged: WorkbenchTimelineNode[] = [];
  for (const node of nodes) {
    const method = node.method || methodForTool(node.name);
    const previous = merged.at(-1);
    const previousMethod = previous?.method || (previous ? methodForTool(previous.name) : '');
    if (!previous || !MERGEABLE_CONTENT_METHODS.has(method) || previousMethod !== method) {
      merged.push(node);
      continue;
    }

    const previousContent = contentForNode(previous);
    const currentContent = contentForNode(node);
    merged[merged.length - 1] = {
      ...previous,
      endedAt: node.endedAt ?? previous.endedAt,
      content: [previousContent, currentContent].filter(Boolean).join('\n\n'),
      mergedRecords: [
        ...(previous.mergedRecords ?? [previous]),
        node,
      ],
    };
  }
  return merged;
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

function statusFor(node: WorkbenchTimelineNode, method: string): string {
  const status = (node.status ?? '').trim().toLowerCase();
  const failed = node.failed || node.error != null || outputFailed(node.output) || status === 'error' || status === 'failed';
  const isShell = method === 'SHELL';

  // Only Shell keeps the tool's own status vocabulary for display.
  if (isShell) {
    if (failed) return status === 'error' ? 'error' : 'failed';
    if (status) return status;
    if (node.incomplete) return 'pending';
    return 'unknown';
  }

  if (failed) return 'ERROR';
  if (node.incomplete || status === 'pending' || status === 'running') return 'RUNNING';
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
  if (value.includes('codex')) return 'Codex';
  return fallback;
}

function colorFor(status: string, provider: AgentProvider, kind: PreviewRecord['kind']): string {
  const normalized = status.toLowerCase();
  if (normalized === 'error' || normalized === 'failed') return '#e1421f';
  if (normalized === 'running' || normalized === 'pending' || normalized === 'changed' || normalized === 'observed') {
    return '#f1971f';
  }
  if (kind === 'call') return '#5b96a3';
  return '#6284fa';
}

export function isErrorStatus(status: string | undefined): boolean {
  const normalized = (status ?? '').toLowerCase();
  return normalized === 'error' || normalized === 'failed';
}

function scopedId(turn: WorkbenchTimelineNode, node: WorkbenchTimelineNode, provider: AgentProvider): string {
  const session = turn.sessionId || turn.generationId || 'session';
  return `${provider.toLowerCase()}:${session}:${node.id}`;
}

function rawRecord(node: WorkbenchTimelineNode, turn: WorkbenchTimelineNode): Record<string, unknown> {
  const mergedRecords = node.mergedRecords;
  return {
    ...node,
    ...(mergedRecords ? {
      content: contentForNode(node),
      mergedRecords: mergedRecords.map(record => ({
        ...record,
        session: {
          sessionId: record.sessionId ?? turn.sessionId ?? null,
          generationId: record.generationId ?? turn.generationId ?? null,
          sessionFile: record.sessionFile ?? null,
        },
      })),
    } : {}),
    session: {
      sessionId: node.sessionId ?? turn.sessionId ?? null,
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
  if (typeof node.content === 'string' && node.content.trim()) return oneLine(node.content);
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
