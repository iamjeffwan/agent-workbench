export const EXPLORATION_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'SemanticSearch',
  'WebSearch',
  'WebFetch',
  'rg',
]);

export const PRIMARY_TOOLS = new Set([
  'Shell',
  'shell_command',
  'exec_command',
  'apply_patch',
  'Edit',
  'MultiEdit',
  'Write',
  'write_file',
  'Delete',
  'EditNotebook',
  'Task',
  'AwaitShell',
  'StrReplace',
]);

export type AgentStep = {
  id?: string;
  name?: string;
  status?: string;
  startedAt?: string | number;
  endedAt?: string | number;
  arguments?: unknown;
  output?: unknown;
  provider?: string;
  source?: string;
  launchesProcess?: boolean;
  generationId?: string;
  conversationId?: string;
  parseError?: boolean;
  durationMs?: number;
  sessionFile?: string;
  failed?: boolean;
  error?: unknown;
  cwd?: string;
  projectAssignment?: string;
  transportId?: string;
  transportName?: string;
  outcome?: string;
};

export type ProgramRecord = {
  callId?: number;
  methodId?: number;
  parentCallId?: number | null;
  processOriginId?: string;
  activityId?: string | null;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  args?: unknown;
  result?: unknown;
  error?: unknown;
  incomplete?: boolean;
  snapshotDegraded?: boolean;
  parseError?: boolean;
};

export type MethodInfo = {
  label?: string;
  sourceFile?: string;
  compiledFile?: string;
};

export type CodeChange = {
  kind?: string;
  id?: string;
  generationId?: string;
  conversationId?: string;
  provider?: string;
  startedAt?: string | number | null;
  endedAt?: string | number | null;
  beforeHash?: string | null;
  afterHash?: string | null;
  changed?: boolean | null;
  beforePatch?: string | null;
  afterPatch?: string | null;
  status?: string;
  source?: string;
  attribution?: 'exact' | 'unassigned' | string;
  projectRoot?: string;
  observationWindow?: unknown;
  parseError?: boolean;
};

export type TimelineNode = {
  type: string;
  id: string;
  parentId: string | null;
  name: string;
  status?: string;
  children?: TimelineNode[];
  [key: string]: unknown;
};

export type TimelineTurn = TimelineNode & {
  type: 'turn' | 'program_group';
  generationId?: string | null;
  conversationId?: string | null;
  provider?: string | null;
};

export type TimelineRoot = TimelineTurn | TimelineNode;

export type AgentToolClassification = {
  method: 'SEARCH' | 'EDIT' | 'SHELL' | 'TEST' | 'BUILD' | 'LINT' | 'TOOL' | 'DELEGATE' | 'INSPECT' | 'OTHER';
  category: 'search' | 'edit' | 'process' | 'validation' | 'tool' | 'delegate' | 'inspect' | 'internal' | 'unknown';
  normalized: boolean;
  display: boolean;
};

export function isExplorationTool(name: string | undefined): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase();
  if ([...PRIMARY_TOOLS].some((tool) => tool.toLowerCase() === normalized)) {
    return false;
  }
  if ([...EXPLORATION_TOOLS].some((tool) => tool.toLowerCase() === normalized)) {
    return true;
  }
  return true;
}

export function classifyAgentTool(step: Pick<AgentStep, 'name' | 'arguments' | 'failed' | 'error'>): AgentToolClassification {
  const name = (step.name || '').toLowerCase();
  const failed = step.failed || step.error != null;
  if (['read', 'read_file'].includes(name)) {
    return { method: 'OTHER', category: 'internal', normalized: true, display: !!failed };
  }
  if (['grep', 'glob', 'semanticsearch', 'websearch', 'webfetch', 'rg', 'web__run'].includes(name)) {
    return { method: 'SEARCH', category: 'search', normalized: true, display: true };
  }
  if (['apply_patch', 'edit', 'multiedit', 'strreplace', 'write', 'write_file', 'delete', 'editnotebook'].includes(name)) {
    return { method: 'EDIT', category: 'edit', normalized: true, display: true };
  }
  if (['shell', 'shell_command', 'exec_command'].includes(name)) {
    const command = argumentText(step.arguments, ['command', 'cmd']);
    if (isTestCommand(command)) return { method: 'TEST', category: 'validation', normalized: true, display: true };
    if (isLintCommand(command)) return { method: 'LINT', category: 'validation', normalized: true, display: true };
    if (isBuildCommand(command)) return { method: 'BUILD', category: 'validation', normalized: true, display: true };
    return { method: 'SHELL', category: 'process', normalized: true, display: true };
  }
  if (name === 'spawn_agent' || name === 'task' || name === 'interrupt_agent') {
    return { method: 'DELEGATE', category: 'delegate', normalized: true, display: true };
  }
  if (name.startsWith('mcp__') || ['callmcptool', 'getmcptools'].includes(name)) {
    return { method: 'TOOL', category: 'tool', normalized: true, display: true };
  }
  if (name === 'view_image') {
    return { method: 'INSPECT', category: 'inspect', normalized: true, display: !!failed };
  }
  if (['exec', 'wait', 'wait_agent', 'awaitshell', 'list_agents', 'send_message', 'followup_task', 'update_plan', 'request_user_input'].includes(name)) {
    return { method: 'OTHER', category: 'internal', normalized: true, display: !!failed };
  }
  return { method: 'OTHER', category: 'unknown', normalized: false, display: !!failed };
}

export function buildTimeline(
  agentSteps: AgentStep[],
  programRecords: ProgramRecord[],
  methods: Record<number, MethodInfo> = {},
  codeChanges: CodeChange[] = [],
): TimelineRoot[] {
  const programByOrigin = new Map<string, ProgramRecord[]>();
  for (const record of programRecords) {
    if (record.parseError) continue;
    const origin = record.processOriginId || '';
    const list = programByOrigin.get(origin) ?? [];
    list.push(record);
    programByOrigin.set(origin, list);
  }

  const usedOrigins = new Set<string>();
  const stepsByTurn = new Map<string, AgentStep[]>();

  for (const step of agentSteps) {
    if (!step?.id || step.parseError) continue;
    const turnKey = [
      step.provider || 'agent',
      step.conversationId || 'conversation',
      step.generationId || 'ungrouped',
    ].join(':');
    const list = stepsByTurn.get(turnKey) ?? [];
    list.push(step);
    stepsByTurn.set(turnKey, list);
  }

  const turns: TimelineRoot[] = [];
  let turnIndex = 0;
  for (const [turnKey, steps] of stepsByTurn.entries()) {
    turnIndex += 1;
    const primary: TimelineNode[] = [];

    for (const step of steps) {
      usedOrigins.add(step.id!);
      const programChildren = buildProgramTree(
        programByOrigin.get(step.id!) ?? [],
        methods,
        step.id!,
      );
      const classification = classifyAgentTool(step);
      if (classification.category === 'internal' && !classification.display) {
        continue;
      }
      const item: TimelineNode = {
        type: 'agent_tool',
        id: step.id!,
        parentId: null,
        name: step.name || 'tool',
        status: step.status,
        startedAt: step.startedAt,
        endedAt: step.endedAt,
        arguments: step.arguments,
        output: step.output,
        provider: step.provider || null,
        source: step.source || null,
        launchesProcess: !!step.launchesProcess,
        generationId: step.generationId || null,
        conversationId: step.conversationId || null,
        durationMs: step.durationMs,
        sessionFile: step.sessionFile || null,
        failed: !!step.failed,
        error: step.error,
        cwd: step.cwd || null,
        projectAssignment: step.projectAssignment || null,
        transportId: step.transportId || null,
        transportName: step.transportName || null,
        outcome: step.outcome || null,
        method: classification.method,
        category: classification.category,
        normalized: classification.normalized,
        display: classification.display,
        children: programChildren,
      };
      primary.push(item);
    }

    const children: TimelineNode[] = [...primary];

    turns.push({
      type: 'turn',
      id: `turn:${turnKey}`,
      parentId: null,
      name: steps[0]?.generationId ? `Turn ${turnIndex}` : 'Ungrouped activity',
      generationId: steps[0]?.generationId || null,
      conversationId: steps[0]?.conversationId || null,
      provider: steps[0]?.provider || null,
      status: 'completed',
      startedAt: firstTimestamp(children, 'startedAt'),
      endedAt: lastTimestamp(children, 'endedAt'),
      children,
    });
  }

  for (const change of codeChanges) {
    if (change.parseError || change.kind !== 'code_change') continue;
    turns.push({
      type: 'code_change',
      id: change.id || `code-change:${change.endedAt || change.startedAt || turns.length}`,
      parentId: null,
      name:
        change.changed === null || change.changed === undefined
          ? 'Code state unavailable'
          : change.changed
            ? 'Code state changed'
            : 'Code state unchanged',
      status: change.status || 'completed',
      startedAt: change.startedAt,
      endedAt: change.endedAt,
      changed: change.changed,
      beforeHash: change.beforeHash,
      afterHash: change.afterHash,
      beforePatch: change.beforePatch,
      afterPatch: change.afterPatch,
      source: change.source || 'git-snapshot',
      attribution: change.attribution || 'unassigned',
      projectRoot: change.projectRoot || null,
      observationWindow: change.observationWindow || null,
      display: change.changed !== false,
      normalized: true,
      method: 'DIFF',
      children: [],
    });
  }

  for (const [origin, records] of programByOrigin.entries()) {
    if (usedOrigins.has(origin)) continue;
    turns.push({
      type: 'program_group',
      id: `origin:${origin || 'empty'}`,
      parentId: null,
      name: origin ? `Unlinked program activity (${origin})` : 'Unlinked program activity',
      status: 'completed',
      children: buildProgramTree(records, methods, origin || null),
    });
  }

  return turns;
}

function argumentText(value: unknown, keys: string[]): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === 'string') return record[key];
  }
  return '';
}

function isTestCommand(command: string): boolean {
  return /(?:^|\s)(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:node\s+--test|pytest|vitest|jest|cargo\s+test|go\s+test)\b/i.test(command);
}

function isBuildCommand(command: string): boolean {
  return /(?:^|\s)(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?build\b|\b(?:tsc|cargo\s+build|go\s+build)\b/i.test(command);
}

function isLintCommand(command: string): boolean {
  return /(?:^|\s)(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?lint\b|\b(?:eslint|biome\s+check)\b/i.test(command);
}

function timestampValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function firstTimestamp(nodes: TimelineNode[], key: string): unknown {
  return nodes.reduce<unknown>((first, node) => {
    const currentValue = node[key];
    const current = timestampValue(currentValue);
    const previous = timestampValue(first);
    return current !== null && (previous === null || current < previous)
      ? currentValue
      : first;
  }, null);
}

function lastTimestamp(nodes: TimelineNode[], key: string): unknown {
  return nodes.reduce<unknown>((last, node) => {
    const currentValue = node[key];
    const current = timestampValue(currentValue);
    const previous = timestampValue(last);
    return current !== null && (previous === null || current > previous)
      ? currentValue
      : last;
  }, null);
}

function buildProgramTree(
  records: ProgramRecord[],
  methods: Record<number, MethodInfo>,
  originParentId: string | null,
): TimelineNode[] {
  const items = records.map((record) =>
    toProgramItem(record, methods, originParentId),
  );
  const byCallId = new Map(
    items
      .filter((item) => typeof item.callId === 'number')
      .map((item) => [item.callId as number, item]),
  );
  for (const item of items) {
    item.children = [];
  }

  const roots: TimelineNode[] = [];
  for (const record of records) {
    if (typeof record.callId !== 'number') continue;
    const item = byCallId.get(record.callId);
    if (!item) continue;
    const parent =
      record.parentCallId == null
        ? null
        : byCallId.get(record.parentCallId);
    if (parent) {
      item.parentId = parent.id;
      parent.children = parent.children ?? [];
      parent.children.push(item);
    } else {
      item.parentId = originParentId;
      roots.push(item);
    }
  }
  return roots;
}

function toProgramItem(
  record: ProgramRecord,
  methods: Record<number, MethodInfo>,
  parentId: string | null,
): TimelineNode {
  const method =
    typeof record.methodId === 'number' ? methods[record.methodId] : undefined;
  return {
    type: 'program_call',
    id: `call:${record.callId}`,
    parentId,
    callId: record.callId,
    methodId: record.methodId,
    name: method?.label ?? `method#${record.methodId}`,
    durationMs: record.durationMs,
    processOriginId: record.processOriginId,
    activityId: record.activityId,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    args: record.args,
    result: record.result,
    error: record.error,
    incomplete: record.incomplete,
    snapshotDegraded: record.snapshotDegraded,
    sourceFile: method?.sourceFile,
    children: [],
  };
}
