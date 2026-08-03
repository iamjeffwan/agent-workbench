import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Default Codex CLI sessions root: ~/.codex/sessions */
export function defaultCodexSessionsDir(): string {
  const home = process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), '.codex');
  return path.join(home, 'sessions');
}

/** Find rollout JSONL files, newest first. */
export function findCodexSessions(sessionsDir = defaultCodexSessionsDir()): string[] {
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  const found: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (
        entry.isFile() &&
        entry.name.startsWith('rollout-') &&
        entry.name.endsWith('.jsonl')
      ) {
        found.push(abs);
      }
    }
  }

  walk(sessionsDir);
  return found.sort((a, b) => {
    const aTime = fs.statSync(a).mtimeMs;
    const bTime = fs.statSync(b).mtimeMs;
    return bTime - aTime;
  });
}

export function latestCodexSession(sessionsDir = defaultCodexSessionsDir()): string | null {
  return findCodexSessions(sessionsDir)[0] ?? null;
}
