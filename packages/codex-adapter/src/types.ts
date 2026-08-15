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
  conversationId?: string;
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
};

export type CodexRolloutLine = {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
};
