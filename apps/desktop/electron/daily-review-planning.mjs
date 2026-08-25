const CHUNK_TURN_LIMIT = 8;
const CHUNK_CHARACTER_THRESHOLD = 120_000;

export function planDailyChunks(candidates, tasks) {
  const byKey = new Map(candidates.map(item => [turnKey(item.sessionId, item.turnId), item]));
  const assigned = new Set();
  const groups = [];
  const sortedTasks = [...tasks].sort((left, right) => (
    String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')) || String(left.id).localeCompare(String(right.id))
  ));
  for (const task of sortedTasks) {
    const taskId = cleanString(task?.id);
    const sessionId = cleanString(task?.sessionId);
    if (!taskId || !sessionId || !Array.isArray(task?.turnIds)) continue;
    const turns = task.turnIds
      .map(turnId => byKey.get(turnKey(sessionId, turnId)))
      .filter(turn => turn && !assigned.has(turnKey(turn.sessionId, turn.turnId)));
    if (turns.length === 0) continue;
    turns.forEach(turn => assigned.add(turnKey(turn.sessionId, turn.turnId)));
    groups.push({ groupKey: `task:${taskId}`, turns });
  }
  const unassigned = candidates.filter(turn => !assigned.has(turnKey(turn.sessionId, turn.turnId)));
  const sessions = new Map();
  for (const turn of unassigned) {
    const values = sessions.get(turn.sessionId) ?? [];
    values.push(turn);
    sessions.set(turn.sessionId, values);
  }
  for (const [sessionId, turns] of [...sessions.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    groups.push({ groupKey: `session:${sessionId}`, turns: turns.sort(compareTurns) });
  }
  return groups.flatMap(splitGroup);
}

export function isTerminalTurn(status) {
  return ['completed', 'failed', 'aborted'].includes(status);
}

export function localDate(value, zone) {
  return localDateFromTimestamp(value.toISOString(), zone);
}

export function localDateFromTimestamp(value, zone) {
  if (!cleanString(value)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(value));
    const fields = Object.fromEntries(parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  } catch {
    return null;
  }
}

export function isCovered(chunks, turns) {
  const existing = new Set(chunks.flatMap(chunk => chunk.turns.map(turn => turnKey(turn.sessionId, turn.turnId))));
  return turns.every(turn => existing.has(turnKey(turn.sessionId, turn.turnId)));
}

function splitGroup(group) {
  const chunks = [];
  let turns = [];
  let characterCount = 0;
  const flush = () => {
    if (turns.length > 0) chunks.push({ groupKey: group.groupKey, turns, characterCount });
    turns = [];
    characterCount = 0;
  };
  for (const turn of group.turns) {
    if (turns.length > 0 && (
      turns.length >= CHUNK_TURN_LIMIT
      || characterCount + turn.characterCount > CHUNK_CHARACTER_THRESHOLD
    )) flush();
    turns.push(turn);
    characterCount += turn.characterCount;
  }
  flush();
  return chunks;
}

function compareTurns(left, right) {
  return left.endedAt.localeCompare(right.endedAt)
    || left.sequence - right.sequence
    || left.turnId.localeCompare(right.turnId);
}

function turnKey(sessionId, turnId) {
  return `${sessionId}\0${turnId}`;
}

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
