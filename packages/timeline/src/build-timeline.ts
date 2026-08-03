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
  'Write',
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
};

export function isExplorationTool(name: string | undefined): boolean {
  if (!name) return false;
  if (PRIMARY_TOOLS.has(name)) return false;
  if (EXPLORATION_TOOLS.has(name)) return true;
  return true;
}

export function buildTimeline(
  agentSteps: AgentStep[],
  programRecords: ProgramRecord[],
  methods: Record<number, MethodInfo> = {},
): TimelineTurn[] {
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
    const turnKey = step.generationId || step.conversationId || 'ungrouped';
    const list = stepsByTurn.get(turnKey) ?? [];
    list.push(step);
    stepsByTurn.set(turnKey, list);
  }

  const turns: TimelineTurn[] = [];
  let turnIndex = 0;
  for (const [turnKey, steps] of stepsByTurn.entries()) {
    turnIndex += 1;
    const explore: TimelineNode[] = [];
    const primary: TimelineNode[] = [];

    for (const step of steps) {
      usedOrigins.add(step.id!);
      const programChildren = buildProgramTree(
        programByOrigin.get(step.id!) ?? [],
        methods,
        step.id!,
      );
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
        children: programChildren,
      };

      if (
        step.launchesProcess ||
        PRIMARY_TOOLS.has(step.name || '') ||
        !isExplorationTool(step.name)
      ) {
        primary.push(item);
      } else {
        explore.push(item);
      }
    }

    const children: TimelineNode[] = [];
    if (explore.length > 0) {
      const counts: Record<string, number> = {};
      for (const item of explore) {
        counts[item.name] = (counts[item.name] || 0) + 1;
      }
      children.push({
        type: 'explore_group',
        id: `explore:${turnKey}`,
        parentId: `turn:${turnKey}`,
        name: `文件探查 × ${explore.length}`,
        status: 'completed',
        summary: counts,
        children: explore,
      });
    }
    children.push(...primary);

    turns.push({
      type: 'turn',
      id: `turn:${turnKey}`,
      parentId: null,
      name: turnKey === 'ungrouped' ? '未分组活动' : `执行轮次 ${turnIndex}`,
      generationId: turnKey === 'ungrouped' ? null : turnKey,
      status: 'completed',
      children,
    });
  }

  for (const [origin, records] of programByOrigin.entries()) {
    if (usedOrigins.has(origin)) continue;
    turns.push({
      type: 'program_group',
      id: `origin:${origin || 'empty'}`,
      parentId: null,
      name: origin ? `未关联程序活动 (${origin})` : '未关联程序活动',
      status: 'completed',
      children: buildProgramTree(records, methods, origin || null),
    });
  }

  return turns;
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
