import assert from 'node:assert/strict';
import test from 'node:test';

import { createDailyReviewScheduler } from '../electron/daily-review-scheduler.mjs';

test('registers a project and schedules the previous complete day at startup', async () => {
  const runs = [];
  let current = new Date('2026-08-25T10:00:00.000Z');
  const scheduler = createDailyReviewScheduler({
    getUserDataPath: () => 'C:\\scheduler-test',
    now: () => current,
    timeZone: () => 'UTC',
    runDaily: async (projectRoot, options) => {
      runs.push({ projectRoot, options });
      return ready({ batch: { status: 'completed' } });
    },
    storage: memoryStorage(),
    schedule: () => () => {},
  });

  await scheduler.register('C:\\project');
  current = new Date('2026-08-26T10:00:00.000Z');
  await scheduler.start();

  assert.deepEqual(scheduler.getState().projects[0].pendingDates, ['2026-08-25']);
  assert.equal(runs.length, 0);
});

test('runs one selected pending date and removes it only after completion', async () => {
  const runs = [];
  const scheduler = createDailyReviewScheduler({
    getUserDataPath: () => 'C:\\scheduler-test',
    now: () => new Date('2026-08-27T10:00:00.000Z'),
    timeZone: () => 'UTC',
    runDaily: async (projectRoot, options) => {
      runs.push({ projectRoot, options });
      return ready({ batch: { status: 'completed' } });
    },
    storage: memoryStorage({
      projects: {
        'c:\\project': {
          projectRoot: 'C:\\project',
          registeredAt: '2026-08-25T10:00:00.000Z',
          pendingDates: ['2026-08-25', '2026-08-26'],
        },
      },
    }),
    schedule: () => () => {},
  });

  await scheduler.start();
  await scheduler.runPending('C:\\project', '2026-08-25');

  assert.deepEqual(runs, [{ projectRoot: 'C:\\project', options: { localDate: '2026-08-25' } }]);
  assert.deepEqual(scheduler.getState().projects[0].pendingDates, ['2026-08-26']);
});

test('automatically processes all pending dates when the midnight timer fires', async () => {
  const runs = [];
  let fire;
  const scheduler = createDailyReviewScheduler({
    getUserDataPath: () => 'C:\\scheduler-test',
    now: () => new Date('2026-08-27T00:00:00.000Z'),
    timeZone: () => 'UTC',
    runDaily: async (projectRoot, options) => {
      runs.push({ projectRoot, options });
      return ready({ batch: { status: 'completed' } });
    },
    storage: memoryStorage({
      projects: {
        'c:\\project': {
          projectRoot: 'C:\\project',
          registeredAt: '2026-08-24T10:00:00.000Z',
          pendingDates: ['2026-08-24', '2026-08-25', '2026-08-26'],
        },
      },
    }),
    schedule: callback => { fire = callback; return () => {}; },
  });

  await scheduler.start();
  await fire();

  assert.deepEqual(runs.map(item => item.options.localDate), ['2026-08-24', '2026-08-25', '2026-08-26']);
  assert.deepEqual(scheduler.getState().projects[0].pendingDates, []);
});

test('keeps a failed date pending and allows snoozing without deleting it', async () => {
  const scheduler = createDailyReviewScheduler({
    getUserDataPath: () => 'C:\\scheduler-test',
    now: () => new Date('2026-08-26T10:00:00.000Z'),
    timeZone: () => 'UTC',
    runDaily: async () => ({ status: 'error', data: null, error: 'model unavailable' }),
    storage: memoryStorage({
      projects: {
        'c:\\project': {
          projectRoot: 'C:\\project',
          registeredAt: '2026-08-25T10:00:00.000Z',
          pendingDates: ['2026-08-25'],
        },
      },
    }),
    schedule: () => () => {},
  });

  await scheduler.start();
  await scheduler.runPending('C:\\project', '2026-08-25');
  scheduler.snooze('C:\\project', '2026-08-25');

  const project = scheduler.getState().projects[0];
  assert.deepEqual(project.pendingDates, ['2026-08-25']);
  assert.deepEqual(scheduler.getState().reminders, []);
  assert.equal(project.lastError, 'model unavailable');
});

test('unregistering a project removes its pending reminders', async () => {
  const scheduler = createDailyReviewScheduler({
    getUserDataPath: () => 'C:\\scheduler-test',
    now: () => new Date('2026-08-27T10:00:00.000Z'),
    timeZone: () => 'UTC',
    runDaily: async () => ready({ batch: { status: 'completed' } }),
    storage: memoryStorage({
      projects: {
        'c:\\project': {
          projectRoot: 'C:\\project',
          registeredAt: '2026-08-25T10:00:00.000Z',
          pendingDates: ['2026-08-25'],
        },
      },
    }),
    schedule: () => () => {},
  });

  await scheduler.start();
  await scheduler.unregister('C:\\project');

  assert.deepEqual(scheduler.getState().projects, []);
  assert.deepEqual(scheduler.getState().reminders, []);
});

function ready(data) {
  return { status: 'ready', data, error: null };
}

function memoryStorage(initial = { projects: {} }) {
  let value = structuredClone(initial);
  return {
    read: () => structuredClone(value),
    write: next => { value = structuredClone(next); },
  };
}
