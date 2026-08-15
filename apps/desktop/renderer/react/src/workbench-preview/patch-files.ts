import type { ChangedFile } from './types.ts';

export function parsePatchFiles(patch: unknown): ChangedFile[] {
  if (typeof patch !== 'string' || !patch.trim()) return [];
  return patch.includes('*** Begin Patch')
    ? parseApplyPatch(patch)
    : parseGitPatch(patch);
}

type FileBuilder = {
  path: string;
  previousPath?: string;
  change: ChangedFile['change'];
  before: string[];
  after: string[];
  additions: number;
  deletions: number;
};

function parseGitPatch(patch: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: FileBuilder | null = null;
  let inHunk = false;

  const flush = () => {
    if (current) files.push(toChangedFile(current));
    current = null;
    inHunk = false;
  };

  for (const line of patch.split(/\r?\n/)) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      flush();
      current = createBuilder(header[2], 'modified');
      if (header[1] !== header[2]) {
        current.previousPath = header[1];
        current.change = 'renamed';
      }
      continue;
    }
    if (!current) continue;
    if (line.startsWith('new file mode ')) current.change = 'added';
    else if (line.startsWith('deleted file mode ')) current.change = 'deleted';
    else if (line.startsWith('rename from ')) {
      current.previousPath = line.slice('rename from '.length);
      current.change = 'renamed';
    } else if (line.startsWith('rename to ')) {
      current.path = line.slice('rename to '.length);
      current.change = 'renamed';
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk) {
      appendDiffLine(current, line);
    }
  }
  flush();
  return files;
}

function parseApplyPatch(patch: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: FileBuilder | null = null;
  let inBody = false;

  const flush = () => {
    if (current) files.push(toChangedFile(current));
    current = null;
    inBody = false;
  };

  for (const line of patch.split(/\r?\n/)) {
    const header = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (header) {
      flush();
      const change = header[1] === 'Add' ? 'added'
        : header[1] === 'Delete' ? 'deleted'
          : 'modified';
      current = createBuilder(header[2], change);
      inBody = change !== 'modified';
      continue;
    }
    if (!current) continue;
    if (line.startsWith('*** Move to: ')) {
      current.previousPath = current.path;
      current.path = line.slice('*** Move to: '.length);
      current.change = 'renamed';
    } else if (line.startsWith('@@')) {
      inBody = true;
    } else if (line.startsWith('*** End Patch')) {
      flush();
    } else if (inBody) {
      appendDiffLine(current, line);
    }
  }
  flush();
  return files;
}

function createBuilder(path: string, change: ChangedFile['change']): FileBuilder {
  return { path, change, before: [], after: [], additions: 0, deletions: 0 };
}

function appendDiffLine(file: FileBuilder, line: string) {
  if (line === '') return;
  if (line.startsWith('\\ No newline at end of file')) return;
  if (line.startsWith('+')) {
    file.after.push(line.slice(1));
    file.additions += 1;
  } else if (line.startsWith('-')) {
    file.before.push(line.slice(1));
    file.deletions += 1;
  } else {
    const content = line.startsWith(' ') ? line.slice(1) : line;
    file.before.push(content);
    file.after.push(content);
  }
}

function toChangedFile(file: FileBuilder): ChangedFile {
  return {
    path: file.path.replaceAll('\\', '/'),
    previousPath: file.previousPath?.replaceAll('\\', '/'),
    change: file.change,
    language: languageFor(file.path),
    before: file.before.join('\n'),
    after: file.after.join('\n'),
    additions: file.additions,
    deletions: file.deletions,
  };
}

export function languageForPath(filePath: string): ChangedFile['language'] {
  const extension = filePath.split('.').at(-1)?.toLowerCase();
  if (extension === 'ts' || extension === 'tsx') return 'typescript';
  if (extension === 'js' || extension === 'jsx' || extension === 'mjs' || extension === 'cjs') return 'javascript';
  if (extension === 'json') return 'json';
  if (extension === 'css') return 'css';
  if (extension === 'md' || extension === 'mdx') return 'markdown';
  return 'typescript';
}

function languageFor(filePath: string): ChangedFile['language'] {
  return languageForPath(filePath);
}
