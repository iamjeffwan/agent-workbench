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
export type AnnotationVerdict = 'correct' | 'partially_correct' | 'incorrect';
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
  correctedCategory?: ReviewCategory;
  correctedSummary?: string;
  reason?: string;
  missingIssue?: string;
  createdAt: string;
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

export type ReviewStore = {
  createCase(reviewCase: ReviewCase): ReviewCaseRecord;
  recordRun(result: ReviewRunResult): ReviewCaseRecord;
  appendAnnotation(annotation: HumanAnnotation): ReviewCaseRecord;
  getCase(caseId: string): ReviewCaseRecord | undefined;
};
