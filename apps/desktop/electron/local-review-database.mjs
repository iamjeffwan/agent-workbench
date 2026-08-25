import fs from 'node:fs';
import path from 'node:path';

/**
 * Opens SQLite from the Electron-compatible native driver. It mirrors the
 * small local-database interface used by the review store, while deliberately
 * avoiding Node's optional `node:sqlite` binding, which Electron does not ship.
 */
export async function openElectronReviewDatabase({ filePath, migrations = [], now = () => new Date() }) {
  const { default: Database } = await import('better-sqlite3');
  const resolvedFilePath = filePath === ':memory:' ? filePath : path.resolve(filePath);
  if (resolvedFilePath !== ':memory:') fs.mkdirSync(path.dirname(resolvedFilePath), { recursive: true });

  const database = new Database(resolvedFilePath, { timeout: 5_000 });
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  if (resolvedFilePath !== ':memory:') database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) STRICT
  `);

  let closed = false;
  const requireOpen = () => {
    if (closed) throw new Error('Local database is closed.');
  };
  const local = {
    filePath: resolvedFilePath,
    execute(sql) {
      requireOpen();
      database.exec(sql);
    },
    prepare(sql) {
      requireOpen();
      return database.prepare(sql);
    },
    transaction(operation) {
      requireOpen();
      const transaction = database.transaction(() => {
        const result = operation();
        if (isPromiseLike(result)) {
          throw new Error('Local database transactions require synchronous callbacks.');
        }
        return result;
      });
      return transaction();
    },
    migrate(nextMigrations) {
      requireOpen();
      applyMigrations(database, nextMigrations, now);
    },
    appliedMigrations() {
      requireOpen();
      return database.prepare(
        'SELECT version, name, applied_at AS appliedAt FROM schema_migrations ORDER BY version',
      ).all();
    },
    integrityCheck() {
      requireOpen();
      const rows = database.prepare('PRAGMA integrity_check').all();
      const messages = rows.map(row => String(row.integrity_check ?? Object.values(row)[0] ?? 'unknown'));
      return { ok: messages.length === 1 && messages[0] === 'ok', messages };
    },
    backup(outputPath) {
      requireOpen();
      if (resolvedFilePath === ':memory:') throw new Error('An in-memory database cannot be backed up to a file.');
      const target = path.resolve(outputPath);
      if (target === resolvedFilePath) throw new Error('Backup path must differ from the database path.');
      if (fs.existsSync(target)) throw new Error(`Backup target already exists: ${target}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      database.prepare('VACUUM INTO ?').run(target);
    },
    close() {
      if (closed) return;
      database.close();
      closed = true;
    },
  };
  local.migrate(migrations);
  return local;
}

export function resolveDefaultReviewDatabasePath(localAppData = process.env.LOCALAPPDATA) {
  if (typeof localAppData !== 'string' || !localAppData.trim()) {
    throw new Error('LOCALAPPDATA is unavailable; provide an explicit database path.');
  }
  return path.join(path.resolve(localAppData), 'Agent Workbench', 'data', 'agent-workbench.db');
}

function applyMigrations(database, migrations, now) {
  const ordered = [...migrations].sort((left, right) => left.version - right.version);
  const versions = new Set();
  const names = new Set();
  for (const migration of ordered) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new TypeError('Migration versions must be positive integers.');
    }
    if (!migration.name.trim()) throw new TypeError('Migration names must be non-empty.');
    if (versions.has(migration.version) || names.has(migration.name)) {
      throw new Error(`Duplicate local database migration: ${migration.version} ${migration.name}`);
    }
    versions.add(migration.version);
    names.add(migration.name);
    const applied = database.prepare('SELECT name FROM schema_migrations WHERE version = ?').get(migration.version);
    if (applied) {
      if (applied.name !== migration.name) {
        throw new Error(`Migration ${migration.version} name mismatch: ${applied.name} != ${migration.name}`);
      }
      continue;
    }
    const migrate = database.transaction(() => {
      for (const statement of migration.statements) database.exec(statement);
      database.prepare(
        'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, now().toISOString());
    });
    migrate();
  }
}

function isPromiseLike(value) {
  return Boolean(value && typeof value === 'object' && typeof value.then === 'function');
}
