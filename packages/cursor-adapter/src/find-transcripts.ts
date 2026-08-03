import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Default Cursor projects root: ~/.cursor/projects */
export function defaultCursorProjectsDir(): string {
  return path.join(os.homedir(), '.cursor', 'projects');
}

/**
 * Find agent transcript JSONL files, newest first.
 * Supports nested `<id>/<id>.jsonl` and flat `<id>.jsonl`.
 */
export function findCursorTranscripts(
  projectsDir = defaultCursorProjectsDir(),
): string[] {
  if (!fs.existsSync(projectsDir)) {
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
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }
      // Prefer files living under an agent-transcripts directory.
      if (!abs.replace(/\\/g, '/').includes('/agent-transcripts/')) {
        continue;
      }
      found.push(abs);
    }
  }

  walk(projectsDir);
  return found.sort((a, b) => {
    const aTime = fs.statSync(a).mtimeMs;
    const bTime = fs.statSync(b).mtimeMs;
    return bTime - aTime;
  });
}

export function latestCursorTranscript(
  projectsDir = defaultCursorProjectsDir(),
): string | null {
  return findCursorTranscripts(projectsDir)[0] ?? null;
}

/** Prefer transcripts for a workspace path slug when possible. */
export function findCursorTranscriptsForWorkspace(
  workspacePath: string,
  projectsDir = defaultCursorProjectsDir(),
): string[] {
  const all = findCursorTranscripts(projectsDir);
  const slugHints = workspaceSlugHints(workspacePath);
  const matched = all.filter((file) =>
    slugHints.some((hint) => file.replace(/\\/g, '/').includes(hint)),
  );
  return matched.length > 0 ? matched : all;
}

function workspaceSlugHints(workspacePath: string): string[] {
  const normalized = path.resolve(workspacePath).replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const leaf = parts[parts.length - 1] ?? '';
  const dashed = normalized.replace(/[:/]/g, '-');
  return [leaf, dashed, `f-${leaf}`, leaf.toLowerCase()].filter(Boolean);
}
