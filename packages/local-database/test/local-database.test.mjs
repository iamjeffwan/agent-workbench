import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  openLocalDatabase,
  resolveDefaultDatabasePath,
} from '../dist/index.js';

const migration = {
  version: 1,
  name: 'test-records',
  statements: ['CREATE TABLE test_records(id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT'],
};

test('applies migrations once and commits or rolls back transactions', () => {
  const database = openLocalDatabase({ filePath: ':memory:', migrations: [migration] });
  database.migrate([migration]);
  assert.equal(database.appliedMigrations().length, 1);
  assert.throws(() => database.transaction(() => {
    database.prepare('INSERT INTO test_records(id, value) VALUES (?, ?)').run('one', 'saved');
    throw new Error('rollback');
  }), /rollback/);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM test_records').get().count, 0);
  database.close();
});

test('rejects asynchronous transaction callbacks before committing', () => {
  const database = openLocalDatabase({ filePath: ':memory:', migrations: [migration] });
  assert.throws(() => database.transaction(() => {
    database.prepare('INSERT INTO test_records(id, value) VALUES (?, ?)').run('async', 'not-saved');
    return Promise.resolve();
  }), /synchronous callbacks/);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM test_records').get().count, 0);
  database.close();
});

test('checks integrity and creates a restorable backup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workbench-db-'));
  const source = path.join(root, 'source.db');
  const backup = path.join(root, 'backup.db');
  const database = openLocalDatabase({ filePath: source, migrations: [migration] });
  database.prepare('INSERT INTO test_records(id, value) VALUES (?, ?)').run('one', 'saved');
  assert.deepEqual(database.integrityCheck(), { ok: true, messages: ['ok'] });
  database.backup(backup);
  database.close();

  const restored = openLocalDatabase({ filePath: backup, migrations: [migration] });
  assert.equal(restored.prepare('SELECT value FROM test_records WHERE id = ?').get('one').value, 'saved');
  restored.close();
});

test('resolves the per-device database below local application data', () => {
  assert.equal(
    resolveDefaultDatabasePath('C:\\Users\\tester\\AppData\\Local'),
    path.resolve('C:\\Users\\tester\\AppData\\Local', 'Agent Workbench', 'data', 'agent-workbench.db'),
  );
});
