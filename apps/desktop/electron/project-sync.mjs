import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';

import { redactCredentialText } from '../../../packages/agent-workbench-security/index.mjs';

const execFile = promisify(execFileCallback);
const SYNC_VERSION = 1;
const SYNC_DIRECTORY = '.agent-workbench-sync';
const TASK_DIRECTORY = 'tasks';
const BLOCKED_FILE_PATTERNS = [
  /^\.env(?:\..*)?$/i,
  /(?:^|[._-])(credentials?|secrets?|tokens?)(?:[._-]|$)/i,
  /(?:^|[._-])(?:id_)?rsa(?:[._-]|$)/i,
  /(?:^|[._-])private[_-]?key(?:[._-]|$)/i,
  /\.(?:pem|key|p12|pfx)$/i,
];

export function createProjectSyncService({
  readTask,
  readTaskEvidence,
  now = () => new Date(),
  run = runCommand,
}) {
  return {
    listSyncTasks(projectRoot) {
      if (!validProjectRoot(projectRoot)) return result([], 'A project must be open.');
      try {
        const directory = syncTasksDirectory(projectRoot);
        if (!fs.existsSync(directory)) return ready([]);
        const tasks = fs.readdirSync(directory, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && validTaskId(entry.name))
          .map(entry => readManifest(path.join(directory, entry.name)))
          .filter(Boolean)
          .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
        return ready(tasks);
      } catch (error) {
        return failed([], error, 'Unable to read synchronized tasks.');
      }
    },

    readSyncTask(projectRoot, taskId) {
      if (!validProjectRoot(projectRoot) || !validTaskId(taskId)) {
        return failed(null, null, 'A valid project and task ID are required.');
      }
      try {
        const directory = taskDirectory(projectRoot, taskId);
        const manifest = readManifest(directory);
        if (!manifest) return failed(null, null, 'The synchronized task does not exist.');
        const evidenceFile = path.join(directory, 'evidence.jsonl');
        const evidence = fs.existsSync(evidenceFile)
          ? fs.readFileSync(evidenceFile, 'utf8').split(/\r?\n/).filter(Boolean).map(parseJsonLine).filter(Boolean)
          : [];
        return ready({ ...manifest, evidence });
      } catch (error) {
        return failed(null, error, 'Unable to read the synchronized task.');
      }
    },

    addTaskToSync(taskId) {
      if (!validTaskId(taskId)) return failed(null, null, 'A valid task ID is required.');
      try {
        const taskResult = readTask(taskId);
        if (taskResult?.status !== 'ready' || !taskResult.data) {
          return failed(null, null, taskResult?.error ?? 'The selected task is unavailable.');
        }
        const task = taskResult.data;
        if (task.status !== 'ready' || !task.document?.projectFile) {
          return failed(null, null, 'The task flow document is not ready yet.');
        }
        const projectRoot = path.resolve(task.projectRoot);
        const evidence = readTaskEvidence({
          projectRoot,
          sessionFile: task.evidence?.sessionFile,
          sessionId: task.sessionId,
          turnIds: task.turnIds,
        });
        if (evidence.missingTurnIds.length > 0) {
          return failed(null, null, 'Some task turns can no longer be read from the local Codex session.');
        }
        const documentFile = path.resolve(projectRoot, task.document.projectFile);
        if (!isWithin(projectRoot, documentFile) || !fs.existsSync(documentFile)) {
          return failed(null, null, 'The task flow document is missing from the project.');
        }
        const packageData = buildSyncPackage({ task, evidence, projectRoot, documentFile, now: now() });
        writeSyncPackage(projectRoot, packageData);
        return ready(packageData.manifest);
      } catch (error) {
        return failed(null, error, 'Unable to add the task to synchronization.');
      }
    },

    async getRepositoryStatus(projectRoot) {
      return repositoryStatus(projectRoot, run);
    },

    async pullRepository(projectRoot) {
      const status = await repositoryStatus(projectRoot, run);
      if (status.status !== 'ready') return status;
      if (status.data.changes.length > 0) {
        return failed(status.data, null, 'The project has uncommitted changes. Commit or move them before pulling.');
      }
      if (status.data.remoteAhead === 0) return status;
      if (status.data.diverged) return failed(status.data, null, 'The local and remote branches have diverged. Resolve them manually before pulling.');
      try {
        await run('git', ['pull', '--ff-only'], projectRoot);
        return repositoryStatus(projectRoot, run);
      } catch (error) {
        return failed(null, error, gitError(error, 'Unable to pull the project.'));
      }
    },

    async publishRepository({ projectRoot, selectedPaths = [], message }) {
      const status = await repositoryStatus(projectRoot, run);
      if (status.status !== 'ready') return status;
      if (!status.data.remote) return failed(status.data, null, 'No remote repository is configured.');
      if (status.data.remoteAhead > 0 || status.data.diverged) {
        return failed(status.data, null, 'The remote branch changed. Pull and review it before publishing.');
      }
      if (status.data.changes.some(change => change.blocked)) {
        return failed(status.data, null, 'Sensitive files are present in the working tree. Remove them from the change set before publishing.');
      }

      const safePaths = (selectedPaths.length > 0
        ? selectedPaths
        : status.data.changes.map(change => change.path))
        .filter(relativePath => status.data.changes.some(change => change.path === relativePath && !change.blocked));
      if (safePaths.length > 0) {
        await run('git', ['add', '--', ...safePaths], projectRoot);
      }
      const commitMessage = typeof message === 'string' && message.trim()
        ? message.trim()
        : 'chore(workbench): synchronize project state';
      if (safePaths.length > 0) {
        try {
          await run('git', ['commit', '-m', commitMessage], projectRoot);
        } catch (error) {
          return failed(status.data, error, gitError(error, 'Unable to create the synchronization commit.'));
        }
      } else if (status.data.localAhead === 0) {
        return ready(status.data);
      }
      try {
        const branch = status.data.branch;
        await run('git', ['push', '--set-upstream', status.data.remoteName, branch], projectRoot);
        return repositoryStatus(projectRoot, run);
      } catch (error) {
        return failed(null, error, gitError(error, 'The commit was created, but pushing it failed.'));
      }
    },

    async createGithubRepository({ projectRoot, name, privateRepository = true }) {
      const root = await repositoryRoot(projectRoot, run);
      if (root.status !== 'ready') return root;
      if (!name || typeof name !== 'string' || !/^[\w.-]+(?:\/[\w.-]+)?$/.test(name.trim())) {
        return failed(null, null, 'Enter a valid GitHub repository name.');
      }
      try {
        await run('gh', ['repo', 'create', name.trim(), privateRepository ? '--private' : '--public'], projectRoot);
        const remote = await run('gh', ['repo', 'view', name.trim(), '--json', 'sshUrl', '--jq', '.sshUrl'], projectRoot);
        const url = remote.stdout.trim();
        if (!url) throw new Error('GitHub did not return a repository URL.');
        const current = await repositoryStatus(projectRoot, run);
        if (current.status !== 'ready') return current;
        if (current.data.remoteUrl) {
          await run('git', ['remote', 'set-url', current.data.remoteName, url], projectRoot);
        } else {
          await run('git', ['remote', 'add', 'origin', url], projectRoot);
        }
        return repositoryStatus(projectRoot, run);
      } catch (error) {
        return failed(null, error, gitError(error, 'Unable to create or connect the GitHub repository.'));
      }
    },
  };
}

export function buildSyncPackage({ task, evidence, projectRoot, documentFile, now }) {
  const documentPath = relativePath(projectRoot, documentFile);
  const turns = evidence.turns.map(turn => ({
    id: turn.id,
    sessionId: turn.sessionId,
    cwd: sanitizePath(turn.cwd, projectRoot),
    userInput: sanitizeText(turn.userInput, projectRoot),
    startedAt: turn.startedAt,
    updatedAt: turn.updatedAt,
    status: turn.status,
    metrics: turn.metrics,
    eventCount: turn.events.length,
  }));
  const records = [];
  for (const turn of evidence.turns) {
    turn.events.forEach((event, index) => {
      records.push({
        version: SYNC_VERSION,
        taskId: task.id,
        sessionId: turn.sessionId,
        turnId: turn.id,
        sequence: index,
        event: {
          kind: event.kind,
          timestamp: event.timestamp,
          name: sanitizeText(event.name, projectRoot),
          detail: sanitizeText(event.detail, projectRoot),
          callId: event.callId,
          success: event.success,
        },
        evidence: {
          sourceLine: event.source?.line ?? null,
        },
      });
    });
  }
  const manifest = {
    version: SYNC_VERSION,
    id: task.id,
    title: sanitizeText(task.title, projectRoot),
    createdAt: task.createdAt,
    updatedAt: now.toISOString(),
    projectFile: documentPath,
    source: {
      provider: 'codex',
      sessionId: task.sessionId,
      turnIds: task.turnIds,
    },
    turns,
    eventCount: records.length,
    privacy: { redacted: true, absolutePathsRemoved: true, rawSessionIncluded: false },
  };
  return { manifest, records };
}

function writeSyncPackage(projectRoot, packageData) {
  const directory = taskDirectory(projectRoot, packageData.manifest.id);
  fs.mkdirSync(directory, { recursive: true });
  writeAtomic(path.join(directory, 'manifest.json'), `${JSON.stringify(packageData.manifest, null, 2)}\n`);
  writeAtomic(
    path.join(directory, 'evidence.jsonl'),
    packageData.records.map(record => JSON.stringify(record)).join('\n') + (packageData.records.length ? '\n' : ''),
  );
}

async function repositoryStatus(projectRoot, run) {
  const root = await repositoryRoot(projectRoot, run);
  if (root.status !== 'ready') return root;
  try {
    const branchResult = await run('git', ['branch', '--show-current'], projectRoot);
    const branch = branchResult.stdout.trim();
    if (!branch) return failed(null, null, 'The project is in detached HEAD state.');
    const remoteResult = await run('git', ['remote'], projectRoot);
    const remoteName = remoteResult.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean)[0] ?? null;
    const remoteUrl = remoteName ? (await run('git', ['remote', 'get-url', remoteName], projectRoot)).stdout.trim() : null;
    const statusResult = await run('git', ['status', '--porcelain=v1', '-z'], projectRoot);
    const changes = parseStatus(statusResult.stdout);
    let localAhead = 0;
    let remoteAhead = 0;
    let diverged = false;
    if (remoteName) {
      try {
        await run('git', ['fetch', '--quiet', remoteName, branch], projectRoot);
        const counts = await run('git', ['rev-list', '--left-right', '--count', `${remoteName}/${branch}...${branch}`], projectRoot);
        const [remoteCount, localCount] = counts.stdout.trim().split(/\s+/).map(Number);
        remoteAhead = Number.isFinite(remoteCount) ? remoteCount : 0;
        localAhead = Number.isFinite(localCount) ? localCount : 0;
        diverged = remoteAhead > 0 && localAhead > 0;
      } catch {
        // A remote branch may not exist yet; the first push will establish it.
      }
    }
    return ready({
      root: root.data,
      branch,
      remoteName,
      remoteUrl,
      remote: remoteName,
      changes,
      clean: changes.length === 0,
      localAhead,
      remoteAhead,
      diverged,
    });
  } catch (error) {
    return failed(null, error, gitError(error, 'Unable to read the project repository status.'));
  }
}

async function repositoryRoot(projectRoot, run) {
  if (!validProjectRoot(projectRoot)) return failed(null, null, 'A project must be open.');
  try {
    const result = await run('git', ['rev-parse', '--show-toplevel'], projectRoot);
    const root = path.resolve(result.stdout.trim());
    const selected = path.resolve(projectRoot);
    if (root !== selected) return failed(null, null, 'Open the repository root as the project before using synchronization.');
    return ready(root);
  } catch (error) {
    return failed(null, error, 'The selected project is not a Git repository.');
  }
}

function parseStatus(output) {
  return output.split('\0').filter(Boolean).map(entry => {
    const status = entry.slice(0, 2);
    const rawPath = entry.slice(3).replaceAll('\\', '/');
    return {
      path: rawPath,
      status,
      kind: status === '??' ? 'untracked' : status.includes('D') ? 'deleted' : 'modified',
      blocked: isBlockedPath(rawPath),
    };
  });
}

function isBlockedPath(relativePath) {
  const name = path.posix.basename(relativePath);
  return BLOCKED_FILE_PATTERNS.some(pattern => pattern.test(name));
}

function sanitizeText(value, projectRoot) {
  if (typeof value !== 'string') return value ?? '';
  const redacted = redactCredentialText(value, { context: 'command' });
  const variants = [projectRoot, projectRoot.replaceAll('\\', '/')]
    .filter(Boolean)
    .map(escapeRegExp);
  const projectPattern = variants.length > 0 ? new RegExp(variants.join('|'), 'gi') : null;
  return (projectPattern ? redacted.replace(projectPattern, '<project-root>') : redacted)
    .replace(/[A-Za-z]:[\\/][^\s"'`|;&]+/g, '<local-path>')
    .replace(/\\\\[^\s"'`|;&]+/g, '<local-path>');
}

function sanitizePath(value, projectRoot) {
  if (typeof value !== 'string' || !value) return null;
  return isWithin(projectRoot, path.resolve(value)) ? relativePath(projectRoot, value) : '<external-path>';
}

function relativePath(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function syncTasksDirectory(projectRoot) {
  return path.join(projectRoot, SYNC_DIRECTORY, TASK_DIRECTORY);
}

function taskDirectory(projectRoot, taskId) {
  return path.join(syncTasksDirectory(projectRoot), taskId);
}

function readManifest(directory) {
  const file = path.join(directory, 'manifest.json');
  if (!fs.existsSync(file)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    return manifest?.version === SYNC_VERSION && validTaskId(manifest.id) ? manifest : null;
  } catch {
    return null;
  }
}

function parseJsonLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function writeAtomic(file, content) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, 'utf8');
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function validProjectRoot(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validTaskId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ready(data) {
  return { status: 'ready', source: 'workbench-sync', data, error: null };
}

function result(data, error) {
  return { status: 'error', source: 'workbench-sync', data, error };
}

function failed(data, error, message) {
  return { status: 'error', source: 'workbench-sync', data, error: message || (error instanceof Error ? error.message : 'Synchronization failed.') };
}

async function runCommand(command, args, cwd) {
  return execFile(command, args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
}

function gitError(error, fallback) {
  return error?.stderr?.trim() || error?.stdout?.trim() || (error instanceof Error ? error.message : fallback);
}
