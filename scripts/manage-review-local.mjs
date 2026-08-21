import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  openLocalDatabase,
  resolveDefaultDatabasePath,
} from '../packages/local-database/dist/index.js';
import {
  assertReviewCaseRecord,
  createSqliteReviewStore,
} from '../packages/review/dist/index.js';

const [command, ...argumentsList] = process.argv.slice(2).filter(argument => argument !== '--');
const options = parseArgs(argumentsList);
const databasePath = resolveDatabasePath(options);
const database = openLocalDatabase({ filePath: databasePath });
const store = createSqliteReviewStore({ database });

try {
  if (command === 'list') {
    const cases = await store.listCases({
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.limit ? { limit: integer(options.limit, '--limit') } : {}),
    });
    output({ databasePath, cases });
  } else if (command === 'show') {
    const record = await requiredCase(store, required(options.caseId, '--case-id'));
    output({ databasePath, record });
  } else if (command === 'annotate') {
    const verdict = required(options.verdict, '--verdict');
    if (!['correct', 'partially_correct', 'incorrect'].includes(verdict)) {
      throw new Error('--verdict must be correct, partially_correct, or incorrect.');
    }
    const record = await store.appendAnnotation({
      annotationId: options.annotationId ?? `annotation_${randomUUID()}`,
      judgementId: required(options.judgementId, '--judgement-id'),
      annotatorId: options.annotatorId ?? 'local-user',
      verdict,
      ...(options.correctedCategory ? { correctedCategory: options.correctedCategory } : {}),
      ...(options.correctedSummary ? { correctedSummary: options.correctedSummary } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
      ...(options.missingIssue ? { missingIssue: options.missingIssue } : {}),
      createdAt: new Date().toISOString(),
    });
    output({ databasePath, record });
  } else if (command === 'export') {
    const record = await requiredCase(store, required(options.caseId, '--case-id'));
    assertReviewCaseRecord(record);
    const target = path.resolve(required(options.output, '--output'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    output({ databasePath, exportedTo: target, caseId: record.reviewCase.caseId });
  } else if (command === 'backup') {
    const target = path.resolve(required(options.output, '--output'));
    database.backup(target);
    output({ databasePath, backupPath: target, integrity: database.integrityCheck() });
  } else if (command === 'doctor') {
    output({
      databasePath,
      integrity: database.integrityCheck(),
      migrations: database.appliedMigrations(),
    });
  } else {
    throw new Error('Usage: review:local <list|show|annotate|export|backup|doctor> [options]');
  }
} finally {
  database.close();
}

async function requiredCase(storeInstance, caseId) {
  const record = await storeInstance.getCase(caseId);
  if (!record) throw new Error(`Review case does not exist: ${caseId}`);
  return record;
}

function resolveDatabasePath(values) {
  if (values.database && values.dataDir) throw new Error('Use either --database or --data-dir, not both.');
  if (values.database) return path.resolve(values.database);
  if (values.dataDir) return path.join(path.resolve(values.dataDir), 'agent-workbench.db');
  return resolveDefaultDatabasePath();
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const raw = args[index];
    const value = args[index + 1];
    if (!raw?.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${raw ?? ''}`);
    const key = raw.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    result[key] = value;
  }
  return result;
}

function required(value, option) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${option} is required.`);
  return value.trim();
}

function integer(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${option} must be an integer.`);
  return parsed;
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
