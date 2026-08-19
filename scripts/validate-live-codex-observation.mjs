#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  adaptCodexSession,
  findCodexSessions,
  readCodexProjectTimelineEvents,
  readCodexSessionMetadata,
} from '@agent-workbench/codex-adapter';
import {
  captureProjectState,
  deriveProjectTurnFacts,
} from '@agent-workbench/project-observation';
import { createProjectObservationService } from '../apps/desktop/electron/project-observation-service.mjs';
import {
  compareResults,
  samePath,
} from '../apps/desktop/electron/live-codex-observation-comparison.mjs';
import { fileURLToPath } from 'node:url';

if (isMainModule()) {
  if (process.argv[2] === '--recheck') {
    const previousReport = JSON.parse(fs.readFileSync(path.resolve(process.argv[3]), 'utf8'));
    const sessionFile = typeof previousReport.sessionFile === 'string'
      ? path.resolve(previousReport.sessionFile)
      : null;

    if (!sessionFile || !fs.existsSync(sessionFile)) {
      const comparison = compareResults({
        sessionFile,
        projectRoot: previousReport.projectRoot,
        legacyEvents: [],
        canonicalSession: null,
        legacyTurn: previousReport.legacyTurn,
        canonicalTurn: previousReport.canonicalTurn,
      });
      console.log(JSON.stringify(comparison, null, 2));
      process.exitCode = 1;
    } else {
      const canonicalSession = adaptCodexSession(sessionFile, {
        projectId: `live-validation:${path.basename(previousReport.runRoot)}`,
      });
      const legacyEvents = readCodexProjectTimelineEvents({
        projectRoot: previousReport.projectRoot,
        sessionFiles: [sessionFile],
      });
      const comparison = compareResults({
        sessionFile,
        projectRoot: previousReport.projectRoot,
        legacyEvents,
        canonicalSession,
        legacyTurn: previousReport.legacyTurn,
        canonicalTurn: previousReport.canonicalTurn,
      });
      console.log(JSON.stringify(comparison, null, 2));
      process.exitCode = comparison.passed ? 0 : 1;
    }
  } else {
    await runLiveValidation();
  }
}

function isMainModule() {
  return process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

async function runLiveValidation() {
const workspaceRoot = path.resolve(import.meta.dirname, '..');
const runRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(
      workspaceRoot,
      'tmp',
      `codex-live-validation-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`,
    );
const projectRoot = path.join(runRoot, 'project');
const legacyUserDataPath = path.join(runRoot, 'user-data-legacy');
const canonicalUserDataPath = path.join(runRoot, 'user-data-canonical');
const reportFile = path.join(runRoot, 'result.json');
fs.mkdirSync(projectRoot, { recursive: true });
fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Live Codex observation validation\n', 'utf8');
git(projectRoot, ['init']);
git(projectRoot, ['config', 'user.email', 'validation@agent-workbench.local']);
git(projectRoot, ['config', 'user.name', 'Agent Workbench Validation']);
git(projectRoot, ['add', '.']);
git(projectRoot, ['commit', '-m', 'Initial validation fixture']);

const existingSessions = new Set(findCodexSessions().map(file => path.resolve(file)));
const legacyObservation = createProjectObservationService({
  getUserDataPath: () => legacyUserDataPath,
  captureState: captureProjectState,
  deriveFacts: deriveProjectTurnFacts,
});
const canonicalObservation = createProjectObservationService({
  getUserDataPath: () => canonicalUserDataPath,
  captureState: captureProjectState,
  deriveFacts: deriveProjectTurnFacts,
});
let observedSessionFile = null;
let lastLegacyObservation = null;
let lastCanonicalObservation = null;
let lastLegacyEvents = [];
let lastCanonicalSession = null;
let polling = false;

console.log(`LIVE_VALIDATION_READY=${projectRoot}`);
const deadline = Date.now() + 600_000;
while (Date.now() < deadline) {
  await poll();
  const legacyFinished = lastLegacyObservation?.data?.completed > 0 || lastLegacyObservation?.data?.unavailable > 0;
  const canonicalFinished = lastCanonicalObservation?.data?.completed > 0 || lastCanonicalObservation?.data?.unavailable > 0;
  if (legacyFinished && canonicalFinished) break;
  await delay(40);
}

const legacyStore = legacyObservation.read(projectRoot);
const canonicalStore = canonicalObservation.read(projectRoot);
const legacyTurns = legacyStore.status === 'ready' ? Object.values(legacyStore.data.turns) : [];
const canonicalTurns = canonicalStore.status === 'ready' ? Object.values(canonicalStore.data.turns) : [];
const legacyTurn = legacyTurns.at(-1) ?? null;
const canonicalTurn = canonicalTurns.at(-1) ?? null;
const comparison = compareResults({
  sessionFile: observedSessionFile,
  projectRoot,
  legacyEvents: lastLegacyEvents,
  canonicalSession: lastCanonicalSession,
  legacyTurn,
  canonicalTurn,
});
const exitCode = legacyTurn?.status === 'completed'
  && canonicalTurn?.status === 'completed'
  && comparison.passed
  ? 0
  : 1;
const report = {
  runRoot,
  projectRoot,
  exitCode,
  createdFile: fs.existsSync(path.join(projectRoot, 'codex-created.txt'))
    ? fs.readFileSync(path.join(projectRoot, 'codex-created.txt'), 'utf8')
    : null,
  sessionFile: observedSessionFile,
  legacyObservation: lastLegacyObservation,
  canonicalObservation: lastCanonicalObservation,
  legacyTurn,
  canonicalTurn,
  comparison,
};
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`\nLIVE_VALIDATION_REPORT=${reportFile}`);
console.log(JSON.stringify({
  exitCode,
  createdFile: report.createdFile,
  sessionFile: observedSessionFile,
  legacyStatus: legacyTurn?.status ?? null,
  canonicalStatus: canonicalTurn?.status ?? null,
  comparisonPassed: comparison.passed,
  checks: comparison.checks,
  semanticCounts: comparison.semanticCounts,
  diagnostics: comparison.canonical.diagnostics,
  filesChanged: canonicalTurn?.facts?.turnDiff?.filesChanged ?? [],
  environmentChanges: canonicalTurn?.facts?.environmentDelta?.changes ?? [],
}, null, 2));

if (exitCode !== 0) process.exitCode = 1;

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const newSessions = findCodexSessions()
      .map(file => path.resolve(file))
      .filter(file => !existingSessions.has(file));
    const matching = newSessions.find(file => {
      const metadata = readCodexSessionMetadata(file);
      return metadata?.cwd && samePath(metadata.cwd, projectRoot);
    });
    if (matching) observedSessionFile = matching;
    if (!observedSessionFile) return;
    lastLegacyEvents = readCodexProjectTimelineEvents({
      projectRoot,
      sessionFiles: [observedSessionFile],
    });
    lastCanonicalSession = adaptCodexSession(observedSessionFile, {
      projectId: `live-validation:${path.basename(runRoot)}`,
    });
    if (lastLegacyEvents.length > 0) {
      lastLegacyObservation = legacyObservation.observe(projectRoot, lastLegacyEvents);
    }
    if (lastCanonicalSession.turns.length > 0) {
      lastCanonicalObservation = canonicalObservation.observeSession(projectRoot, lastCanonicalSession);
    }
  } finally {
    polling = false;
  }
}
}

function git(projectRoot, args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
