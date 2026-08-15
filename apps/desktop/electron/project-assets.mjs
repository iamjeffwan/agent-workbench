import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SOURCE = 'workbench-assets';

export const PROJECT_ASSET_CATEGORIES = [
  { id: 'agent-instructions', label: 'Agent instructions', basePath: 'AGENTS.md', writable: true },
  { id: 'project-overview', label: 'Project overview', basePath: 'docs/project-overview', writable: true },
  { id: 'design-decisions', label: 'Design decisions', basePath: 'docs/design-decisions', writable: true },
  { id: 'development-standards', label: 'Development standards', basePath: 'docs/development-standards', writable: true },
  { id: 'testing-standards', label: 'Testing standards', basePath: 'docs/testing-standards', writable: true },
  { id: 'skills', label: 'Skills', basePath: 'docs/skills', writable: true },
  { id: 'reference', label: 'Reference', basePath: 'docs/reference', writable: true },
  { id: 'task-flows', label: 'Task flows', basePath: 'docs/task-flows', writable: false },
];

export function createProjectAssetsService({
  readTask,
  completeModel,
  skillInstructions,
  now = () => new Date(),
  trashItem = null,
}) {
  return {
    listAssets(projectRoot) {
      try {
        const root = requireProjectRoot(projectRoot);
        return ready({
          projectRoot: root,
          initialized: fs.existsSync(path.join(root, 'docs')),
          tree: scanDocsTree(root),
          categories: PROJECT_ASSET_CATEGORIES.map(category => ({
            ...category,
            files: scanCategory(root, category),
          })),
        });
      } catch (error) {
        return failed(null, error, 'Unable to scan project documents.');
      }
    },

    initializeDocs(projectRoot) {
      try {
        const root = requireProjectRoot(projectRoot);
        for (const directory of PROJECT_ASSET_CATEGORIES
          .filter(category => category.id !== 'agent-instructions')
          .map(category => category.basePath)) {
          fs.mkdirSync(path.join(root, ...directory.split('/')), { recursive: true });
        }
        return this.listAssets(root);
      } catch (error) {
        return failed(null, error, 'Unable to initialize the project document folders.');
      }
    },

    createFolder(projectRoot, relativePath) {
      try {
        const root = requireProjectRoot(projectRoot);
        const target = resolveDocsFolder(root, relativePath);
        fs.mkdirSync(target, { recursive: false });
        return this.listAssets(root);
      } catch (error) {
        return failed(null, error, 'Unable to create the project document folder.');
      }
    },

    createDocument(projectRoot, relativePath) {
      try {
        const root = requireProjectRoot(projectRoot);
        const target = resolveDocsDocument(root, relativePath);
        const parent = path.dirname(target);
        if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
          throw new Error('Choose an existing project document folder.');
        }
        fs.writeFileSync(target, '', { encoding: 'utf8', flag: 'wx' });
        return this.listAssets(root);
      } catch (error) {
        return failed(null, error, 'Unable to create the project document.');
      }
    },

    renameFolder(projectRoot, relativePath, nextName) {
      try {
        const root = requireProjectRoot(projectRoot);
        const current = resolveDocsFolder(root, relativePath);
        const safeName = normalizeFolderName(nextName);
        const target = path.join(path.dirname(current), safeName);
        assertInsideRoot(path.join(root, 'docs'), target);
        fs.renameSync(current, target);
        return this.listAssets(root);
      } catch (error) {
        return failed(null, error, 'Unable to rename the project document folder.');
      }
    },

    renameDocument(projectRoot, relativePath, nextName) {
      try {
        const root = requireProjectRoot(projectRoot);
        const current = resolveDocsDocument(root, relativePath);
        const safeName = normalizeDocumentName(nextName);
        const target = path.join(path.dirname(current), safeName);
        assertInsideRoot(path.join(root, 'docs'), target);
        fs.renameSync(current, target);
        return this.listAssets(root);
      } catch (error) {
        return failed(null, error, 'Unable to rename the project document.');
      }
    },

    async trashFolder(projectRoot, relativePath) {
      try {
        const root = requireProjectRoot(projectRoot);
        const target = resolveDocsFolder(root, relativePath);
        if (typeof trashItem !== 'function') throw new Error('The system recycle bin is unavailable.');
        await trashItem(target);
        return this.listAssets(root);
      } catch (error) {
        return failed(null, error, 'Unable to move the project document folder to the recycle bin.');
      }
    },

    async trashDocument(projectRoot, relativePath) {
      try {
        const root = requireProjectRoot(projectRoot);
        const target = resolveDocsDocument(root, relativePath);
        if (typeof trashItem !== 'function') throw new Error('The system recycle bin is unavailable.');
        await trashItem(target);
        return this.listAssets(root);
      } catch (error) {
        return failed(null, error, 'Unable to move the project document to the recycle bin.');
      }
    },

    readAsset(projectRoot, relativePath) {
      try {
        const root = requireProjectRoot(projectRoot);
        const target = resolveReadableDocument(root, relativePath);
        if (!fs.existsSync(target.absolutePath) || !fs.statSync(target.absolutePath).isFile()) {
          return failed(null, null, 'The selected project document does not exist.');
        }
        return ready({
          projectRoot: root,
          category: target.category?.id ?? 'reference',
          relativePath: target.relativePath,
          markdown: fs.readFileSync(target.absolutePath, 'utf8'),
        });
      } catch (error) {
        return failed(null, error, 'Unable to read the selected project document.');
      }
    },

    async createDraft(input) {
      try {
        const normalized = normalizeDraftInput(input);
        const root = requireProjectRoot(normalized.projectRoot);
        const target = resolveWritableTarget(root, normalized.category, normalized.relativePath);
        const taskResult = readTask(normalized.taskId);
        if (taskResult?.status !== 'ready' || !taskResult.data) {
          return failed(null, null, taskResult?.error ?? 'The selected task document does not exist.');
        }
        if (taskResult.data.status !== 'ready' || !taskResult.data.document) {
          return failed(null, null, 'Wait for the task flow document to finish before organizing a draft.');
        }
        if (!sameProject(taskResult.data.projectRoot, root)) {
          return failed(null, null, 'The selected task belongs to a different project.');
        }

        const before = fs.existsSync(target.absolutePath)
          ? fs.readFileSync(target.absolutePath, 'utf8')
          : '';
        const result = await completeModel({
          messages: [{ role: 'system', content: skillInstructions }, {
            role: 'user',
            content: buildDraftInput({
              taskTitle: taskResult.data.title,
              experience: normalized.experience,
              categoryLabel: target.category.label,
              relativePath: target.relativePath,
              before,
            }),
          }],
          thinking: false,
          maxTokens: 10_000,
        }, {
          purpose: 'project-asset-draft',
          projectRoot: root,
          taskId: normalized.taskId,
          timeoutMs: 300_000,
        });
        if (result.status !== 'ready' || !result.data?.content?.trim()) {
          return failed(null, null, result.error ?? 'The model did not return an asset draft.');
        }

        return ready({
          projectRoot: root,
          taskId: normalized.taskId,
          category: target.category.id,
          relativePath: target.relativePath,
          before,
          beforeHash: digest(before),
          after: stripMarkdownFence(result.data.content),
          generatedAt: now().toISOString(),
          model: result.data.model,
          callId: result.data.callId,
        });
      } catch (error) {
        return failed(null, error, 'Unable to generate the project document draft.');
      }
    },

    writeDraft(input) {
      try {
        const root = requireProjectRoot(input?.projectRoot);
        const target = resolveWritableTarget(root, input?.category, input?.relativePath);
        const markdown = typeof input?.markdown === 'string' ? input.markdown : null;
        if (!markdown?.trim()) return failed(null, null, 'The project document cannot be empty.');
        const current = fs.existsSync(target.absolutePath)
          ? fs.readFileSync(target.absolutePath, 'utf8')
          : '';
        if (input?.beforeHash !== digest(current)) {
          return failed(null, null, 'The target document changed after the draft was generated. Generate a new draft before writing.');
        }
        writeTextAtomic(target.absolutePath, markdown.endsWith('\n') ? markdown : `${markdown}\n`);
        return ready({
          projectRoot: root,
          category: target.category.id,
          relativePath: target.relativePath,
          markdown: fs.readFileSync(target.absolutePath, 'utf8'),
        });
      } catch (error) {
        return failed(null, error, 'Unable to write the confirmed project document.');
      }
    },
  };
}

function scanCategory(root, category) {
  const absolute = path.join(root, ...category.basePath.split('/'));
  if (category.id === 'agent-instructions') {
    return fs.existsSync(absolute) && fs.statSync(absolute).isFile()
      ? [fileSummary(root, absolute)]
      : [];
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) return [];
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const current = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(current);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(fileSummary(root, current));
    }
  };
  visit(absolute);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function fileSummary(root, absolutePath) {
  const stat = fs.statSync(absolutePath);
  return {
    relativePath: relative(root, absolutePath),
    name: path.basename(absolutePath),
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
  };
}

function resolveAllowedAsset(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const category = PROJECT_ASSET_CATEGORIES.find(candidate => {
    const base = candidate.basePath.toLowerCase();
    const value = normalized.toLowerCase();
    return candidate.id === 'agent-instructions'
      ? value === base
      : value === base || value.startsWith(`${base}/`);
  });
  if (!category || !normalized.toLowerCase().endsWith('.md')) throw new Error('The selected path is not a managed Markdown document.');
  const absolutePath = path.resolve(root, ...normalized.split('/'));
  assertInsideRoot(root, absolutePath);
  return { category, relativePath: normalized, absolutePath };
}

function resolveReadableDocument(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const lower = normalized.toLowerCase();
  if (!lower.endsWith('.md') || (lower !== 'agents.md' && !lower.startsWith('docs/'))) {
    throw new Error('Choose a Markdown document from AGENTS.md or docs.');
  }
  const absolutePath = path.resolve(root, ...normalized.split('/'));
  assertInsideRoot(root, absolutePath);
  const category = PROJECT_ASSET_CATEGORIES.find(candidate => {
    const base = candidate.basePath.toLowerCase();
    return candidate.id === 'agent-instructions'
      ? lower === base
      : lower === base || lower.startsWith(`${base}/`);
  }) ?? null;
  return { category, relativePath: normalized, absolutePath };
}

function resolveWritableTarget(root, categoryId, relativePath) {
  const category = PROJECT_ASSET_CATEGORIES.find(candidate => candidate.id === categoryId && candidate.writable);
  if (!category) throw new Error('Choose a writable project document category.');
  const requested = category.id === 'agent-instructions'
    ? 'AGENTS.md'
    : normalizeRelativePath(relativePath);
  const target = resolveAllowedAsset(root, requested);
  if (target.category.id !== category.id) throw new Error('The document path is outside the selected category.');
  if (category.id !== 'agent-instructions' && requested.toLowerCase() === category.basePath.toLowerCase()) {
    throw new Error('Choose a Markdown file inside the selected category.');
  }
  return target;
}

function normalizeDraftInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Draft input is required.');
  const projectRoot = text(input.projectRoot);
  const taskId = text(input.taskId);
  const category = text(input.category);
  const experience = text(input.experience);
  const relativePath = category === 'agent-instructions' ? 'AGENTS.md' : text(input.relativePath);
  if (!projectRoot || !taskId || !category || !experience || !relativePath) {
    throw new Error('Project, task, experience, category and target document are required.');
  }
  return { projectRoot, taskId, category, experience, relativePath };
}

function buildDraftInput({ taskTitle, experience, categoryLabel, relativePath, before }) {
  return `Task: ${taskTitle}\n\nUser-confirmed experience to preserve:\n${experience}\n\nTarget category: ${categoryLabel}\nTarget file: ${relativePath}\n\nExisting target document:\n<existing-document>\n${before || '(new document)'}\n</existing-document>\n\nOnly organize the user-confirmed experience above. Do not reproduce the task flow document.`;
}

function scanDocsTree(root) {
  const nodes = [];
  const agents = path.join(root, 'AGENTS.md');
  if (fs.existsSync(agents) && fs.statSync(agents).isFile()) {
    nodes.push({ type: 'file', name: 'AGENTS.md', relativePath: 'AGENTS.md', children: [] });
  }
  const docs = path.join(root, 'docs');
  if (!fs.existsSync(docs) || !fs.statSync(docs).isDirectory()) return nodes;
  const visit = directory => fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() || (entry.isFile() && entry.name.toLowerCase().endsWith('.md')))
    .sort((left, right) => Number(left.isFile()) - Number(right.isFile()) || left.name.localeCompare(right.name))
    .map(entry => {
      const absolute = path.join(directory, entry.name);
      return {
        type: entry.isDirectory() ? 'folder' : 'file',
        name: entry.name,
        relativePath: relative(root, absolute),
        children: entry.isDirectory() ? visit(absolute) : [],
      };
    });
  nodes.push({ type: 'folder', name: 'docs', relativePath: 'docs', children: visit(docs) });
  return nodes;
}

function resolveDocsFolder(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized.toLowerCase() === 'docs' || !normalized.toLowerCase().startsWith('docs/')) {
    throw new Error('Choose a folder inside docs.');
  }
  const target = path.resolve(root, ...normalized.split('/'));
  assertInsideRoot(path.join(root, 'docs'), target);
  return target;
}

function resolveDocsDocument(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized.toLowerCase().startsWith('docs/') || !normalized.toLowerCase().endsWith('.md')) {
    throw new Error('Choose a Markdown document inside docs.');
  }
  const target = path.resolve(root, ...normalized.split('/'));
  assertInsideRoot(path.join(root, 'docs'), target);
  return target;
}

function normalizeFolderName(value) {
  const name = text(value);
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name)) {
    throw new Error('Enter a valid folder name.');
  }
  return name;
}

function normalizeDocumentName(value) {
  const requested = text(value);
  if (!requested) throw new Error('Enter a document name.');
  const name = requested.toLowerCase().endsWith('.md') ? requested : `${requested}.md`;
  if (name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name)) {
    throw new Error('Enter a valid Markdown document name.');
  }
  return name;
}

function requireProjectRoot(value) {
  const root = text(value);
  if (!root) throw new Error('Open a project before using project documents.');
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error('The project folder does not exist.');
  return resolved;
}

function normalizeRelativePath(value) {
  const candidate = text(value)?.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!candidate || path.isAbsolute(candidate) || candidate.split('/').includes('..')) throw new Error('A safe project-relative path is required.');
  return candidate;
}

function assertInsideRoot(root, target) {
  const relativePath = path.relative(root, target);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new Error('The document path is outside the project.');
}

function writeTextAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, 'utf8');
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stripMarkdownFence(value) {
  const trimmed = value.trim();
  const match = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

function relative(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function sameProject(left, right) {
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function ready(data) {
  return { status: 'ready', source: SOURCE, data, error: null };
}

function failed(data, cause, fallback) {
  return { status: 'error', source: SOURCE, data, error: cause instanceof Error ? cause.message : fallback };
}
