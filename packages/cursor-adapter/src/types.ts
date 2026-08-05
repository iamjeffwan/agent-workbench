/** Normalized agent tool step shared with the verification viewer. */
export type AgentToolStep = {
  kind: 'agent_tool';
  /** Synthetic id used as process origin id when a tool launches a process. */
  id: string;
  name: string;
  arguments: unknown;
  output?: string;
  startedAt: string | null;
  endedAt: string | null;
  status: 'pending' | 'completed';
  sessionFile: string;
  /** Which agent produced this step. */
  provider: 'cursor';
  source?: 'cursor-transcript' | 'cursor-hook';
  conversationId?: string;
  generationId?: string;
  cwd?: string;
  projectAssignment?: 'workspace_roots';
  launchesProcess?: boolean;
  durationMs?: number;
  failed?: boolean;
  error?: unknown;
};

export type CursorTranscriptLine = {
  role?: string;
  type?: string;
  message?: {
    content?: Array<Record<string, unknown>>;
  };
};
