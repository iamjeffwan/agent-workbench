export type SourceAgent = 'codex' | 'claude-code' | 'gemini-cli';
export type Provenance = 'direct' | 'derived' | 'supplemented';
export type Availability = 'full' | 'partial' | 'derived' | 'unavailable';
export type Fidelity = 'full' | 'partial';

export type RawRef = {
  sourceFile: string;
  line: number;
  sourceType: string;
  sourceId?: string;
};

export type Usage = {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
};

export type ObservationEventType =
  | 'message'
  | 'reasoning_summary'
  | 'tool_call'
  | 'tool_result'
  | 'file_change'
  | 'error'
  | 'lifecycle';

export type ObservationEvent = {
  eventId: string;
  turnId: string;
  sequence: number;
  type: ObservationEventType;
  timestamp?: string;
  actor?: 'user' | 'assistant' | 'system' | 'tool';
  status?: 'started' | 'completed' | 'failed' | 'aborted' | 'pending';
  category?: string;
  subtype?: string;
  callId?: string;
  sourceToolName?: string;
  content?: string;
  data?: unknown;
  usage?: Usage;
  sourceAgent: SourceAgent;
  sourceVersion: string;
  sourceEventType: string;
  adapterVersion: string;
  provenance: Provenance;
  fieldProvenance?: Record<string, Provenance>;
  fidelity: Fidelity;
  rawRef: RawRef;
};

export type ObservationTurn = {
  turnId: string;
  sequence: number;
  sourceRef: RawRef;
  startedAt?: string;
  endedAt?: string;
  status?: 'completed' | 'aborted' | 'in_progress';
  model?: string;
  cwd?: string;
  durationMs?: number;
  usage?: Usage;
  events: ObservationEvent[];
};

export type ObservationSessionMetadata = {
  sessionId: string;
  sourceAgent: SourceAgent;
  sourceVersion: string;
  adapterVersion: string;
  rawRef: RawRef;
  startedAt?: string;
  endedAt?: string;
  cwd?: string;
  model?: string;
  provider?: string;
  projectId?: string;
  fieldProvenance?: Record<string, Provenance>;
};

export type CapabilityManifest = {
  agent: SourceAgent;
  capabilities: Record<string, Availability>;
};

export type AdapterDiagnosticEntry = {
  rawRef: RawRef;
  reason: string;
};

export type AdapterDiagnostics = {
  unknownSourceEventCount: number;
  parseErrorCount: number;
  lossyEventCount: number;
  unsupportedFieldCount: number;
  entries: AdapterDiagnosticEntry[];
};

export type ObservationSession = {
  schemaVersion: '1.0-draft';
  session: ObservationSessionMetadata;
  turns: ObservationTurn[];
  capabilityManifest: CapabilityManifest;
  diagnostics: AdapterDiagnostics;
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export type ValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: ValidationIssue[] };
