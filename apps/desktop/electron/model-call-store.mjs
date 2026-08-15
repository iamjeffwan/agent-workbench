import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const LEGACY_LOG_FILE = 'model-calls.jsonl';
const EVENT_LOG_FILE = 'calls.jsonl';
const INDEX_FILE = 'model-call-index.json';
const CALL_DIRECTORY = 'calls';
const INDEX_VERSION = 2;

export function createModelCallStore({
  getUserDataPath,
  now = () => new Date(),
  createId = () => randomUUID(),
}) {
  let cachedIndex = null;

  function paths() {
    const directory = path.join(getUserDataPath(), 'model-calls');
    return {
      directory,
      legacyLog: path.join(directory, LEGACY_LOG_FILE),
      eventLog: path.join(directory, EVENT_LOG_FILE),
      index: path.join(directory, INDEX_FILE),
      calls: path.join(directory, CALL_DIRECTORY),
    };
  }

  function start({ purpose, projectRoot, taskId, model, request }) {
    const callId = createId();
    assertCallId(callId);
    const timestamp = now().toISOString();
    const event = {
      version: 2,
      event: 'request.started',
      callId,
      timestamp,
      context: {
        purpose: purpose || 'model-call',
        projectRoot: projectRoot || null,
        taskId: taskId || null,
      },
      model,
    };
    const requestRecord = splitBody(request);
    const directory = callPath(paths(), callId);
    writeJson(path.join(directory, 'request-meta.json'), {
      ...event,
      request: requestRecord.metadata,
    });
    writeText(path.join(directory, 'request-body.json'), requestRecord.body);
    appendEvent({
      ...event,
      files: {
        requestMetadata: relativeCallFile(callId, 'request-meta.json'),
        requestBody: relativeCallFile(callId, 'request-body.json'),
      },
    });
    return callId;
  }

  function complete(callId, { response, summary }) {
    finish(callId, {
      event: 'response.completed',
      response,
      summary,
      error: null,
    });
  }

  function fail(callId, { response = null, error, summary }) {
    finish(callId, {
      event: 'response.failed',
      response,
      summary,
      error,
    });
  }

  function finish(callId, { event, response, summary, error }) {
    assertCallId(callId);
    const timestamp = now().toISOString();
    const responseRecord = splitBody(response);
    const metadata = {
      version: 2,
      event,
      callId,
      timestamp,
      response: responseRecord.metadata,
      summary,
    };
    const directory = callPath(paths(), callId);
    writeJson(path.join(directory, 'response-meta.json'), metadata);
    if (response) writeText(path.join(directory, 'response-body.json'), responseRecord.body);
    if (error != null) writeJson(path.join(directory, 'error.json'), error);
    appendEvent({
      version: 2,
      event,
      callId,
      timestamp,
      summary,
      files: {
        responseMetadata: relativeCallFile(callId, 'response-meta.json'),
        responseBody: response ? relativeCallFile(callId, 'response-body.json') : null,
        error: error != null ? relativeCallFile(callId, 'error.json') : null,
      },
    });
  }

  function appendEvent(event) {
    const resolved = paths();
    fs.mkdirSync(resolved.directory, { recursive: true });
    const index = loadIndex();
    const offset = fileSize(resolved.eventLog);
    const line = Buffer.from(`${JSON.stringify(event)}\n`, 'utf8');
    fs.appendFileSync(resolved.eventLog, line);
    applyEvent(index, event, { storageVersion: 2 });
    index.sourceSizes.events = offset + line.length;
    writeIndex(resolved.index, index);
    cachedIndex = index;
  }

  function list() {
    return loadIndex().calls
      .map(({ eventRefs: _eventRefs, storageVersion: _storageVersion, ...summary }) => summary)
      .sort((left, right) => compareDate(right.startedAt, left.startedAt));
  }

  function read(callId) {
    if (!validCallId(callId)) return null;
    const resolved = paths();
    const summary = loadIndex().calls.find(call => call.callId === callId);
    if (!summary) return null;
    return summary.storageVersion === 2
      ? readFileCall(resolved, callId)
      : readLegacyCall(resolved.legacyLog, summary.eventRefs);
  }

  function loadIndex() {
    const resolved = paths();
    const sourceSizes = {
      legacy: fileSize(resolved.legacyLog),
      events: fileSize(resolved.eventLog),
    };
    if (sameSourceSizes(cachedIndex?.sourceSizes, sourceSizes)) return cachedIndex;
    if (fs.existsSync(resolved.index)) {
      try {
        const stored = JSON.parse(fs.readFileSync(resolved.index, 'utf8'));
        if (
          stored.version === INDEX_VERSION &&
          sameSourceSizes(stored.sourceSizes, sourceSizes) &&
          Array.isArray(stored.calls)
        ) {
          cachedIndex = stored;
          return stored;
        }
      } catch {
        // Rebuild from the append-only sources below.
      }
    }
    const rebuilt = rebuildIndex(resolved);
    if (sourceSizes.legacy > 0 || sourceSizes.events > 0) writeIndex(resolved.index, rebuilt);
    cachedIndex = rebuilt;
    return rebuilt;
  }

  return { start, complete, fail, list, read };
}

function rebuildIndex(resolved) {
  const index = {
    version: INDEX_VERSION,
    sourceSizes: {
      legacy: fileSize(resolved.legacyLog),
      events: fileSize(resolved.eventLog),
    },
    calls: [],
  };
  scanLog(resolved.legacyLog, (event, reference) => {
    applyEvent(index, event, { storageVersion: 1, reference });
  });
  scanLog(resolved.eventLog, event => {
    applyEvent(index, event, { storageVersion: 2 });
  });
  return index;
}

function scanLog(logPath, visit) {
  if (!fs.existsSync(logPath)) return;
  const source = fs.readFileSync(logPath);
  let offset = 0;
  while (offset < source.length) {
    const newline = source.indexOf(10, offset);
    const end = newline === -1 ? source.length : newline + 1;
    const length = end - offset;
    const text = source.subarray(offset, end).toString('utf8').trim();
    if (text) {
      try {
        visit(JSON.parse(text), { offset, length });
      } catch {
        // Invalid source rows stay in the raw log but cannot be indexed.
      }
    }
    offset = end;
  }
}

function applyEvent(index, event, { storageVersion, reference = null }) {
  if (!event || typeof event.callId !== 'string') return;
  let summary = index.calls.find(call => call.callId === event.callId);
  if (event.event === 'request.started') {
    if (!summary) {
      summary = {
        callId: event.callId,
        purpose: event.context?.purpose || 'model-call',
        projectRoot: event.context?.projectRoot || null,
        taskId: event.context?.taskId || null,
        model: event.model || null,
        startedAt: event.timestamp || null,
        endedAt: null,
        status: 'running',
        durationMs: null,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        storageVersion,
        eventRefs: [],
      };
      index.calls.push(summary);
    }
  }
  if (!summary) return;
  if (storageVersion === 1 && reference) summary.eventRefs.push(reference);
  if (event.event === 'response.completed' || event.event === 'response.failed') {
    summary.endedAt = event.timestamp || null;
    summary.status = event.event === 'response.completed' ? 'completed' : 'failed';
    summary.durationMs = numberOrNull(event.summary?.durationMs);
    summary.inputTokens = numberOrZero(event.summary?.inputTokens);
    summary.outputTokens = numberOrZero(event.summary?.outputTokens);
    summary.totalTokens = numberOrZero(event.summary?.totalTokens);
  }
}

function readFileCall(resolved, callId) {
  const directory = callPath(resolved, callId);
  const requestFile = path.join(directory, 'request-meta.json');
  if (!fs.existsSync(requestFile)) return null;
  const started = readJson(requestFile);
  started.request = {
    ...(started.request ?? {}),
    body: readText(path.join(directory, 'request-body.json')),
  };
  const events = [started];
  const responseFile = path.join(directory, 'response-meta.json');
  if (!fs.existsSync(responseFile)) return events;
  const finished = readJson(responseFile);
  const responseBodyFile = path.join(directory, 'response-body.json');
  if (finished.response && fs.existsSync(responseBodyFile)) {
    finished.response = { ...finished.response, body: readText(responseBodyFile) };
  } else if (finished.response && Object.keys(finished.response).length === 0) {
    delete finished.response;
  }
  const errorFile = path.join(directory, 'error.json');
  if (fs.existsSync(errorFile)) finished.error = readJson(errorFile);
  events.push(finished);
  return events;
}

function readLegacyCall(logPath, references) {
  if (!Array.isArray(references) || !fs.existsSync(logPath)) return null;
  const descriptor = fs.openSync(logPath, 'r');
  try {
    return references.map(reference => {
      const buffer = Buffer.alloc(reference.length);
      fs.readSync(descriptor, buffer, 0, reference.length, reference.offset);
      return JSON.parse(buffer.toString('utf8').trim());
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

function splitBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { metadata: value, body: '' };
  }
  const { body, ...metadata } = value;
  return {
    metadata,
    body: typeof body === 'string' ? body : body == null ? '' : JSON.stringify(body),
  };
}

function callPath(resolved, callId) {
  assertCallId(callId);
  return path.join(resolved.calls, callId);
}

function relativeCallFile(callId, file) {
  return `${CALL_DIRECTORY}/${callId}/${file}`;
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, value, 'utf8');
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeIndex(indexPath, value) {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const temporary = `${indexPath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, indexPath);
}

function validCallId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]+$/.test(value);
}

function assertCallId(value) {
  if (!validCallId(value)) throw new Error('Model call ID is invalid.');
}

function fileSize(file) {
  return fs.existsSync(file) ? fs.statSync(file).size : 0;
}

function sameSourceSizes(left, right) {
  return left?.legacy === right.legacy && left?.events === right.events;
}

function compareDate(left, right) {
  const leftValue = typeof left === 'string' ? Date.parse(left) : 0;
  const rightValue = typeof right === 'string' ? Date.parse(right) : 0;
  return (Number.isNaN(leftValue) ? 0 : leftValue) - (Number.isNaN(rightValue) ? 0 : rightValue);
}

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
