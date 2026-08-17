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
  sessionId?: string;
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
  appliedChanges?: Record<string, unknown>;
  appliedChangeSuccess?: boolean;
  eventKind?: TimelineEventKind;
  sourceLine?: number;
  content?: string;
  role?: 'user' | 'assistant';
  tokenUsage?: Record<string, number | null | undefined>;
  evidenceRefs?: TimelineEvidenceRef[];
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
  sessionId?: string;
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
  sourceLine?: number;
  evidenceRefs?: TimelineEvidenceRef[];
};

export type TimelineEventKind =
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
  | 'task_status'
  | 'unknown';

export type TimelineEvidenceKind =
  | 'raw_record'
  | 'command'
  | 'file_change'
  | 'test_result'
  | 'validation_result'
  | 'model_call'
  | 'context'
  | 'artifact';

export type TimelineEvidenceRef = {
  id: string;
  kind: TimelineEvidenceKind;
  summary: string;
  source?: {
    sessionFile?: string | null;
    line?: number | null;
    path?: string | null;
  };
  data?: Record<string, unknown>;
};

export type TimelineNode = {
  type: string;
  id: string;
  parentId: string | null;
  name: string;
  status?: string;
  children?: TimelineNode[];
  eventKind?: TimelineEventKind;
  evidenceRefs?: TimelineEvidenceRef[];
  [key: string]: unknown;
};

export type TimelineTurn = TimelineNode & {
  type: 'turn' | 'program_group';
  generationId?: string | null;
  sessionId?: string | null;
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
      step.sessionId || 'session',
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
      const eventKind = step.eventKind && !['tool_call', 'tool_result'].includes(step.eventKind)
        ? step.eventKind
        : eventKindForClassification(classification, step);
      const renderEvent = isRenderableEventKind(eventKind);
      if (classification.category === 'internal' && !classification.display && !renderEvent) {
        continue;
      }
      const item: TimelineNode = {
        type: renderEvent ? 'event' : 'agent_tool',
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
        sessionId: step.sessionId || null,
        durationMs: step.durationMs,
        sessionFile: step.sessionFile || null,
        failed: !!step.failed,
        error: step.error,
        cwd: step.cwd || null,
        projectAssignment: step.projectAssignment || null,
        transportId: step.transportId || null,
        transportName: step.transportName || null,
        outcome: step.outcome || null,
        appliedChanges: step.appliedChanges || null,
        appliedChangeSuccess: step.appliedChangeSuccess ?? null,
        content: step.content || null,
        role: step.role || null,
        tokenUsage: step.tokenUsage || null,
        eventKind,
        evidenceRefs: step.evidenceRefs?.length
          ? step.evidenceRefs
          : defaultEvidenceForStep(step, classification),
        method: methodForEventKind(eventKind) || classification.method,
        category: renderEvent ? 'event' : classification.category,
        normalized: renderEvent || classification.normalized,
        display: classification.display || renderEvent,
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
      sessionId: steps[0]?.sessionId || null,
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
      eventKind: 'file_change',
      evidenceRefs: change.evidenceRefs?.length
        ? change.evidenceRefs
        : [{
            id: `evidence:${change.id || turns.length}:file-change`,
            kind: 'file_change',
            summary: change.changed ? 'Project file changes recorded' : 'Project file state recorded',
            source: {
              path: change.projectRoot || null,
            },
            data: {
              changed: change.changed ?? null,
              beforeHash: change.beforeHash ?? null,
              afterHash: change.afterHash ?? null,
            },
          }],
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

function eventKindForClassification(
  classification: AgentToolClassification,
  step: AgentStep,
): TimelineEventKind {
  if (step.appliedChanges || step.appliedChangeSuccess !== undefined) return 'file_change';
  if (classification.method === 'TEST' || classification.method === 'BUILD' || classification.method === 'LINT') {
    return 'test_result';
  }
  if (classification.category === 'process') return 'command';
  if (classification.category === 'tool') return 'tool_call';
  if (classification.category === 'delegate') return 'tool_call';
  return 'tool_call';
}

function isRenderableEventKind(eventKind: TimelineEventKind): boolean {
  return eventKind !== 'tool_call' && eventKind !== 'tool_result' && eventKind !== 'unknown';
}

function methodForEventKind(eventKind: TimelineEventKind): string | null {
  if (eventKind === 'user_input') return 'USER INPUT';
  if (eventKind === 'assistant_message') return 'ASSISTANT';
  if (eventKind === 'reasoning') return 'REASONING';
  if (eventKind === 'model_call') return 'MODEL';
  if (eventKind === 'context_ref') return 'CONTEXT';
  if (eventKind === 'task_status') return 'STATUS';
  return null;
}

function defaultEvidenceForStep(
  step: AgentStep,
  classification: AgentToolClassification,
): TimelineEvidenceRef[] {
  const source = {
    sessionFile: step.sessionFile || null,
    line: step.sourceLine ?? null,
  };
  const evidence: TimelineEvidenceRef[] = [{
    id: `evidence:${step.id}:raw`,
    kind: 'raw_record',
    summary: `${step.name || 'Agent event'} source record`,
    source,
  }];

  const evidenceKind = step.eventKind && ['model_call', 'context_ref'].includes(step.eventKind)
    ? evidenceKindForEvent(step.eventKind)
    : null;
  if (evidenceKind) {
    evidence.push({
      id: `evidence:${step.id}:${evidenceKind}`,
      kind: evidenceKind,
      summary: `${step.name || step.eventKind || classification.method} evidence`,
      source,
      data: {
        content: step.content ?? null,
        tokenUsage: step.tokenUsage ?? null,
        status: step.status ?? null,
      },
    });
  }

  if (step.appliedChanges) {
    evidence.push({
      id: `evidence:${step.id}:file-change`,
      kind: 'file_change',
      summary: 'Patch file changes',
      source,
      data: { changes: step.appliedChanges },
    });
  }

  if (classification.method === 'TEST' || classification.method === 'BUILD' || classification.method === 'LINT') {
    evidence.push({
      id: `evidence:${step.id}:validation`,
      kind: classification.method === 'TEST' ? 'test_result' : 'validation_result',
      summary: 'Validation command result',
      source,
      data: {
        command: argumentText(step.arguments, ['command', 'cmd']),
        status: step.failed ? 'failed' : step.status || 'unknown',
        durationMs: step.durationMs ?? null,
        output: step.output ?? null,
      },
    });
  } else if (classification.category === 'process') {
    evidence.push({
      id: `evidence:${step.id}:command`,
      kind: 'command',
      summary: 'Command execution result',
      source,
      data: {
        command: argumentText(step.arguments, ['command', 'cmd']),
        cwd: step.cwd || null,
        status: step.failed ? 'failed' : step.status || 'unknown',
        durationMs: step.durationMs ?? null,
        output: step.output ?? null,
      },
    });
  }

  return evidence;
}

function evidenceKindForEvent(eventKind: TimelineEventKind): TimelineEvidenceKind | null {
  if (eventKind === 'file_change') return 'file_change';
  if (eventKind === 'test_result') return 'test_result';
  if (eventKind === 'model_call') return 'model_call';
  if (eventKind === 'context_ref') return 'context';
  if (eventKind === 'command') return 'command';
  return null;
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
