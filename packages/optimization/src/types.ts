export type ImpactLevel = 'none' | 'low' | 'medium' | 'high';
export type OptimizationProcessingStatus = 'classified' | 'pending_retry';

export type ObjectiveMetrics = {
  judgementCount: number;
  episodeCount: number;
  activeDayCount: number;
  dailyIssueCount: number;
  evidenceCount: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  toolCallCount: number;
  failedToolCallCount: number;
  repeatedToolCallCount: number;
  metricsComplete: boolean;
};

export type ImpactSignal = {
  key: string;
  label: string;
  level: ImpactLevel;
  confidence: number;
  rationale: string;
  sourceJudgementIds: string[];
};

export type OptimizationSourceJudgement = {
  judgementId: string;
  title: string;
  summary: string;
  impact: string;
  recommendation: string;
  evidence: Array<{ evidenceId: string; description: string; excerpt?: string }>;
};

export type OptimizationEpisode = {
  episodeKey: string;
  groupKey: string;
  localDate: string;
  turns: Array<{ sessionId: string; turnId: string }>;
  metrics: Omit<ObjectiveMetrics, 'judgementCount' | 'episodeCount' | 'activeDayCount' | 'dailyIssueCount' | 'evidenceCount'>;
};

export type DailyIssueSource = {
  dailyIssueId: string;
  batchId: string;
  projectId: string;
  localDate: string;
  fingerprint: string;
  category: string;
  title: string;
  summary: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  impact: string;
  recommendation: string;
  judgements: OptimizationSourceJudgement[];
  episodes: OptimizationEpisode[];
};

export type DailyIssueAssignment = {
  dailyIssueId: string;
  issueId: string;
  source: DailyIssueSource;
  status: OptimizationProcessingStatus;
  confidence: number;
  rationale: string;
  classificationError?: string;
  signals: ImpactSignal[];
  assignedAt: string;
};

export type OptimizationIssue = {
  issueId: string;
  projectId: string;
  title: string;
  summary: string;
  category: string;
  fingerprints: string[];
  createdAt: string;
  updatedAt: string;
  classificationStatus: OptimizationProcessingStatus;
  classificationError?: string;
  metrics: ObjectiveMetrics;
  highestSeverity: DailyIssueSource['severity'];
  severityCounts: Record<DailyIssueSource['severity'], number>;
  firstSeenAt: string;
  lastSeenAt: string;
  signals: Array<ImpactSignal & { occurrenceCount: number }>;
};

export type OptimizationIssueDetail = OptimizationIssue & { assignments: DailyIssueAssignment[] };

export type ClassificationRun = {
  runId: string;
  projectId: string;
  batchId: string;
  status: 'running' | 'completed' | 'failed';
  provider: string;
  model: string;
  modelVersion?: string;
  startedAt: string;
  completedAt?: string;
  failureReason?: string;
  usage?: Record<string, number>;
  latencyMs?: number;
};

export type OptimizationStore = {
  hasProcessedBatch(batchId: string): Promise<boolean>;
  recordBatch(input: { run: ClassificationRun; assignments: DailyIssueAssignment[]; newIssues: OptimizationIssue[] }): Promise<void>;
  recordFailedRun(run: ClassificationRun): Promise<void>;
  listIssues(projectId: string): Promise<OptimizationIssue[]>;
  getIssue(projectId: string, issueId: string): Promise<OptimizationIssueDetail | undefined>;
  listAssignments(projectId: string): Promise<DailyIssueAssignment[]>;
  reassignDailyIssue(projectId: string, dailyIssueId: string, targetIssueId?: string): Promise<OptimizationIssueDetail>;
  mergeIssues(projectId: string, sourceIssueId: string, targetIssueId: string): Promise<OptimizationIssueDetail>;
};
