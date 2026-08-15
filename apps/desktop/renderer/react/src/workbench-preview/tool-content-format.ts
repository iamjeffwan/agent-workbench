export type ShellMeta = {
  exitCode: string | null;
  wallTime: string | null;
};

export type SearchHit = {
  path: string;
  line: number | null;
  text: string;
};

export type ShellResultView = {
  kind: 'shell_result';
  meta: ShellMeta;
  stdout: string;
  hits: SearchHit[];
};

export type FormattedResultView = ShellResultView;

const EXIT_CODE_RE = /^Exit code:\s*(.+)$/im;
const WALL_TIME_RE = /^Wall time:\s*(.+)$/im;
const OUTPUT_HEADER_RE = /^Output:\s*$/im;
const HIT_RE = /^(?:\.?[\\/])?(.+?):(\d+):(.*)$/;

/** Flatten common Codex/Cursor tool output shapes into plain text. */
export function flattenToolText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          if (typeof record.text === 'string') return record.text;
          if (typeof record.content === 'string') return record.content;
        }
        return null;
      })
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join('\n') : null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.$preview === 'string') return record.$preview;
    if (typeof record.output === 'string') return record.output;
  }
  return null;
}

export function formatToolResult(value: unknown): FormattedResultView | null {
  const text = flattenToolText(value);
  if (!text) return null;
  if (!EXIT_CODE_RE.test(text) && !WALL_TIME_RE.test(text) && !OUTPUT_HEADER_RE.test(text)) {
    return null;
  }

  const exitCode = EXIT_CODE_RE.exec(text)?.[1]?.trim() ?? null;
  const wallTime = WALL_TIME_RE.exec(text)?.[1]?.trim() ?? null;
  const outputMatch = OUTPUT_HEADER_RE.exec(text);
  const body = outputMatch
    ? text.slice(outputMatch.index + outputMatch[0].length).replace(/^\r?\n/, '')
    : text
        .replace(EXIT_CODE_RE, '')
        .replace(WALL_TIME_RE, '')
        .replace(/^\s+/, '');

  const { stdout, hits } = splitStdoutAndHits(body);
  return {
    kind: 'shell_result',
    meta: { exitCode, wallTime },
    stdout,
    hits,
  };
}

/** Pull `command` / `cmd` from tool arguments when present. */
export function extractCommand(args: unknown): string | null {
  const record = coerceArgsRecord(args);
  if (!record) return null;
  for (const key of ['command', 'cmd']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

/** Plain command text with `;` breaks — not wrapped as JSON. */
export function formatCommandDisplay(command: string): string {
  return breakCommandLines(command);
}

export function formatArgumentsJson(args: unknown): string {
  return formatPlain(args);
}

function breakCommandLines(command: string): string {
  let result = '';
  let quote: '"' | "'" | '`' | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote) {
      result += char;
      if (char === quote && command[i - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      result += char;
      continue;
    }
    if (char === ';') {
      result += ';\n';
      while (command[i + 1] === ' ') i += 1;
      continue;
    }
    result += char;
  }

  return result;
}

function splitStdoutAndHits(body: string): { stdout: string; hits: SearchHit[] } {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const stdoutLines: string[] = [];
  const hits: SearchHit[] = [];
  let hitMode = false;

  for (const line of lines) {
    const hit = parseHitLine(line);
    if (hit) {
      hitMode = true;
      hits.push(hit);
      continue;
    }
    if (hitMode && line.trim() === '') continue;
    stdoutLines.push(line);
  }

  return {
    stdout: trimTrailingBlank(stdoutLines.join('\n')),
    hits,
  };
}

function parseHitLine(line: string): SearchHit | null {
  const trimmed = line.trimEnd();
  if (!trimmed) return null;
  const match = HIT_RE.exec(trimmed);
  if (!match) return null;
  const path = match[1].replace(/\\/g, '/');
  if (path.includes('://')) return null;
  if (!/[\\/]|\.[A-Za-z0-9]+$/.test(path)) return null;
  const lineNo = Number(match[2]);
  return {
    path,
    line: Number.isFinite(lineNo) ? lineNo : null,
    text: match[3] ?? '',
  };
}

function coerceArgsRecord(args: unknown): Record<string, unknown> | null {
  if (!args) return null;
  if (typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { value: args };
    }
  }
  return null;
}

function formatPlain(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'No result was recorded.';
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function trimTrailingBlank(text: string): string {
  return text.replace(/\s+$/, '');
}
