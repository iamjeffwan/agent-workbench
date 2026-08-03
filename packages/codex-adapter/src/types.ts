/** Normalized agent tool step for the verification viewer. */
export type AgentToolStep = {
  kind: 'agent_tool';
  /** Codex function_call.call_id — also used as process origin id when launching. */
  id: string;
  name: string;
  arguments: unknown;
  output?: string;
  startedAt: string | null;
  endedAt: string | null;
  status: 'pending' | 'completed';
  sessionFile: string;
  provider?: 'codex';
};

export type CodexRolloutLine = {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
};
