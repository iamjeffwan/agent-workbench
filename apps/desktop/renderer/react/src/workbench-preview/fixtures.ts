import type { PreviewRecord } from './types';

const buildTimelineCall: PreviewRecord = {
  id: 'call-build-timeline',
  kind: 'call',
  method: 'buildTimeline',
  status: 'OK',
  source: 'Function',
  scope: 'packages/timeline',
  target: 'build-timeline.ts',
  color: '#5cb85c',
  functionName: 'buildTimeline',
  file: 'packages/timeline/src/build-timeline.ts',
  startedAt: '10:42:13.082',
  duration: '42 ms',
  arguments: { sessionId: 'codex-7d98', includeProgramCalls: true },
  result: { steps: 18, roots: 4 },
  rawRecord: { type: 'function_call', sequence: 37, parentSequence: 36 },
};

const snapshotFailure: PreviewRecord = {
  id: 'call-save-snapshot',
  kind: 'call',
  method: 'saveSnapshot',
  status: 'ERROR',
  source: 'Function',
  scope: 'packages/project-observe',
  target: 'snapshot-store.ts',
  color: '#e1421f',
  functionName: 'saveSnapshot',
  file: 'packages/project-observe/src/snapshot-store.ts',
  startedAt: '10:42:13.126',
  duration: '18 ms',
  arguments: { projectId: 'agent-workbench', revision: 18 },
  error: 'Snapshot directory was temporarily locked by another process.',
  rawRecord: { type: 'function_error', sequence: 38, parentSequence: 36, recovered: true },
};

const networkEvent = {
  id: 'network-refresh',
  method: 'GET',
  status: '200',
  source: 'Chrome',
  host: 'api.github.com',
  path: '/repos/agent-workbench/events?limit=50',
  color: '#5cb85c',
};

export const previewRecords: PreviewRecord[] = [
  {
    id: 'operation-tests',
    kind: 'operation',
    method: 'SHELL',
    status: 'OK',
    source: 'Codex',
    scope: 'F:\\agent-workbench',
    target: 'pnpm test',
    color: '#6284fa',
    provider: 'Codex',
    startedAt: '10:42:13.041',
    duration: '8.4 s',
    workingDirectory: 'F:\\agent-workbench',
    arguments: { command: 'pnpm test', timeoutMs: 120000 },
    result: '62 tests passed across 7 workspaces.',
    rawRecord: { source: 'codex', conversationId: '019fc509', sequence: 36, status: 'completed' },
    children: [buildTimelineCall, snapshotFailure],
  },
  {
    id: 'network-refresh',
    kind: 'network',
    method: 'GET',
    status: '200',
    source: 'Chrome',
    scope: 'api.github.com',
    target: '/repos/agent-workbench/events?limit=50',
    color: '#5cb85c',
    event: networkEvent,
  },
  {
    id: 'operation-error',
    kind: 'operation',
    method: 'EDIT',
    status: 'ERROR',
    source: 'Cursor',
    scope: 'apps/desktop',
    target: 'Update renderer entry',
    color: '#e1421f',
    provider: 'Cursor',
    startedAt: '10:43:04.817',
    duration: '1.2 s',
    workingDirectory: 'F:\\agent-workbench\\apps\\desktop',
    arguments: { file: 'renderer/react/src/App.tsx', patch: 'Replace selected renderer branch' },
    error: 'The target block changed before the edit was applied.',
    rawRecord: { source: 'cursor', hook: 'afterShellExecution', status: 'error', sequence: 44 },
    children: [],
  },
  {
    id: 'code-changes',
    kind: 'changes',
    method: 'DIFF',
    status: 'OBSERVED',
    source: 'Git',
    scope: 'apps/desktop',
    target: '3 files · +64 −18',
    color: '#f1971f',
    summary: 'Renderer preview adaptation',
    files: [
      {
        path: 'apps/desktop/renderer/react/src/App.tsx',
        change: 'modified',
        language: 'typescript',
        additions: 9,
        deletions: 3,
        before: `import { ViewPage } from './upstream/ViewPage';

export function App() {
  return <ViewPage />;
}`,
        after: `import { ViewPage } from './upstream/ViewPage';
import { PreviewApp } from './workbench-preview/PreviewApp';

export function App() {
  const preview = new URLSearchParams(window.location.search)
    .get('mode') === 'workbench-preview';

  return preview ? <PreviewApp /> : <ViewPage />;
}`,
      },
      {
        path: 'apps/desktop/renderer/react/src/workbench-preview/PreviewApp.tsx',
        change: 'added',
        language: 'typescript',
        additions: 48,
        deletions: 0,
        before: '',
        after: `import * as React from 'react';

export function PreviewApp() {
  const [selectedId, setSelectedId] = React.useState('operation-tests');
  return (
    <main aria-label="Agent Workbench UI preview">
      <ActivityList selectedId={selectedId} onSelected={setSelectedId} />
      <Inspector selectedId={selectedId} />
    </main>
  );
}`,
      },
      {
        path: 'apps/desktop/renderer/react/src/workbench-preview/legacy-panel.tsx',
        change: 'deleted',
        language: 'typescript',
        additions: 0,
        deletions: 15,
        before: `export function LegacyPanel() {
  return (
    <section>
      <h1>Activity</h1>
      <p>Select an event to inspect it.</p>
    </section>
  );
}`,
        after: '',
      },
    ],
    projectFiles: [
      { path: 'apps/desktop/package.json', language: 'json', source: '{\n  "name": "@agent-workbench/desktop",\n  "private": true\n}' },
      { path: 'apps/desktop/renderer/react/src/App.tsx', language: 'typescript', change: 'modified', source: '// Current App source is represented by the selected diff.' },
      { path: 'apps/desktop/renderer/react/src/main.tsx', language: 'typescript', source: `import ReactDOM from 'react-dom/client';\nimport { App } from './App';\n\nReactDOM.createRoot(document.getElementById('root')!).render(<App />);` },
      { path: 'apps/desktop/renderer/react/src/upstream/theme.ts', language: 'typescript', source: `export const lightTheme = {\n  mainBackground: '#fafafa',\n  mainColor: '#1e2028',\n  popColor: '#e1421f',\n};` },
      { path: 'apps/desktop/renderer/react/src/workbench-preview/PreviewApp.tsx', language: 'typescript', change: 'added', source: '// New preview application shown in the diff.' },
      { path: 'apps/desktop/renderer/react/src/workbench-preview/legacy-panel.tsx', language: 'typescript', change: 'deleted', source: '// Deleted in this preview revision.' },
      { path: 'apps/desktop/test/renderer-contract.test.mjs', language: 'javascript', source: `import test from 'node:test';\n\ntest('renderer contract', () => {\n  // Production entry remains local.\n});` },
      { path: 'README.md', language: 'markdown', source: '# Agent Workbench\n\nA local observation workbench for coding agents and program internals.' },
    ],
    rawRecord: {
      source: 'git-snapshot',
      attribution: 'unassigned',
      observationWindow: {
        conversationId: 'preview-conversation',
        generationId: 'preview-cursor-turn',
      },
    },
    detailMode: 'files',
  },
];
