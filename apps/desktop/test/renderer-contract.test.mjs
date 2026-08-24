import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(testDir, '..');

test('preload keeps the workbench operations available for later UI integration', () => {
  const preload = fs.readFileSync(path.join(desktopRoot, 'electron/preload.cjs'), 'utf8');
  for (const operation of [
    'openProject',
    'getState',
    'refresh',
    'getModelStatus',
    'saveDeepSeekApiKey',
    'clearDeepSeekApiKey',
    'testDeepSeekConnection',
    'listModelCalls',
    'readModelCall',
    'startReview',
    'listReviews',
    'getReview',
    'resolveReviewEvidence',
    'appendReviewAnnotation',
    'onReviewChanged',
    'onState',
  ]) {
    assert.match(preload, new RegExp(`\\b${operation}\\s*:`));
  }
});

test('page navigation cannot return before PreviewWorkspace finishes declaring hooks', () => {
  const preview = fs.readFileSync(
    path.join(desktopRoot, 'renderer/react/src/workbench-preview/PreviewApp.tsx'),
    'utf8',
  );
  const lastWorkspaceHook = preview.indexOf('const historySections = React.useMemo');
  const sourcesReturn = preview.indexOf("if (page === 'sources') return");
  const libraryReturn = preview.indexOf("if (page === 'library') return");

  assert.ok(lastWorkspaceHook >= 0);
  assert.ok(sourcesReturn > lastWorkspaceHook);
  assert.ok(libraryReturn > lastWorkspaceHook);
});

test('production renderer is local and retains the declared upstream branding', () => {
  const outputRoot = path.join(desktopRoot, 'dist/renderer');
  const html = fs.readFileSync(path.join(outputRoot, 'index.html'), 'utf8');
  const output = fs.readdirSync(path.join(outputRoot, 'assets'))
    .filter((name) => /\.(?:js|css)$/.test(name))
    .map((name) => fs.readFileSync(path.join(outputRoot, 'assets', name), 'utf8'))
    .join('\n');

  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(output, /esm\.sh|unpkg\.com|cdn\.jsdelivr\.net/i);
  assert.match(`${html}\n${output}`, /HTTP Toolkit|httptoolkit/i);
});

test('copied UI records the fixed upstream source and full license', () => {
  const rendererRoot = path.join(desktopRoot, 'renderer/react');
  const notice = fs.readFileSync(path.join(rendererRoot, 'UPSTREAM.md'), 'utf8');
  const license = fs.readFileSync(
    path.join(rendererRoot, 'LICENSE-AGPL-3.0-or-later.txt'),
    'utf8',
  );
  assert.match(notice, /66488157be993c88152bf0b5964cfa1c63e0fbf5/);
  assert.match(notice, /AGPL-3\.0-or-later/);
  assert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.ok(fs.existsSync(path.join(desktopRoot, 'dist/renderer/UPSTREAM.md')));
  assert.ok(fs.existsSync(path.join(
    desktopRoot,
    'dist/renderer/LICENSE-AGPL-3.0-or-later.txt',
  )));
});

test('upstream visual dependencies stay pinned to the audited versions', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'),
  );
  assert.equal(packageJson.dependencies['styled-components'], '5.0.0');
  assert.equal(packageJson.dependencies['react-split-pane'], '0.1.92');
  assert.equal(packageJson.dependencies['react-window'], '1.8.5');
  assert.equal(packageJson.dependencies['@fontsource/dm-sans'], '5.0.20');
  assert.equal(packageJson.dependencies['@fontsource/dm-mono'], '5.0.19');
  assert.equal(packageJson.dependencies['@fontsource/saira'], '5.0.27');
  assert.equal(packageJson.dependencies['monaco-editor'], '0.27.0');
  assert.equal(packageJson.dependencies['react-monaco-editor'], '0.45.0');
  assert.equal(packageJson.dependencies['@fortawesome/free-brands-svg-icons'], '5.12.1');
});

test('replicated traffic focus and HTTP detail interactions keep their upstream structure', () => {
  const sourceRoot = path.join(desktopRoot, 'renderer/react/src/upstream');
  const eventList = fs.readFileSync(path.join(sourceRoot, 'EventList.tsx'), 'utf8');
  const details = fs.readFileSync(path.join(sourceRoot, 'HttpDetailsPane.tsx'), 'utf8');
  const collapsible = fs.readFileSync(path.join(sourceRoot, 'CollapsibleSection.tsx'), 'utf8');
  const bodyViewer = fs.readFileSync(path.join(sourceRoot, 'CodeViewer.tsx'), 'utf8');

  assert.match(eventList, /:focus \.active/);
  assert.match(eventList, /outline:\s*thin dotted/);
  assert.match(details, /HeaderDetails/);
  assert.match(details, /HeaderDescriptionContainer/);
  assert.match(details, /HeaderDocsLink/);
  assert.match(collapsible, /faPlus/);
  assert.match(collapsible, /display:\s*contents/);
  assert.match(collapsible, /grid-column:\s*1\s*\/\s*-1/);
  assert.match(details, /Response Body/);
  assert.match(bodyViewer, /MonacoEditor/);
  assert.match(bodyViewer, /showFoldingControls:\s*'always'/);
});

test('desktop loads the production build and uses a development URL only when configured', () => {
  const main = fs.readFileSync(path.join(desktopRoot, 'electron/main.mjs'), 'utf8');
  assert.match(main, /dist\/renderer/);
  assert.match(main, /AGENT_WORKBENCH_RENDERER_URL/);
  assert.match(main, /loadFile\(/);
  assert.match(main, /loadURL\(/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
});

test('desktop review storage does not load Electron-incompatible node sqlite bindings', () => {
  const workflow = fs.readFileSync(path.join(desktopRoot, 'electron/review-workflow-service.mjs'), 'utf8');
  const database = fs.readFileSync(path.join(desktopRoot, 'electron/local-review-database.mjs'), 'utf8');

  assert.doesNotMatch(workflow, /@agent-workbench\/local-database/);
  assert.doesNotMatch(database, /(?:from|import)\s*['\"]node:sqlite/);
  assert.match(database, /import\('better-sqlite3'\)/);
});

test('formal desktop entry loads the connected workbench UI', () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(desktopRoot, '../../package.json'), 'utf8'));
  const desktopPackage = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
  const runner = fs.readFileSync(path.join(desktopRoot, 'scripts/run-electron.mjs'), 'utf8');
  const app = fs.readFileSync(path.join(desktopRoot, 'renderer/react/src/App.tsx'), 'utf8');

  assert.equal(rootPackage.scripts.desktop, 'pnpm --filter @agent-workbench/desktop start');
  assert.equal(rootPackage.scripts['desktop:ui-preview'], 'pnpm --filter @agent-workbench/desktop ui-preview');
  assert.match(desktopPackage.scripts['ui-preview'], /--ui-preview/);
  assert.match(runner, /\?mode=workbench-preview/);
  assert.match(runner, /process\.once\('SIGINT'/);
  assert.match(runner, /process\.once\('SIGTERM'/);
  assert.match(runner, /resolveElectronBinary/);
  assert.match(runner, /taskkill/);
  assert.match(runner, /'\/T', '\/F'/);
  assert.match(app, /<PreviewApp page=\{selectedPage\}/);
  assert.match(app, /workbenchMode/);
  assert.doesNotMatch(app, /<ViewPage/);
  assert.match(desktopPackage.scripts.shortcut, /pnpm run build/);
});

test('preview list uses the bottom toolbar, layered operations and child-only interaction', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
  const app = fs.readFileSync(path.join(desktopRoot, 'renderer/react/src/App.tsx'), 'utf8');
  const activity = fs.readFileSync(
    path.join(desktopRoot, 'renderer/react/src/workbench-preview/ActivityList.tsx'),
    'utf8',
  );
  const brandIcon = fs.readFileSync(
    path.join(desktopRoot, 'renderer/react/src/workbench-preview/AgentBrandIcon.tsx'),
    'utf8',
  );

  assert.equal(packageJson.dependencies['@lobehub/icons-static-svg'], '1.90.0');
  assert.match(app, /selectedPage=\{selectedPage\}/);
  assert.match(activity, /\$visible=\{record\.kind !== 'operation' && !\(record\.kind === 'changes' && depth === 0\)\}/);
  assert.match(activity, /\(p\.\$kind === 'operation' \|\| p\.\$kind === 'changes'\) && p\.\$depth === 0/);
  assert.match(activity, /outline:\s*thin dotted \$\{p => p\.theme\.popColor\}/);
  assert.match(activity, /&:hover \$\{Marker\}/);
  assert.match(activity, /&\.selected \$\{Marker\}/);
  assert.match(activity, /inset 0 -1px 0 rgba\(0,0,0,0\.18\)/);
  assert.match(activity, /0 0 15px rgba\(0,0,0,0\.1\)/);
  assert.match(activity, /<SearchFilterBox>/);
  assert.match(activity, /<RequestCounter>/);
  assert.match(activity, /<ButtonsContainer>/);
  assert.match(activity, /const Footer = styled\.div/);
  assert.match(activity, /order:\s*1/);
  assert.match(activity, /z-index:\s*10/);
  assert.ok(activity.indexOf('<Footer>') < activity.indexOf('<Grid role="grid">'));
  assert.doesNotMatch(activity, /background-image:\s*linear-gradient/);
  assert.match(brandIcon, /icons\/codex\.svg/);
  assert.doesNotMatch(brandIcon, /icons\/cursor\.svg/);
});

test('saved task documents render markdown instead of plain preformatted text', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'),
  );
  const library = fs.readFileSync(
    path.join(desktopRoot, 'renderer/react/src/workbench-preview/AssetsPage.tsx'),
    'utf8',
  );
  const markdownDocument = fs.readFileSync(
    path.join(desktopRoot, 'renderer/react/src/workbench-preview/MarkdownDocument.tsx'),
    'utf8',
  );

  assert.equal(packageJson.dependencies['react-markdown'], '9.0.1');
  assert.equal(packageJson.dependencies['remark-gfm'], '4.0.1');
  assert.match(library, /<MarkdownDocument markdown=\{current\.document\.markdown\}/);
  assert.match(markdownDocument, /<ReactMarkdown remarkPlugins=\{\[remarkGfm\]\}/);
});

test('history owns session tracking and synchronization entry points', () => {
  const history = fs.readFileSync(
    path.join(desktopRoot, 'renderer/react/src/workbench-preview/HistoryModal.tsx'),
    'utf8',
  );
  const preview = fs.readFileSync(
    path.join(desktopRoot, 'renderer/react/src/workbench-preview/PreviewApp.tsx'),
    'utf8',
  );

  assert.match(history, /Sessions/);
  assert.match(history, /Sync/);
  assert.match(history, /listSyncTasks/);
  assert.match(history, /Track/);
  assert.match(preview, /<SyncTaskInspector/);
  assert.match(preview, /onHistory=\{/);
  assert.doesNotMatch(
    fs.readFileSync(
      path.join(desktopRoot, 'renderer/react/src/workbench-preview/AssetsPage.tsx'),
      'utf8',
    ),
    /Sync task|Synchronized task/i,
  );
});
