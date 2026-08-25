import fs from 'node:fs';
import path from 'node:path';

const CONFIG_FILE = 'daily-review-scheduling.json';
const CONFIG_VERSION = 1;

export function createDailyReviewScheduler({
  getUserDataPath,
  runDaily,
  now = () => new Date(),
  timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  storage = null,
  schedule = defaultSchedule,
} = {}) {
  if (typeof getUserDataPath !== 'function') throw new Error('getUserDataPath is required');
  if (typeof runDaily !== 'function') throw new Error('runDaily is required');

  const listeners = new Set();
  const snoozed = new Set();
  const activeDates = new Set();
  let config = null;
  let started = false;
  let cancelTimer = null;
  let queue = Promise.resolve();

  return {
    async start() {
      if (started) return getState();
      load();
      reconcile();
      started = true;
      scheduleNextTick();
      emit();
      return getState();
    },

    stop() {
      started = false;
      cancelTimer?.();
      cancelTimer = null;
    },

    getState,

    async register(projectRoot) {
      load();
      const root = normalizeRoot(projectRoot);
      if (!root) return getState();
      const key = projectKey(root);
      if (!config.projects[key]) {
        config.projects[key] = {
          projectRoot: root,
          registeredAt: now().toISOString(),
          pendingDates: [],
          status: 'idle',
          lastRun: null,
          lastError: null,
        };
        save();
        emit();
      }
      return getState();
    },

    async unregister(projectRoot) {
      load();
      const root = normalizeRoot(projectRoot);
      if (root) {
        delete config.projects[projectKey(root)];
        snoozed.forEach(value => { if (value.startsWith(`${projectKey(root)}\0`)) snoozed.delete(value); });
        save();
        emit();
      }
      return getState();
    },

    async runPending(projectRoot, localDate) {
      load();
      reconcile();
      const root = normalizeRoot(projectRoot);
      const key = root && projectKey(root);
      const project = key ? config.projects[key] : null;
      if (!project || !project.pendingDates.includes(localDate)) {
        return { status: 'error', source: 'daily-review-scheduling', data: null, error: 'The selected daily review date is not pending.' };
      }
      return scheduleExecution(project, localDate);
    },

    snooze(projectRoot, localDate) {
      const root = normalizeRoot(projectRoot);
      if (root) {
        snoozed.add(`${projectKey(root)}\0${localDate}`);
        emit();
      }
      return getState();
    },

    refresh() {
      load();
      reconcile();
      emit();
      return getState();
    },

    onChange(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  function load() {
    if (config) return;
    const source = storage ?? fileStorage(getUserDataPath);
    const parsed = source.read();
    config = normalizeConfig(parsed);
  }

  function save() {
    (storage ?? fileStorage(getUserDataPath)).write(config);
  }

  function getState() {
    load();
    const projects = Object.values(config.projects)
      .sort((left, right) => left.projectRoot.localeCompare(right.projectRoot))
      .map(project => ({ ...project, pendingDates: [...project.pendingDates] }));
    return {
      version: CONFIG_VERSION,
      started,
      projects,
      reminders: projects.flatMap(project => project.pendingDates
        .filter(localDate => !snoozed.has(`${projectKey(project.projectRoot)}\0${localDate}`))
        .map(localDate => ({ projectRoot: project.projectRoot, localDate, status: project.status, lastError: project.lastError }))),
    };
  }

  function reconcile() {
    const today = localDate(now(), timeZone());
    const yesterday = shiftDate(today, -1);
    let changed = false;
    for (const project of Object.values(config.projects)) {
      const firstDate = localDate(project.registeredAt, timeZone());
      for (const date of datesBetween(firstDate, yesterday)) {
        if (!project.pendingDates.includes(date)) {
          project.pendingDates.push(date);
          changed = true;
        }
      }
      project.pendingDates.sort();
    }
    if (changed) save();
  }

  function scheduleNextTick() {
    if (!started) return;
    cancelTimer?.();
    const current = now();
    const next = new Date(current);
    next.setHours(24, 0, 0, 0);
    cancelTimer = schedule(() => {
      return runDue().finally(scheduleNextTick);
    }, Math.max(1, next.getTime() - current.getTime()));
  }

  async function runDue() {
    load();
    reconcile();
    const pending = Object.values(config.projects).flatMap(project => (
      project.pendingDates.map(localDate => ({ projectRoot: project.projectRoot, localDate }))
    ));
    for (const item of pending) {
      const project = config.projects[projectKey(item.projectRoot)];
      if (project?.pendingDates.includes(item.localDate)) {
        await scheduleExecution(project, item.localDate);
      }
    }
  }

  function enqueue(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  function scheduleExecution(project, localDate) {
    const key = `${projectKey(project.projectRoot)}\0${localDate}`;
    if (activeDates.has(key)) {
      return Promise.resolve({ status: 'error', source: 'daily-review-scheduling', data: null, error: 'This daily review date is already queued.' });
    }
    activeDates.add(key);
    project.status = 'queued';
    save();
    emit();
    return enqueue(async () => {
      try {
        if (config.projects[projectKey(project.projectRoot)] !== project) {
          return { status: 'error', source: 'daily-review-scheduling', data: null, error: 'The project is no longer registered.' };
        }
        return await execute(project, localDate);
      } finally {
        activeDates.delete(key);
      }
    });
  }

  async function execute(project, localDate) {
    project.status = 'running';
    project.lastError = null;
    save();
    emit();
    try {
      const result = await runDaily(project.projectRoot, { localDate });
      const completed = result?.status === 'ready' && result.data?.batch?.status === 'completed';
      if (!completed) {
        const error = result?.error ?? result?.data?.batch?.synthesis?.failureReason ?? 'Daily review did not complete.';
        project.status = 'failed';
        project.lastError = error;
        project.lastRun = { localDate, status: 'failed', completedAt: now().toISOString(), error };
        save();
        emit();
        return { status: 'error', source: 'daily-review-scheduling', data: null, error };
      }
      project.pendingDates = project.pendingDates.filter(value => value !== localDate);
      project.status = 'completed';
      project.lastError = null;
      project.lastRun = { localDate, status: 'completed', completedAt: now().toISOString(), error: null };
      save();
      emit();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Daily review failed.';
      project.status = 'failed';
      project.lastError = message;
      project.lastRun = { localDate, status: 'failed', completedAt: now().toISOString(), error: message };
      save();
      emit();
      return { status: 'error', source: 'daily-review-scheduling', data: null, error: message };
    }
  }

  function emit() {
    const state = getState();
    listeners.forEach(listener => listener(state));
  }
}

function normalizeConfig(value) {
  const projects = {};
  const entries = value?.projects && typeof value.projects === 'object' && !Array.isArray(value.projects)
    ? Object.values(value.projects) : [];
  for (const item of entries) {
    const root = normalizeRoot(item?.projectRoot);
    if (!root || !item?.registeredAt) continue;
    projects[projectKey(root)] = {
      projectRoot: root,
      registeredAt: item.registeredAt,
      pendingDates: Array.isArray(item.pendingDates) ? [...new Set(item.pendingDates.filter(validDate))].sort() : [],
      status: ['idle', 'queued', 'running', 'completed', 'failed'].includes(item.status) ? item.status : 'idle',
      lastRun: item.lastRun ?? null,
      lastError: typeof item.lastError === 'string' ? item.lastError : null,
    };
  }
  return { version: CONFIG_VERSION, projects };
}

function fileStorage(getUserDataPath) {
  const file = path.join(getUserDataPath(), CONFIG_FILE);
  return {
    read() {
      if (!fs.existsSync(file)) return { version: CONFIG_VERSION, projects: {} };
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },
    write(value) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
      try {
        fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        fs.renameSync(temporary, file);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    },
  };
}

function defaultSchedule(callback, delay) {
  const timer = setTimeout(callback, delay);
  return () => clearTimeout(timer);
}

function normalizeRoot(value) {
  return typeof value === 'string' && value.trim() ? path.resolve(value.trim()) : null;
}

function projectKey(value) {
  const root = path.resolve(value);
  return process.platform === 'win32' ? root.toLowerCase() : root;
}

function localDate(value, zone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function datesBetween(start, end) {
  if (!validDate(start) || !validDate(end) || start > end) return [];
  const result = [];
  for (let cursor = start; cursor <= end; cursor = shiftDate(cursor, 1)) result.push(cursor);
  return result;
}

function shiftDate(value, amount) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value); }
