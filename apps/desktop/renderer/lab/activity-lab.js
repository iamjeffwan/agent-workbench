import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

const { createElement: h, Fragment } = React;

const PREVIEW_TURNS = [
  {
    id: 'turn:1',
    name: '执行轮次 1',
    provider: 'codex',
    children: [
      {
        id: 'explore:1',
        type: 'explore_group',
        name: '文件探查 × 2',
        status: 'completed',
        source: 'codex',
        children: [
          {
            id: 'read-1',
            type: 'agent_tool',
            name: 'Read · apps/desktop/renderer/app.js',
            source: 'codex',
            status: 'completed',
            durationMs: 84,
            arguments: { path: 'apps/desktop/renderer/app.js' },
          },
          {
            id: 'grep-1',
            type: 'agent_tool',
            name: 'Grep · renderDetail',
            source: 'codex',
            status: 'completed',
            durationMs: 121,
            arguments: { pattern: 'renderDetail' },
          },
        ],
      },
      {
        id: 'write-1',
        type: 'agent_tool',
        name: 'Write · 重构桌面端执行记录视图',
        source: 'codex',
        status: 'completed',
        durationMs: 438,
        arguments: { file: 'apps/desktop/renderer/styles.css', change: 'desktop redesign' },
        output: { changed: true, lines: 742 },
      },
      {
        id: 'shell-1',
        type: 'agent_tool',
        name: 'Shell · pnpm test',
        source: 'cursor',
        status: 'completed',
        durationMs: 4867,
        arguments: { command: 'pnpm test' },
        output: { suites: 7, passed: 52, failed: 0 },
        children: [
          {
            id: 'call-1',
            type: 'program_call',
            name: 'Timeline.build',
            status: 'completed',
            durationMs: 36,
            args: { turns: 2 },
            result: { nodes: 16 },
            sourceFile: 'packages/timeline/src/build-timeline.ts',
          },
        ],
      },
    ],
  },
  {
    id: 'turn:2',
    name: '执行轮次 2',
    provider: 'cursor',
    children: [
      {
        id: 'shell-2',
        type: 'agent_tool',
        name: 'Shell · 启动桌面预览',
        source: 'cursor',
        status: 'running',
        durationMs: 1732,
        arguments: { command: 'pnpm desktop:dev' },
      },
      {
        id: 'call-2',
        type: 'program_call',
        name: 'ProjectWatcher.refresh',
        status: 'completed',
        durationMs: 18,
        args: { project: 'agent-workbench-demo' },
        result: { updated: true },
        sourceFile: 'packages/codex-adapter/src/project-sessions.ts',
      },
    ],
  },
];

function nodeSource(node) {
  if (node.type === 'program_call' || node.type === 'program_group') return 'program';
  return String(node.source || node.provider || 'program').toLowerCase();
}

function sourceLabel(source) {
  return { codex: 'Codex', cursor: 'Cursor', program: '程序' }[source] || source;
}

function statusLabel(status) {
  return (
    {
      completed: '完成',
      running: '进行中',
      error: '错误',
      failed: '失败',
    }[status] || status || '未知'
  );
}

function typeLabel(type) {
  return (
    {
      agent_tool: '代理工具',
      program_call: '程序方法',
      explore_group: '探查组',
    }[type] || type || '活动'
  );
}

function formatDuration(value) {
  if (typeof value !== 'number') return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function stringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ActivityRow({ node, depth, rowKey, selected, collapsed, onSelect, onToggleGroup }) {
  const source = nodeSource(node);
  const status = String(node.status || 'completed').toLowerCase();
  const isGroup = node.type === 'explore_group';

  return h(
    'button',
    {
      type: 'button',
      role: 'row',
      className: `activity-row source-${source} status-${status}${selected ? ' selected' : ''}`,
      onClick: () => {
        if (isGroup) onToggleGroup(rowKey);
        else onSelect(node, rowKey);
      },
    },
    h('span', { className: 'cell marker-cell' }, h('span', { className: 'row-marker' })),
    h('span', { className: `cell source-${source}` }, sourceLabel(source)),
    h('span', { className: 'cell status-text' }, statusLabel(status)),
    h('span', { className: 'cell type-cell' }, typeLabel(node.type)),
    h(
      'span',
      { className: 'cell name-cell' },
      h('span', { className: 'indent', style: { width: depth * 16 } }),
      isGroup ? h('span', { className: 'chevron' }, collapsed ? '›' : '⌄') : null,
      node.name || node.type,
    ),
    h('span', { className: 'cell duration-cell' }, formatDuration(node.durationMs)),
  );
}

function flattenRows(turns, collapsedGroups) {
  const rows = [];
  for (const turn of turns) {
    rows.push({ kind: 'turn', turn });
    const walk = (nodes, depth, prefix) => {
      nodes.forEach((node, index) => {
        const rowKey = `${prefix}/${node.id || node.type}:${index}`;
        rows.push({ kind: 'row', node, depth, rowKey });
        const kids = node.children || [];
        if (!kids.length) return;
        if (node.type === 'explore_group' && collapsedGroups.has(rowKey)) return;
        walk(kids, depth + 1, rowKey);
      });
    };
    walk(turn.children || [], 0, turn.id);
  }
  return rows;
}

function DetailCard({ id, title, collapsed, onToggle, action, children }) {
  return h(
    'section',
    { className: `detail-card${collapsed ? ' collapsed' : ''}` },
    h(
      'button',
      {
        type: 'button',
        className: 'card-header',
        onClick: (event) => {
          if (event.target.closest('.copy-btn')) return;
          onToggle(id);
        },
      },
      h('span', { className: 'card-title' }, h('span', null, collapsed ? '›' : '⌄'), title),
      action || null,
    ),
    h('div', { className: 'card-body' }, children),
  );
}

function KvList({ value }) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return h(
      'ul',
      { className: 'kv-list' },
      Object.entries(value).map(([key, entry]) =>
        h(
          'li',
          { className: 'kv-item', key },
          h('span', { className: 'kv-key' }, key),
          h('span', { className: 'kv-value' }, stringify(entry)),
        ),
      ),
    );
  }
  return h('pre', { className: 'payload' }, stringify(value));
}

function Inspector({ selected }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [copied, setCopied] = useState(false);

  if (!selected) {
    return h('div', { className: 'empty' }, '选择一条活动，查看关键字段与原始数据。');
  }

  const source = nodeSource(selected);
  const status = String(selected.status || 'completed').toLowerCase();
  const raw = stringify(selected);

  const toggle = (id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fields = [
    ['ID', selected.id],
    ['来源', sourceLabel(source)],
    ['状态', statusLabel(status)],
    ['类型', typeLabel(selected.type)],
    ['耗时', formatDuration(selected.durationMs)],
    ['源文件', selected.sourceFile],
  ].filter(([, value]) => value != null && value !== '');

  const sections = [
    ['arguments', '参数', selected.arguments],
    ['output', '输出', selected.output],
    ['args', '调用参数', selected.args],
    ['result', '调用结果', selected.result],
  ].filter(([, , value]) => value != null);

  return h(
    Fragment,
    null,
    h(
      'section',
      { className: 'summary-card' },
      h(
        'div',
        { className: 'summary-top' },
        h(
          'div',
          { className: 'badges' },
          h('span', { className: `badge source-${source}` }, sourceLabel(source)),
          h('span', { className: `badge status-${status}` }, statusLabel(status)),
        ),
        h('span', { className: 'summary-type' }, typeLabel(selected.type)),
      ),
      h('h2', { className: 'summary-name' }, selected.name || selected.type),
    ),
    h(
      DetailCard,
      {
        id: 'fields',
        title: '关键信息',
        collapsed: collapsed.has('fields'),
        onToggle: toggle,
      },
      h(
        'dl',
        { className: 'fields' },
        fields.flatMap(([label, value]) => [
          h('dt', { key: `${label}-k` }, label),
          h('dd', { key: `${label}-v` }, String(value)),
        ]),
      ),
    ),
    ...sections.map(([id, title, value]) =>
      h(
        DetailCard,
        {
          key: id,
          id,
          title,
          collapsed: collapsed.has(id),
          onToggle: toggle,
        },
        h(KvList, { value }),
      ),
    ),
    h(
      DetailCard,
      {
        id: 'raw',
        title: '原始数据',
        collapsed: collapsed.has('raw'),
        onToggle: toggle,
        action: h(
          'button',
          {
            type: 'button',
            className: 'copy-btn',
            onClick: async (event) => {
              event.stopPropagation();
              try {
                await navigator.clipboard.writeText(raw);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              } catch {
                setCopied(false);
              }
            },
          },
          copied ? '已复制' : '复制',
        ),
      },
      h('pre', { className: 'raw-json' }, raw),
    ),
  );
}

function App() {
  const [selectedKey, setSelectedKey] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  const rows = useMemo(
    () => flattenRows(PREVIEW_TURNS, collapsedGroups),
    [collapsedGroups],
  );

  return h(
    'div',
    { className: 'lab-shell' },
    h(
      'div',
      { className: 'lab-note' },
      h(
        'div',
        null,
        '试验页：只用第三方 ',
        h('code', null, 'react'),
        '；列表行 / 检查器为自研组合，不拷贝 HTTP Toolkit 自研组件。',
      ),
      h('code', null, 'apps/desktop/renderer/lab/'),
    ),
    h(
      'main',
      { className: 'lab-main' },
      h(
        'header',
        { className: 'lab-toolbar' },
        h('h1', null, '活动列表行试验'),
        h('span', null, '第三方 React + 自研行组件'),
      ),
      h(
        'div',
        { className: 'table-head', role: 'row' },
        h('span', null, ''),
        h('span', null, '来源'),
        h('span', null, '状态'),
        h('span', null, '类型'),
        h('span', null, '步骤'),
        h('span', null, '耗时'),
      ),
      h(
        'div',
        { className: 'table-scroll' },
        rows.map((entry) => {
          if (entry.kind === 'turn') {
            return h(
              'div',
              { className: 'turn-heading', key: entry.turn.id },
              h('span', null, entry.turn.name),
              h('span', null, sourceLabel(entry.turn.provider)),
            );
          }
          return h(ActivityRow, {
            key: entry.rowKey,
            node: entry.node,
            depth: entry.depth,
            rowKey: entry.rowKey,
            selected: selectedKey === entry.rowKey,
            collapsed: collapsedGroups.has(entry.rowKey),
            onSelect: (node, rowKey) => {
              setSelectedNode(node);
              setSelectedKey(rowKey);
            },
            onToggleGroup: (rowKey) => {
              setCollapsedGroups((prev) => {
                const next = new Set(prev);
                if (next.has(rowKey)) next.delete(rowKey);
                else next.add(rowKey);
                return next;
              });
            },
          });
        }),
      ),
    ),
    h(
      'aside',
      { className: 'lab-inspector' },
      h(
        'header',
        { className: 'inspector-top' },
        h('h1', null, '详情检查器试验'),
        h('span', null, '自研可折叠卡片'),
      ),
      h('div', { className: 'inspector-body' }, h(Inspector, { selected: selectedNode })),
    ),
  );
}

createRoot(document.getElementById('root')).render(h(App));
