import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { readCodexTaskEvidence } from '@agent-workbench/codex-adapter';

const TASK_VERSION = 1;
const TASK_DIRECTORY = 'tasks';
const SOURCE = 'workbench-task';

export function createTaskLibraryService({
  getUserDataPath,
  resolveSessionFiles,
  readTaskEvidence = readCodexTaskEvidence,
  generateDocument,
  completeModel,
  onChange = () => {},
  now = () => new Date(),
  createId = () => randomUUID(),
}) {
  return {
    listTasks(projectRoot = null) {
      try {
        const tasks = readAllTasks(taskDirectory(getUserDataPath))
          .filter(task => !projectRoot || sameProject(task.projectRoot, projectRoot))
          .map(toTaskSummary)
          .sort(compareTasks);
        return ready(tasks);
      } catch (error) {
        return failed([], error, 'Unable to read saved tasks.');
      }
    },

    readTask(taskId) {
      if (!validTaskId(taskId)) return failed(null, null, 'A valid task ID is required.');
      try {
        const file = taskPath(getUserDataPath, taskId);
        if (!fs.existsSync(file)) return failed(null, null, 'The selected task does not exist.');
        return ready(readTaskFile(file));
      } catch (error) {
        return failed(null, error, 'Unable to read the selected task.');
      }
    },

    createTask(input) {
      const normalized = normalizeTaskInput(input);
      if (!normalized) return failed(null, null, 'Project, session and turn IDs are required.');
      try {
        const resolution = resolveSessionFiles(
          normalized.projectRoot,
          [normalized.sessionId],
        );
        if (resolution.status !== 'ready' || resolution.data.sessionFiles.length !== 1) {
          return failed(
            null,
            null,
            resolution.error ?? 'The selected session source cannot be resolved exactly.',
          );
        }
        const [sessionFile] = resolution.data.sessionFiles;
        const evidence = readTaskEvidence({
          projectRoot: normalized.projectRoot,
          sessionFile,
          sessionId: normalized.sessionId,
          turnIds: normalized.turnIds,
        });
        if (evidence.missingTurnIds.length > 0 || evidence.turns.length !== normalized.turnIds.length) {
          return failed(null, null, 'Some selected turns cannot be resolved exactly from the source session.');
        }

        const id = createId();
        if (!validTaskId(id)) throw new Error('Generated task ID is invalid.');
        const title = normalized.title || suggestTaskTitle(evidence.turns);
        if (typeof generateDocument !== 'function') {
          throw new Error('Task flow document generation is not configured.');
        }
        const timestamp = now().toISOString();
        const eventCount = evidence.turns.reduce((total, turn) => total + turn.events.length, 0);
        const task = {
          version: TASK_VERSION,
          id,
          title,
          projectRoot: path.resolve(normalized.projectRoot),
          sessionId: normalized.sessionId,
          turnIds: normalized.turnIds,
          createdAt: timestamp,
          updatedAt: timestamp,
          status: 'queued',
          error: null,
          eventCount,
          evidence: {
            source: 'codex-rollout',
            sessionFile: path.resolve(sessionFile),
            eventCount,
          },
          document: null,
          discussion: [],
          scripts: [],
        };
        writeTaskFile(taskPath(getUserDataPath, id), task);
        notify(task, 'generation-queued');
        void generateTask(task, evidence);
        return ready(task);
      } catch (error) {
        return failed(null, error, 'Unable to create the task document.');
      }
    },

    async discuss(taskId, message) {
      const prompt = string(message);
      if (!validTaskId(taskId) || !prompt) return failed(null, null, 'Choose a task and enter a message.');
      try {
        const file = taskPath(getUserDataPath, taskId);
        const task = readTaskFile(file);
        if (typeof completeModel !== 'function') throw new Error('Task discussion is not configured.');
        const prior = Array.isArray(task.discussion) ? task.discussion.slice(-12) : [];
        const result = await completeModel({
          messages: [
            {
              role: 'system',
              content: 'Discuss the selected development task with the user. Help clarify reusable experience, possible skills, prompts, project documentation, tool guidance, or scripts. Treat every proposal as a draft until the user confirms it. Do not modify files and do not claim that a script is verified.',
            },
            ...prior.map(item => ({ role: item.role, content: item.content })),
            {
              role: 'user',
              content: `Task: ${task.title}\n\nFlow document:\n${task.document?.markdown ?? '(still generating)'}\n\nUser message:\n${prompt}`,
            },
          ],
          thinking: false,
          maxTokens: 4_000,
        }, {
          purpose: 'task-discussion',
          projectRoot: task.projectRoot,
          taskId: task.id,
          timeoutMs: 300_000,
        });
        if (result.status !== 'ready' || !result.data?.content?.trim()) {
          return failed(null, null, result.error ?? 'The model did not return a discussion response.');
        }
        const timestamp = now().toISOString();
        task.discussion = [
          ...(Array.isArray(task.discussion) ? task.discussion : []),
          { id: createId(), role: 'user', content: prompt, createdAt: timestamp },
          { id: createId(), role: 'assistant', content: result.data.content.trim(), createdAt: timestamp, callId: result.data.callId },
        ];
        task.updatedAt = timestamp;
        writeTaskFile(file, task);
        notify(task, 'discussion-updated');
        return ready(task);
      } catch (error) {
        return failed(null, error, 'Unable to continue the task discussion.');
      }
    },

    saveScript(taskId, input) {
      if (!validTaskId(taskId)) return failed(null, null, 'Choose a valid task before saving a script.');
      const normalized = normalizeScriptInput(input);
      if (!normalized) return failed(null, null, 'Script name, language and content are required.');
      try {
        const file = taskPath(getUserDataPath, taskId);
        const task = readTaskFile(file);
        const timestamp = now().toISOString();
        const scripts = Array.isArray(task.scripts) ? task.scripts : [];
        const existing = normalized.id
          ? scripts.find(script => script.id === normalized.id)
          : null;
        const script = {
          id: existing?.id ?? createId(),
          title: normalized.title,
          language: normalized.language,
          content: normalized.content,
          status: 'draft',
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        if (!validTaskId(script.id)) throw new Error('Generated script ID is invalid.');
        task.scripts = [script, ...scripts.filter(item => item.id !== script.id)];
        task.updatedAt = timestamp;
        writeTaskFile(file, task);
        notify(task, 'script-saved');
        return ready(task);
      } catch (error) {
        return failed(null, error, 'Unable to save the script draft.');
      }
    },
  };

  function notify(task, reason) {
    try { onChange({ task: toTaskSummary(task), reason }); } catch { /* UI notifications are best effort. */ }
  }

  async function generateTask(task, evidence) {
    const file = taskPath(getUserDataPath, task.id);
    task.status = 'generating';
    task.updatedAt = now().toISOString();
    writeTaskFile(file, task);
    notify(task, 'generation-started');
    try {
      const generated = await generateDocument({ id: task.id, taskId: task.id, title: task.title, evidence });
      const timestamp = now().toISOString();
      const projectFile = writeProjectTaskFlow(task.projectRoot, task.title, generated.markdown, now());
      task.status = 'ready';
      task.error = null;
      task.updatedAt = timestamp;
      task.document = {
        format: 'markdown',
        generatedAt: timestamp,
        markdown: generated.markdown,
        projectFile,
        generator: generated.generator,
      };
      writeTaskFile(file, task);
      notify(task, 'generation-ready');
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unable to generate the task document.';
      task.updatedAt = now().toISOString();
      writeTaskFile(file, task);
      notify(task, 'generation-failed');
    }
  }
}

function writeProjectTaskFlow(projectRoot, title, markdown, date) {
  const directory = path.join(projectRoot, 'docs', 'task-flows');
  fs.mkdirSync(directory, { recursive: true });
  const day = date.toISOString().slice(0, 10);
  const base = `${day}-${slug(title) || 'task-flow'}`;
  let name = `${base}.md`;
  let suffix = 2;
  while (fs.existsSync(path.join(directory, name))) name = `${base}-${suffix++}.md`;
  const file = path.join(directory, name);
  const content = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, 'utf8');
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return path.relative(projectRoot, file).replaceAll('\\', '/');
}

function slug(value) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function suggestTaskTitle(turns) {
  for (const turn of turns ?? []) {
    const title = titleFromInput(turn?.userInput);
    if (title) return title;
  }
  return 'Untitled task';
}

function titleFromInput(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, (_match, label) => /^https?:\/\//i.test(label.trim()) ? ' ' : label)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/<image\b[^>]*>/gi, ' ')
    .replace(/\r/g, '\n');
  const candidates = cleaned
    .split(/\n+|(?<=[。！？!?；;])\s*/u)
    .map(line => line
      .replace(/^\s*(?:[-*+]\s+|#{1,6}\s*)/, '')
      .replace(/^\s*(?:please\s+implement\s+this\s+plan|my request for codex)\s*[:：-]?\s*/i, '')
      .replace(/^\s*(?:请|麻烦|帮我|我希望|我想要|我们需要|我们)\s*/u, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(line => line && /[\p{Letter}\p{Number}]/u.test(line))
    .filter(line => !/^(?:是的|好的|可以|确定|继续|行)[。.!！]?$/u.test(line))
    .filter(line => !/^(?:files? mentioned|image)\b/i.test(line));
  const candidate = candidates[0];
  if (!candidate) return null;
  const points = Array.from(candidate.replace(/[。！？!?；;,:：]+$/u, ''));
  const limit = /\p{Script=Han}/u.test(candidate) ? 32 : 60;
  return points.length <= limit ? points.join('') : `${points.slice(0, limit - 1).join('').trimEnd()}…`;
}

function normalizeTaskInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const projectRoot = string(input.projectRoot);
  const sessionId = string(input.sessionId);
  const turnIds = Array.isArray(input.turnIds)
    ? [...new Set(input.turnIds.map(string).filter(Boolean))]
    : [];
  if (!projectRoot || !sessionId || turnIds.length === 0) return null;
  return {
    projectRoot: path.resolve(projectRoot),
    sessionId,
    turnIds,
    title: string(input.title),
  };
}

function readAllTasks(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => readTaskFile(path.join(directory, entry.name)))
    .filter(task => task.version === TASK_VERSION);
}

function readTaskFile(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== TASK_VERSION) {
    throw new Error('Task file is invalid.');
  }
  return {
    ...parsed,
    status: parsed.status ?? (parsed.document ? 'ready' : 'failed'),
    error: parsed.error ?? null,
    discussion: Array.isArray(parsed.discussion) ? parsed.discussion : [],
    scripts: Array.isArray(parsed.scripts) ? parsed.scripts : [],
  };
}

function normalizeScriptInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const title = string(input.title);
  const language = string(input.language);
  const content = string(input.content);
  const id = input.id == null ? null : string(input.id);
  if (!title || !language || !content || (id && !validTaskId(id))) return null;
  if (!['shell', 'javascript', 'typescript', 'python', 'other'].includes(language)) return null;
  return { id, title, language, content };
}

function writeTaskFile(file, task) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(task, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function toTaskSummary(task) {
  return {
    id: task.id,
    title: titleFromInput(task.title) ?? task.title,
    projectRoot: task.projectRoot,
    sessionId: task.sessionId,
    turnIds: task.turnIds,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    eventCount: task.evidence?.eventCount ?? 0,
    status: task.status ?? (task.document ? 'ready' : 'failed'),
    error: task.error ?? null,
  };
}

function compareTasks(left, right) {
  return String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')) ||
    String(left.id).localeCompare(String(right.id));
}

function taskDirectory(getUserDataPath) {
  const userDataPath = getUserDataPath();
  if (!userDataPath) throw new Error('Electron user data directory is unavailable.');
  return path.join(userDataPath, TASK_DIRECTORY);
}

function taskPath(getUserDataPath, taskId) {
  return path.join(taskDirectory(getUserDataPath), `${taskId}.json`);
}

function validTaskId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]+$/.test(value);
}

function sameProject(left, right) {
  const normalize = value => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function string(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function ready(data) {
  return { status: 'ready', source: SOURCE, data, error: null };
}

function failed(data, cause, fallback) {
  return {
    status: 'error',
    source: SOURCE,
    data,
    error: cause instanceof Error ? cause.message : fallback,
  };
}
