/** Normalized agent tool step for the verification viewer. */
export type AgentToolStep = {
  kind: 'agent_tool';
  /** Codex function_call.call_id — also used as process origin id when launching. */
  id: string;
  name: string;
  arguments: unknown;
  output?: unknown;
  startedAt: string | null;
  endedAt: string | null;
  status: 'pending' | 'completed';
  sessionFile: string;
  provider?: 'codex';
  sessionId?: string;
  generationId?: string;
  /** Working directory declared by the current Codex turn_context. */
  cwd?: string;
  projectAssignment?: 'turn_context';
  source?: 'codex-rollout';
  /** Outer transport call when Codex batches tools through exec. */
  transportId?: string;
  transportName?: string;
  launchesProcess?: boolean;
  durationMs?: number;
  failed?: boolean;
  error?: unknown;
  outcome?: 'exact' | 'transport-only';
  /** Structured changes reported by Codex after a patch was actually applied. */
  appliedChanges?: Record<string, unknown>;
  appliedChangeSuccess?: boolean;
  sourceLine?: number;
  eventKind?: CodexTimelineEventKind;
  content?: string;
  role?: 'user' | 'assistant';
  tokenUsage?: {
    input?: number | null;
    cachedInput?: number | null;
    cacheWriteInput?: number | null;
    output?: number | null;
    reasoningOutput?: number | null;
    total?: number | null;
  };
};

export type CodexTimelineEventKind =
  | 'user_input'
  | 'assistant_message'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'command'
  | 'file_change'
  | 'test_result'
  | 'model_call'
  | 'context_ref'
  | 'task_status';

/** Normalized non-secret observation event used to build the project timeline. */
export type CodexTimelineEvent = AgentToolStep & {
  eventKind: CodexTimelineEventKind;
  content?: string;
  role?: 'user' | 'assistant';
  tokenUsage?: {
    input?: number | null;
    cachedInput?: number | null;
    cacheWriteInput?: number | null;
    output?: number | null;
    reasoningOutput?: number | null;
    total?: number | null;
  };
};

export type CodexRolloutLine = {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
};
