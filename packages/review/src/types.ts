export type ReviewSourceType = 'task' | 'manual_turn_selection' | 'daily_auto' | 're_review';
export type ReviewRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ReviewCategory =
  | 'process_efficiency'
  | 'tool_usage'
  | 'repeated_failure'
  | 'architecture'
  | 'maintainability'
  | 'performance'
  | 'security'
  | 'testability';
export type ReviewSeverity = 'low' | 'medium' | 'high' | 'critical';
export type Reviewability = 'sufficient' | 'insufficient' | 'needs_raw' | 'needs_project_context';
export type AnnotationVerdict = 'correct' | 'incorrect';
export type EvidenceTargetType =
  | 'event'
  | 'turn_diff'
  | 'project_profile'
  | 'environment_snapshot'
  | 'environment_delta'
  | 'project_diff'
  | 'raw_ref'
  | 'project_file';

export type ReviewTurnRef = {
  sessionId: string;
  turnId: string;
};

export type ReviewCase = {
  caseId: string;
  projectId: string;
  sourceType: ReviewSourceType;
  sourceTaskId?: string;
  turns: ReviewTurnRef[];
  createdAt: string;
};

export type ModelInvocation = {
  provider: string;
  model: string;
  modelVersion?: string;
  promptVersion: string;
  reviewPolicyVersion: string;
  evidenceSchemaVersion: string;
};

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ReviewRunArtifact = {
  kind: 'request' | 'output_schema' | 'model_output' | 'stdout' | 'stderr';
  path: string;
  contentHash: string;
  byteLength: number;
};

export type ReviewRun = {
  runId: string;
  caseId: string;
  invocation: ModelInvocation;
  startedAt: string;
  completedAt?: string;
  status: ReviewRunStatus;
  usage?: ModelUsage;
  actualCost?: number;
  latencyMs?: number;
  failureReason?: string;
  artifacts?: ReviewRunArtifact[];
};

export type ModelJudgement = {
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
  reviewability: Reviewability;
  issueFingerprint?: string;
  createdAt: string;
};

export type Evidence = {
  evidenceId: string;
  judgementId: string;
  evidenceType: string;
  targetType: EvidenceTargetType;
  targetId: string;
  description: string;
  cachedExcerpt?: string;
  cacheExpiresAt?: string;
  contentHash?: string;
};

export type HumanAnnotation = {
  annotationId: string;
  judgementId: string;
  annotatorId: string;
  verdict: AnnotationVerdict;
  reason?: string;
  missingIssue?: string;
  createdAt: string;
};

export type TemporaryPrompt = {
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
};

export type ReviewCaseRecord = {
  schemaVersion: '1.0-draft';
  reviewCase: ReviewCase;
  runs: ReviewRun[];
  judgements: ModelJudgement[];
  evidence: Evidence[];
  annotations: HumanAnnotation[];
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export type ValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: ValidationIssue[] };

export type ReviewRunResult = {
  run: ReviewRun;
  judgements: ModelJudgement[];
  evidence: Evidence[];
};

export type DailyReviewBatchStatus = 'queued' | 'running' | 'partial' | 'completed' | 'failed';
export type DailyReviewChunkStatus = 'queued' | 'running' | 'completed' | 'failed';
export type DailyReviewSynthesisStatus = 'queued' | 'running' | 'completed' | 'failed';

export type DailyReviewSynthesis = {
  status: DailyReviewSynthesisStatus;
  invocation?: ModelInvocation;
  startedAt?: string;
  completedAt?: string;
  usage?: ModelUsage;
  actualCost?: number;
  latencyMs?: number;
  failureReason?: string;
  artifacts?: ReviewRunArtifact[];
};

export type DailyReviewBatch = {
  batchId: string;
  projectId: string;
  localDate: string;
  timeZone: string;
  status: DailyReviewBatchStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  synthesis: DailyReviewSynthesis;
};

export type DailyReviewChunk = {
  chunkId: string;
  batchId: string;
  sequence: number;
  groupKey: string;
  turns: ReviewTurnRef[];
  characterCount: number;
  status: DailyReviewChunkStatus;
  reviewCaseId?: string;
  reusedRunId?: string;
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
};

export type DailyIssue = {
  issueId: string;
  batchId: string;
  issueFingerprint: string;
  category: ReviewCategory;
  title: string;
  summary: string;
  severity: ReviewSeverity;
  impact: string;
  recommendation: string;
  sourceJudgementIds: string[];
  createdAt: string;
};

export type DailyReviewRecord = {
  batch: DailyReviewBatch;
  chunks: DailyReviewChunk[];
  issues: DailyIssue[];
};

export type ReviewStore = {
  createCase(reviewCase: ReviewCase): Promise<ReviewCaseRecord>;
  recordRun(result: ReviewRunResult): Promise<ReviewCaseRecord>;
  appendAnnotation(annotation: HumanAnnotation): Promise<ReviewCaseRecord>;
  getCase(caseId: string): Promise<ReviewCaseRecord | undefined>;
  listCases(options?: { projectId?: string; limit?: number }): Promise<ReviewCase[]>;
  findReusableRun(query: ReusableReviewRunQuery): Promise<ReusableReviewRun | undefined>;
  createTemporaryPrompt(prompt: TemporaryPrompt): Promise<TemporaryPrompt>;
  listTemporaryPrompts(options: { projectId: string; includeHidden?: boolean; createdOn?: string }): Promise<TemporaryPrompt[]>;
  hideTemporaryPrompt(projectId: string, promptId: string): Promise<TemporaryPrompt>;
};

export type ReusableReviewRunQuery = {
  projectId: string;
  turns: ReviewTurnRef[];
  sourceTypes: ReviewSourceType[];
  invocation: Pick<ModelInvocation, 'provider' | 'model' | 'promptVersion' | 'reviewPolicyVersion' | 'evidenceSchemaVersion'> & {
    modelVersion?: string;
  };
};

export type ReusableReviewRun = {
  caseId: string;
  runId: string;
};

export type DailyReviewStore = {
  createDailyBatch(batch: DailyReviewBatch, chunks: DailyReviewChunk[]): Promise<DailyReviewRecord>;
  findDailyBatch(projectId: string, localDate: string): Promise<DailyReviewRecord | undefined>;
  getDailyBatch(batchId: string): Promise<DailyReviewRecord | undefined>;
  appendDailyChunks(batchId: string, chunks: DailyReviewChunk[]): Promise<DailyReviewRecord>;
  updateDailyBatch(batch: DailyReviewBatch): Promise<DailyReviewRecord>;
  updateDailyChunk(chunk: DailyReviewChunk): Promise<DailyReviewRecord>;
  replaceDailyIssues(batchId: string, issues: DailyIssue[]): Promise<DailyReviewRecord>;
};
