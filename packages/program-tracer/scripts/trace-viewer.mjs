#!/usr/bin/env node
/**
 * Local verification page: Codex agent tool steps + program trace records.
 *
 * Usage:
 *   node scripts/trace-viewer.mjs
 *   node scripts/trace-viewer.mjs --records path --manifest path --agent path --port 4177
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { redactCredentialText } from '../../agent-workbench-security/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const defaultDir = path.join(repoRoot, '.agent-workbench');
const workerDir = path.join(repoRoot, 'apps/worker/.agent-workbench');

function parseArgs(argv) {
  const args = argv.slice(2);
  let recordsPath;
  let manifestPath;
  let agentPath;
  let port = 4177;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--port' || arg === '-p') {
      port = Number(args[++i]);
      continue;
    }
    if (arg === '--manifest' || arg === '-m') {
      manifestPath = args[++i];
      continue;
    }
    if (arg === '--records' || arg === '-r') {
      recordsPath = args[++i];
      continue;
    }
    if (arg === '--agent' || arg === '-a') {
      agentPath = args[++i];
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  node scripts/trace-viewer.mjs [--records path] [--manifest path] [--agent path] [--port 4177]
`);
      process.exit(0);
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  return {
    recordsPath: recordsPath ? path.resolve(recordsPath) : null,
    manifestPath: manifestPath ? path.resolve(manifestPath) : null,
    agentPath: agentPath ? path.resolve(agentPath) : null,
    port,
  };
}

function resolvePaths(overrides) {
  return {
    recordsPath: path.resolve(
      overrides.recordsPath ||
        process.env.AGENT_WORKBENCH_TRACE_OUT ||
        newestExisting(
          path.join(defaultDir, 'trace-records.jsonl'),
          path.join(workerDir, 'trace-records.jsonl'),
        ),
    ),
    manifestPath: path.resolve(
      overrides.manifestPath ||
        process.env.AGENT_WORKBENCH_TRACE_MANIFEST ||
        newestExisting(
          path.join(defaultDir, 'trace-manifest.json'),
          path.join(workerDir, 'trace-manifest.json'),
        ),
    ),
    agentPath: path.resolve(
      overrides.agentPath ||
        process.env.AGENT_WORKBENCH_AGENT_STEPS ||
        newestExisting(
          path.join(defaultDir, 'agent-steps.jsonl'),
          path.join(workerDir, 'agent-steps.jsonl'),
        ),
    ),
  };
}

function newestExisting(...paths) {
  let best = paths[0];
  let bestTime = -1;
  for (const candidate of paths) {
    try {
      const time = fs.statSync(candidate).mtimeMs;
      if (time >= bestTime) {
        best = candidate;
        bestTime = time;
      }
    } catch {
      // missing
    }
  }
  return best;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!text) {
    return [];
  }
  return text
    .split(/\n+/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        return { parseError: true, raw: line.slice(0, 200), index };
      }
    });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function buildMethodMap(manifest) {
  const map = {};
  for (const method of manifest?.methods ?? []) {
    map[method.id] = {
      id: method.id,
      label: `${method.className}.${method.methodName}`,
      className: method.className,
      methodName: method.methodName,
      sourceFile: method.sourceFile,
      compiledFile: method.compiledFile,
    };
  }
  return map;
}

/** Low-signal explore tools: collapsed by default in the verify viewer. */
const EXPLORATION_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'SemanticSearch',
  'WebSearch',
  'WebFetch',
  'rg',
]);

const PRIMARY_TOOLS = new Set([
  'Shell',
  'Write',
  'Delete',
  'EditNotebook',
  'Task',
  'AwaitShell',
  'StrReplace',
]);

function isExplorationTool(name) {
  if (!name) return false;
  if (PRIMARY_TOOLS.has(name)) return false;
  if (EXPLORATION_TOOLS.has(name)) return true;
  // Default unknown tools to exploration unless they launch processes.
  return true;
}

function buildTimeline(agentSteps, programRecords, methods) {
  const programByOrigin = new Map();
  for (const record of programRecords) {
    if (record.parseError) {
      continue;
    }
    const origin = record.processOriginId || '';
    const list = programByOrigin.get(origin) ?? [];
    list.push(record);
    programByOrigin.set(origin, list);
  }

  const usedOrigins = new Set();
  const stepsByTurn = new Map();

  for (const step of agentSteps) {
    if (!step?.id) continue;
    const turnKey = step.generationId || step.conversationId || 'ungrouped';
    const list = stepsByTurn.get(turnKey) ?? [];
    list.push(step);
    stepsByTurn.set(turnKey, list);
  }

  const turns = [];
  let turnIndex = 0;
  for (const [turnKey, steps] of stepsByTurn.entries()) {
    turnIndex += 1;
    const explore = [];
    const primary = [];

    for (const step of steps) {
      usedOrigins.add(step.id);
      const programChildren = buildProgramTree(
        programByOrigin.get(step.id) ?? [],
        methods,
        step.id,
      );
      const item = {
        type: 'agent_tool',
        id: step.id,
        parentId: null,
        name: step.name,
        status: step.status,
        startedAt: step.startedAt,
        endedAt: step.endedAt,
        arguments: step.arguments,
        output: step.output,
        provider: step.provider || null,
        source: step.source || null,
        launchesProcess: !!step.launchesProcess,
        generationId: step.generationId || null,
        children: programChildren,
      };

      if (step.launchesProcess || PRIMARY_TOOLS.has(step.name) || !isExplorationTool(step.name)) {
        primary.push(item);
      } else {
        explore.push(item);
      }
    }

    const children = [];
    if (explore.length > 0) {
      const counts = {};
      for (const item of explore) {
        counts[item.name] = (counts[item.name] || 0) + 1;
      }
      children.push({
        type: 'explore_group',
        id: `explore:${turnKey}`,
        parentId: `turn:${turnKey}`,
        name: `文件探查 × ${explore.length}`,
        status: 'completed',
        summary: counts,
        children: explore,
      });
    }
    children.push(...primary);

    turns.push({
      type: 'turn',
      id: `turn:${turnKey}`,
      parentId: null,
      name: turnKey === 'ungrouped' ? '未分组活动' : `执行轮次 ${turnIndex}`,
      generationId: turnKey === 'ungrouped' ? null : turnKey,
      status: 'completed',
      children,
    });
  }

  for (const [origin, records] of programByOrigin.entries()) {
    if (usedOrigins.has(origin)) continue;
    turns.push({
      type: 'program_group',
      id: `origin:${origin || 'empty'}`,
      parentId: null,
      name: origin ? `未关联程序活动 (${origin})` : '未关联程序活动',
      status: 'completed',
      children: buildProgramTree(records, methods, origin || null),
    });
  }

  return turns;
}

function buildProgramTree(records, methods, originParentId) {
  const items = records.map((record) =>
    toProgramItem(record, methods, originParentId),
  );
  const byCallId = new Map(items.map((item) => [item.callId, item]));
  for (const item of items) {
    item.children = [];
  }

  const roots = [];
  for (const record of records) {
    const item = byCallId.get(record.callId);
    if (!item) continue;
    const parent =
      record.parentCallId == null ? null : byCallId.get(record.parentCallId);
    if (parent) {
      item.parentId = parent.id;
      parent.children.push(item);
    } else {
      item.parentId = originParentId;
      roots.push(item);
    }
  }
  return roots;
}

function toProgramItem(record, methods, parentId) {
  const method = methods[record.methodId];
  return {
    type: 'program_call',
    id: `call:${record.callId}`,
    parentId,
    callId: record.callId,
    methodId: record.methodId,
    name: method?.label ?? `method#${record.methodId}`,
    durationMs: record.durationMs,
    processOriginId: record.processOriginId,
    activityId: record.activityId,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    args: record.args,
    result: record.result,
    error: record.error,
    incomplete: record.incomplete,
    snapshotDegraded: record.snapshotDegraded,
    sourceFile: method?.sourceFile,
    children: [],
  };
}

function mtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(html);
}

function pageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>工作台验证页</title>
  <style>
    :root {
      --bg: #f3f1ec;
      --panel: #fffdf8;
      --ink: #1f1c17;
      --muted: #6d665c;
      --line: #d9d2c5;
      --accent: #0f6a5b;
      --accent-soft: #d8efe9;
      --agent: #2c4f7c;
      --agent-soft: #d9e6f5;
      --warn: #8a4b12;
      --error: #8f2d2d;
      --shadow: 0 10px 30px rgba(40, 32, 20, 0.08);
      --mono: "IBM Plex Mono", "Cascadia Mono", Consolas, monospace;
      --sans: "Iowan Old Style", "Palatino Linotype", "Songti SC", Georgia, serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      min-height: 100vh;
      background:
        radial-gradient(1200px 500px at 10% -10%, #efe7d8 0%, transparent 55%),
        linear-gradient(180deg, #f7f4ee 0%, var(--bg) 100%);
      font-family: var(--sans);
    }
    header {
      display: flex; justify-content: space-between; gap: 1rem; align-items: end;
      padding: 1.25rem 1.5rem 1rem; border-bottom: 1px solid var(--line);
    }
    h1 { margin: 0; font-size: 1.35rem; }
    header p { margin: 0.35rem 0 0; color: var(--muted); font-size: 0.92rem; }
    .controls { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
    button, label.toggle {
      border: 1px solid var(--line); background: var(--panel); color: var(--ink);
      border-radius: 999px; padding: 0.45rem 0.9rem; font: inherit; font-size: 0.9rem; cursor: pointer;
    }
    button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    label.toggle { display: inline-flex; gap: 0.4rem; align-items: center; }
    main { display: grid; grid-template-columns: minmax(300px, 400px) 1fr; min-height: calc(100vh - 90px); }
    .list, .detail { padding: 1rem 1.25rem 2rem; }
    .list { border-right: 1px solid var(--line); background: rgba(255,253,248,0.72); }
    .meta { font-family: var(--mono); font-size: 0.72rem; color: var(--muted); margin-bottom: 0.85rem; white-space: pre-wrap; word-break: break-all; }
    .empty { color: var(--muted); line-height: 1.6; padding: 0.5rem 0; }
    .item {
      width: 100%; text-align: left; border: 1px solid transparent; background: transparent;
      border-radius: 14px; padding: 0.7rem 0.8rem; margin: 0 0 0.35rem; cursor: pointer; font: inherit;
    }
    .item:hover { background: rgba(255,255,255,0.7); border-color: var(--line); }
    .item.active { background: var(--panel); border-color: #c9c0b1; box-shadow: var(--shadow); }
    .item.child { margin-left: 1rem; width: calc(100% - 1rem); }
    .item.child2 { margin-left: 2rem; width: calc(100% - 2rem); }
    .item.child3 { margin-left: 3rem; width: calc(100% - 3rem); }
    .turn-title {
      margin: 1rem 0 0.45rem;
      font-size: 0.82rem;
      letter-spacing: 0.04em;
      color: var(--muted);
      font-family: var(--mono);
    }
    .name { font-weight: 700; font-size: 0.95rem; }
    .sub { margin-top: 0.25rem; color: var(--muted); font-family: var(--mono); font-size: 0.75rem; display: flex; gap: 0.55rem; flex-wrap: wrap; }
    .badge { display: inline-block; padding: 0.1rem 0.45rem; border-radius: 999px; font-size: 0.72rem; font-family: var(--mono); background: var(--accent-soft); color: var(--accent); }
    .badge.agent { background: var(--agent-soft); color: var(--agent); }
    .badge.warn { background: #f3e2cb; color: var(--warn); }
    .badge.error { background: #f3d7d7; color: var(--error); }
    .detail-card { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; box-shadow: var(--shadow); padding: 1.1rem 1.2rem 1.3rem; }
    .detail-card h2 { margin: 0 0 0.35rem; font-size: 1.15rem; }
    .kv { display: grid; grid-template-columns: 7.5rem 1fr; gap: 0.35rem 0.75rem; margin: 0.9rem 0 1.1rem; font-size: 0.92rem; }
    .kv dt { color: var(--muted); } .kv dd { margin: 0; font-family: var(--mono); word-break: break-word; }
    pre { margin: 0; padding: 0.85rem 0.95rem; background: #1f1c17; color: #f4efe6; border-radius: 12px; overflow: auto; font-family: var(--mono); font-size: 0.8rem; line-height: 1.45; max-height: 36vh; }
    .block-title { margin: 1rem 0 0.4rem; font-size: 0.85rem; color: var(--muted); }
    @media (max-width: 900px) { main { grid-template-columns: 1fr; } .list { border-right: 0; border-bottom: 1px solid var(--line); } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>工作台验证页</h1>
      <p>按执行轮次聚合；探查工具默认折叠；Shell 下挂程序调用。</p>
    </div>
    <div class="controls">
      <label class="toggle"><input id="expandExplore" type="checkbox" /> 展开探查</label>
      <label class="toggle"><input id="autoRefresh" type="checkbox" checked /> 自动刷新</label>
      <button id="refreshBtn" class="primary" type="button">刷新</button>
    </div>
  </header>
  <main>
    <section class="list">
      <div id="paths" class="meta"></div>
      <div id="list"></div>
    </section>
    <section class="detail">
      <div id="detail"><div class="empty">选择左侧一条记录查看详情。</div></div>
    </section>
  </main>
  <script>
    let state = { timeline: [], selectedId: null, flat: {} };

    const listEl = document.getElementById('list');
    const detailEl = document.getElementById('detail');
    const pathsEl = document.getElementById('paths');
    const autoRefreshEl = document.getElementById('autoRefresh');
    const expandExploreEl = document.getElementById('expandExplore');

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    }

    function stringify(value) {
      if (value === undefined) return 'undefined';
      try { return JSON.stringify(value, null, 2); }
      catch { return String(value); }
    }

    function walk(items, visit) {
      for (const item of items || []) {
        visit(item);
        walk(item.children || [], visit);
      }
    }

    function flatten(timeline) {
      const map = {};
      walk(timeline, (item) => { map[item.id] = item; });
      return map;
    }

    function depthClass(depth) {
      if (depth <= 0) return '';
      if (depth === 1) return ' child';
      if (depth === 2) return ' child2';
      return ' child3';
    }

    function renderList() {
      if (!state.timeline.length) {
        listEl.innerHTML = '<div class="empty">还没有记录。可先 seed:mock，或跑 hooks / dogfood。</div>';
        return;
      }

      const parts = [];
      for (const turn of state.timeline) {
        if (turn.type === 'turn') {
          parts.push(\`<div class="turn-title">\${escapeHtml(turn.name)}</div>\`);
          for (const child of turn.children || []) {
            appendItem(parts, child, 0);
          }
        } else {
          appendItem(parts, turn, 0);
        }
      }
      listEl.innerHTML = parts.join('');
      for (const button of listEl.querySelectorAll('[data-id]')) {
        button.addEventListener('click', () => {
          state.selectedId = button.getAttribute('data-id');
          renderList();
          renderDetail();
        });
      }
    }

    function appendItem(parts, item, depth) {
      parts.push(rowHtml(item, depth));
      const showChildren =
        item.type !== 'explore_group' || expandExploreEl.checked;
      if (showChildren) {
        for (const child of item.children || []) {
          appendItem(parts, child, depth + 1);
        }
      }
    }

    function rowHtml(item, depth) {
      const active = item.id === state.selectedId ? ' active' : '';
      const provider = item.provider
        ? \`<span class="badge agent">\${escapeHtml(item.provider)}</span>\`
        : '';
      let kind = '<span class="badge">步骤</span>';
      if (item.type === 'agent_tool') kind = '<span class="badge agent">代理工具</span>' + provider;
      if (item.type === 'explore_group') kind = '<span class="badge warn">探查</span>';
      if (item.type === 'program_call') kind = '<span class="badge">程序</span>';
      if (item.type === 'program_group') kind = '<span class="badge warn">未关联</span>';
      if (item.type === 'turn') kind = '<span class="badge agent">轮次</span>';

      let extra = item.status || '';
      if (item.type === 'program_call') extra = (item.durationMs ?? '-') + ' ms';
      if (item.type === 'explore_group') {
        const bits = Object.entries(item.summary || {}).map(([k, v]) => k + '×' + v);
        extra = bits.join(' ') || (item.children?.length + ' 项');
        if (!expandExploreEl.checked) extra += ' · 已折叠';
      } else if (item.children?.length) {
        extra = (extra ? extra + ' · ' : '') + item.children.length + ' 子步骤';
      }

      return \`
        <button class="item\${depthClass(depth)}\${active}" type="button" data-id="\${escapeHtml(item.id)}">
          <div class="name">\${escapeHtml(item.name)}</div>
          <div class="sub">\${kind}<span>\${escapeHtml(String(extra))}</span></div>
        </button>
      \`;
    }

    function renderDetail() {
      const item = state.flat[state.selectedId];
      if (!item) {
        detailEl.innerHTML = '<div class="empty">选择左侧一条记录查看详情。</div>';
        return;
      }

      if (item.type === 'explore_group') {
        detailEl.innerHTML = \`
          <div class="detail-card">
            <h2>\${escapeHtml(item.name)}</h2>
            <div><span class="badge warn">探查工具组</span></div>
            <p class="empty">Read / Grep / Glob 等默认折叠，勾选「展开探查」可在左侧逐条查看。</p>
            <div class="block-title">组成</div>
            <pre>\${escapeHtml(stringify(item.summary))}</pre>
          </div>
        \`;
        return;
      }

      if (item.type === 'turn') {
        detailEl.innerHTML = \`
          <div class="detail-card">
            <h2>\${escapeHtml(item.name)}</h2>
            <dl class="kv">
              <dt>generation</dt><dd>\${escapeHtml(item.generationId || '-')}</dd>
              <dt>子步骤</dt><dd>\${(item.children || []).length}</dd>
            </dl>
          </div>
        \`;
        return;
      }

      if (item.type === 'agent_tool') {
        detailEl.innerHTML = \`
          <div class="detail-card">
            <h2>\${escapeHtml(item.name)}</h2>
            <div>
              <span class="badge agent">代理工具步骤</span>
              \${item.provider ? ' <span class="badge agent">' + escapeHtml(item.provider) + '</span>' : ''}
            </div>
            <dl class="kv">
              <dt>工具编号</dt><dd>\${escapeHtml(item.id)}</dd>
              <dt>来源</dt><dd>\${escapeHtml(item.provider || '-')}</dd>
              <dt>状态</dt><dd>\${escapeHtml(item.status || '-')}</dd>
              <dt>开始</dt><dd>\${escapeHtml(item.startedAt || '-')}</dd>
              <dt>结束</dt><dd>\${escapeHtml(item.endedAt || '-')}</dd>
              <dt>子步骤</dt><dd>\${(item.children || []).length}</dd>
            </dl>
            <div class="block-title">参数</div>
            <pre>\${escapeHtml(stringify(item.arguments))}</pre>
            <div class="block-title">输出</div>
            <pre>\${escapeHtml(stringify(item.output))}</pre>
          </div>
        \`;
        return;
      }

      if (item.type === 'program_group') {
        detailEl.innerHTML = \`
          <div class="detail-card">
            <h2>\${escapeHtml(item.name)}</h2>
            <p class="empty">这些程序记录的进程来源编号，没有对上已知的代理工具编号。</p>
          </div>
        \`;
        return;
      }

      detailEl.innerHTML = \`
        <div class="detail-card">
          <h2>\${escapeHtml(item.name)}</h2>
          <div>
            <span class="badge">程序调用</span>
            \${item.error ? ' <span class="badge error">抛错</span>' : ''}
            \${item.snapshotDegraded ? ' <span class="badge warn">快照已降级</span>' : ''}
          </div>
          <dl class="kv">
            <dt>调用编号</dt><dd>\${item.callId}</dd>
            <dt>方法编号</dt><dd>\${item.methodId}</dd>
            <dt>父调用</dt><dd>\${escapeHtml(item.parentId || '无')}</dd>
            <dt>进程来源</dt><dd>\${escapeHtml(item.processOriginId || '(空)')}</dd>
            <dt>当前活动</dt><dd>\${escapeHtml(item.activityId || '(空)')}</dd>
            <dt>耗时</dt><dd>\${item.durationMs ?? '-'} ms</dd>
            <dt>源文件</dt><dd>\${escapeHtml(item.sourceFile || '-')}</dd>
          </dl>
          <div class="block-title">参数</div>
          <pre>\${escapeHtml(stringify(item.args))}</pre>
          <div class="block-title">\${item.error ? '错误' : '返回值'}</div>
          <pre>\${escapeHtml(stringify(item.error || item.result))}</pre>
        </div>
      \`;
    }

    async function loadTrace() {
      const response = await fetch('/api/timeline', { cache: 'no-store' });
      if (!response.ok) throw new Error('加载失败: ' + response.status);
      const data = await response.json();
      const previous = state.selectedId;
      state.timeline = data.timeline || [];
      state.flat = flatten(state.timeline);
      pathsEl.textContent =
        'agent: ' + data.paths.agent + '\\n' +
        'records: ' + data.paths.records + '\\n' +
        'manifest: ' + data.paths.manifest + '\\n' +
        'tools: ' + data.stats.agentTools + ' · program: ' + data.stats.programCalls +
        ' · turns: ' + state.timeline.filter((x) => x.type === 'turn').length;

      if (previous && state.flat[previous]) {
        state.selectedId = previous;
      } else {
        const firstShell = Object.values(state.flat).find((x) => x.type === 'agent_tool' && x.name === 'Shell');
        state.selectedId = firstShell?.id || state.timeline[0]?.id || null;
      }
      renderList();
      renderDetail();
    }

    document.getElementById('refreshBtn').addEventListener('click', () => {
      loadTrace().catch((error) => {
        detailEl.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
      });
    });
    expandExploreEl.addEventListener('change', () => {
      renderList();
      renderDetail();
    });

    setInterval(() => {
      if (autoRefreshEl.checked) loadTrace().catch(() => {});
    }, 1500);

    loadTrace().catch((error) => {
      detailEl.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
    });
  </script>
</body>
</html>`;
}

function main() {
  const overrides = parseArgs(process.argv);
  const { port } = overrides;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

    if (url.pathname === '/api/timeline' || url.pathname === '/api/trace') {
      const { recordsPath, manifestPath, agentPath } = resolvePaths(overrides);
      const manifest = readJson(manifestPath);
      const methods = buildMethodMap(manifest);
      const programRecords = readJsonl(recordsPath);
      const agentSteps = readJsonl(agentPath).filter((step) => step?.kind === 'agent_tool' || step?.id);
      const timeline = buildTimeline(agentSteps, programRecords, methods);
      sendJson(res, 200, {
        timeline,
        methods,
        paths: { records: recordsPath, manifest: manifestPath, agent: agentPath },
        stats: {
          agentTools: agentSteps.length,
          programCalls: programRecords.filter((r) => !r.parseError).length,
        },
        updatedAt: Math.max(mtime(recordsPath) ?? 0, mtime(agentPath) ?? 0) || null,
      });
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      sendHtml(res, pageHtml());
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });

  server.listen(port, '127.0.0.1', () => {
    const initial = resolvePaths(overrides);
    console.log(`Workbench verify viewer: http://127.0.0.1:${port}`);
    console.log(redactCredentialText(`agent:    ${initial.agentPath}`));
    console.log(redactCredentialText(`records:  ${initial.recordsPath}`));
    console.log(redactCredentialText(`manifest: ${initial.manifestPath}`));
  });
}

try {
  main();
} catch (error) {
  console.error(
    redactCredentialText(error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
}
