import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

export type LocalDatabaseMigration = {
  version: number;
  name: string;
  statements: readonly string[];
};

export type LocalDatabaseIntegrity = {
  ok: boolean;
  messages: string[];
};

export type OpenLocalDatabaseOptions = {
  filePath: string;
  migrations?: readonly LocalDatabaseMigration[];
  now?: () => Date;
};

export type LocalDatabase = {
  readonly filePath: string;
  execute(sql: string): void;
  prepare(sql: string): StatementSync;
  transaction<T>(operation: () => T): T;
  migrate(migrations: readonly LocalDatabaseMigration[]): void;
  appliedMigrations(): Array<{ version: number; name: string; appliedAt: string }>;
  integrityCheck(): LocalDatabaseIntegrity;
  backup(outputPath: string): void;
  close(): void;
};

export function openLocalDatabase(options: OpenLocalDatabaseOptions): LocalDatabase {
  const filePath = options.filePath === ':memory:' ? options.filePath : path.resolve(options.filePath);
  if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: 5_000,
  });
  const now = options.now ?? (() => new Date());
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  if (filePath !== ':memory:') database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = NORMAL');
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
  const local: LocalDatabase = {
    filePath,
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
      database.exec('BEGIN IMMEDIATE');
      let transactionOpen = true;
      try {
        const result = operation();
        if (isPromiseLike(result)) {
          database.exec('ROLLBACK');
          transactionOpen = false;
          throw new Error('Local database transactions require synchronous callbacks.');
        }
        database.exec('COMMIT');
        transactionOpen = false;
        return result;
      } catch (error) {
        if (transactionOpen) database.exec('ROLLBACK');
        throw error;
      }
    },
    migrate(migrations) {
      requireOpen();
      applyMigrations(database, migrations, now);
    },
    appliedMigrations() {
      requireOpen();
      return database.prepare(
        'SELECT version, name, applied_at AS appliedAt FROM schema_migrations ORDER BY version',
      ).all() as Array<{ version: number; name: string; appliedAt: string }>;
    },
    integrityCheck() {
      requireOpen();
      const rows = database.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>;
      const messages = rows.map(row => String(row.integrity_check ?? Object.values(row)[0] ?? 'unknown'));
      return { ok: messages.length === 1 && messages[0] === 'ok', messages };
    },
    backup(outputPath) {
      requireOpen();
      if (filePath === ':memory:') throw new Error('An in-memory database cannot be backed up to a file.');
      const target = path.resolve(outputPath);
      if (target === filePath) throw new Error('Backup path must differ from the database path.');
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
  local.migrate(options.migrations ?? []);
  return local;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function');
}

export function resolveDefaultDatabasePath(
  localAppData = process.env.LOCALAPPDATA,
): string {
  if (typeof localAppData !== 'string' || !localAppData.trim()) {
    throw new Error('LOCALAPPDATA is unavailable; provide an explicit database path.');
  }
  return path.join(path.resolve(localAppData), 'Agent Workbench', 'data', 'agent-workbench.db');
}

function applyMigrations(
  database: DatabaseSync,
  migrations: readonly LocalDatabaseMigration[],
  now: () => Date,
): void {
  const ordered = [...migrations].sort((left, right) => left.version - right.version);
  const versions = new Set<number>();
  const names = new Set<string>();
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
    const applied = database.prepare(
      'SELECT name FROM schema_migrations WHERE version = ?',
    ).get(migration.version) as { name: string } | undefined;
    if (applied) {
      if (applied.name !== migration.name) {
        throw new Error(`Migration ${migration.version} name mismatch: ${applied.name} != ${migration.name}`);
      }
      continue;
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of migration.statements) database.exec(statement);
      database.prepare(
        'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, now().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
