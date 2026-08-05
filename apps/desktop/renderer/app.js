const elements = {
  openProject: document.getElementById('open-project'),
  refresh: document.getElementById('refresh'),
  projectRoot: document.getElementById('project-root'),
  sourceStats: document.getElementById('source-stats'),
  sourceFilters: document.getElementById('source-filters'),
  observation: document.getElementById('observation'),
  turnList: document.getElementById('turn-list'),
  error: document.getElementById('error'),
  search: document.getElementById('search'),
  toggleProgram: document.getElementById('toggle-program'),
  clearFilter: document.getElementById('clear-filter'),
  turns: document.getElementById('turns'),
  empty: document.getElementById('empty'),
  detail: document.getElementById('detail'),
  detailClose: document.getElementById('detail-close'),
  detailBody: document.getElementById('detail-body'),
  visibleCount: document.getElementById('visible-count'),
};

let current = {
  projectRoot: null,
  turns: [],
  error: null,
  observation: null,
  adapters: {},
  files: {},
};
let selectedTurnId = null;
let selectedNode = null;
let selectedNodeKey = null;
let sourceFilter = null;
const collapsedGroups = new Set();
const collapsedDetailSections = new Set();
const previewMode = new URLSearchParams(window.location.search).has('preview');
const workbenchApi = window.workbench || (previewMode ? createPreviewWorkbench() : null);

function createPreviewWorkbench() {
  const previewState = {
    projectRoot: 'F:\\projects\\agent-workbench-demo',
    error: null,
    observation: { workbenchHome: 'preview' },
    adapters: {
      cursor: { status: 'ready', stepCount: 7, lastEventAt: new Date().toISOString() },
      codex: { status: 'ready', sessionCount: 2, stepCount: 9, lastSyncAt: new Date().toISOString() },
    },
    files: {},
    turns: [
      {
        id: 'turn:preview-1',
        type: 'turn',
        name: '执行轮次 1',
        provider: 'codex',
        status: 'completed',
        children: [
          {
            id: 'explore:preview-1',
            type: 'explore_group',
            name: '文件探查 × 6',
            status: 'completed',
            source: 'codex',
            children: [
              { id: 'read-1', type: 'agent_tool', name: 'Read · apps/desktop/renderer/app.js', source: 'codex', status: 'completed', durationMs: 84, arguments: { path: 'apps/desktop/renderer/app.js' } },
              { id: 'grep-1', type: 'agent_tool', name: 'Grep · renderDetail', source: 'codex', status: 'completed', durationMs: 121, arguments: { pattern: 'renderDetail' } },
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
              { id: 'call-1', type: 'program_call', name: 'Timeline.build', status: 'completed', durationMs: 36, args: { turns: 2 }, result: { nodes: 16 }, sourceFile: 'packages/timeline/src/build-timeline.ts' },
            ],
          },
        ],
      },
      {
        id: 'turn:preview-2',
        type: 'turn',
        name: '执行轮次 2',
        provider: 'cursor',
        status: 'completed',
        children: [
          { id: 'shell-2', type: 'agent_tool', name: 'Shell · 启动桌面预览', source: 'cursor', status: 'running', durationMs: 1732, arguments: { command: 'pnpm desktop:dev' } },
          { id: 'call-2', type: 'program_call', name: 'ProjectWatcher.refresh', status: 'completed', durationMs: 18, args: { project: 'agent-workbench-demo' }, result: { updated: true }, sourceFile: 'packages/codex-adapter/src/project-sessions.ts' },
        ],
      },
    ],
  };
  return {
    openProject: async () => previewState,
    refresh: async () => previewState,
    getState: async () => previewState,
    onState: () => () => {},
  };
}

function render() {
  renderProject();
  renderSources();
  renderSourceFilters();
  renderTurnNavigation();
  renderTurns();
  renderError();
  renderDetail();
}

function renderProject() {
  if (elements.projectRoot) {
    elements.projectRoot.textContent = current.projectRoot || '尚未选择项目';
    elements.projectRoot.title = current.projectRoot || '';
  }
  if (!elements.observation) return;

  if (!current.projectRoot) {
    elements.observation.textContent = '打开项目后，将在这里显示代理活动与程序调用。';
    elements.observation.className = 'observation-box';
    return;
  }
  if (current.observation?.workbenchHome) {
    elements.observation.textContent = '项目观察已启用，正在同步活动记录。';
    elements.observation.className = 'observation-box ready';
  } else {
    elements.observation.textContent = '项目已打开，观察配置尚未完成，可刷新重试。';
    elements.observation.className = 'observation-box warning';
  }
}

function renderSources() {
  if (!elements.sourceStats) return;
  elements.sourceStats.replaceChildren();
  const sources = [
    ['Cursor', current.adapters?.cursor],
    ['Codex', current.adapters?.codex],
  ];
  for (const [name, adapter] of sources) {
    const row = createElement('div', 'source-row');
    const dot = createElement('span', `source-dot ${cssToken(adapter?.status || 'idle')}`);
    const label = createElement('span', 'source-name', name);
    const summary = createElement('span', 'source-summary');
    const parts = [`${adapter?.stepCount || 0} 步`];
    if (typeof adapter?.sessionCount === 'number') {
      parts.unshift(`${adapter.sessionCount} 个对话`);
    }
    summary.textContent = parts.join(' · ');
    summary.title = adapterTooltip(adapter);
    row.append(dot, label, summary);
    elements.sourceStats.appendChild(row);
  }
}

function adapterTooltip(adapter) {
  if (!adapter) return '尚未启动';
  const parts = [`状态：${adapterStatusLabel(adapter.status)}`];
  if (adapter.lastSyncAt) parts.push(`最后同步：${formatTime(adapter.lastSyncAt)}`);
  if (adapter.lastEventAt) parts.push(`最后记录：${formatTime(adapter.lastEventAt)}`);
  if (adapter.processLinking === 'unavailable') {
    parts.push('程序关联：当前版本不支持可靠的执行前注入');
  }
  if (adapter.error) parts.push(`错误：${adapter.error}`);
  return parts.join('\n');
}

function adapterStatusLabel(status) {
  return {
    ready: '已连接',
    error: '异常',
    idle: '未启动',
  }[status] || status || '未知';
}

function renderSourceFilters() {
  if (!elements.sourceFilters) return;
  elements.sourceFilters.replaceChildren();
  const counts = collectSourceCounts(current.turns || []);
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const choices = [[null, '全部', total]];
  for (const source of ['codex', 'cursor', 'program']) {
    if (counts.has(source)) choices.push([source, sourceLabel(source), counts.get(source)]);
  }
  for (const [source, count] of counts) {
    if (!['codex', 'cursor', 'program'].includes(source)) {
      choices.push([source, sourceLabel(source), count]);
    }
  }

  for (const [source, label, count] of choices) {
    const button = createElement('button', 'source-filter');
    button.type = 'button';
    button.dataset.source = source || 'all';
    button.classList.toggle('active', sourceFilter === source);
    button.setAttribute('aria-pressed', String(sourceFilter === source));
    button.textContent = `${label} ${count}`;
    button.addEventListener('click', () => {
      sourceFilter = source;
      renderSourceFilters();
      renderTurns();
    });
    elements.sourceFilters.appendChild(button);
  }
}

function collectSourceCounts(turns) {
  const counts = new Map();
  const visit = (node) => {
    if (!['turn', 'program_group', 'explore_group'].includes(node.type)) {
      const source = nodeSource(node);
      counts.set(source, (counts.get(source) || 0) + 1);
    }
    for (const child of node.children || []) visit(child);
  };
  for (const turn of turns) visit(turn);
  return counts;
}

function renderTurnNavigation() {
  if (!elements.turnList) return;
  elements.turnList.replaceChildren();
  for (const [index, turn] of (current.turns || []).entries()) {
    const item = document.createElement('li');
    const button = createElement('button', 'turn-link');
    button.type = 'button';
    button.classList.toggle('active', turn.id === selectedTurnId);
    button.textContent = `${index + 1}. ${turn.provider || '程序'} · ${childCount(turn)} 步`;
    button.title = turn.generationId || turn.conversationId || turn.name || '';
    button.addEventListener('click', () => {
      selectedTurnId = turn.id;
      renderTurnNavigation();
      document.getElementById(turnDomId(index))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    item.appendChild(button);
    elements.turnList.appendChild(item);
  }
}

function renderTurns() {
  if (!elements.turns) return;
  elements.turns.replaceChildren();
  const filter = parseSearch(elements.search?.value || '');
  const visibleTurns = [];

  for (const [index, turn] of (current.turns || []).entries()) {
    const filtered = filterTree(turn, filter);
    if (filtered) visibleTurns.push({ turn, filtered, index });
  }

  if (visibleTurns.length) {
    elements.turns.appendChild(renderTableHeader());
    for (const entry of visibleTurns) {
      elements.turns.appendChild(renderTurnGroup(entry.turn, entry.filtered, entry.index, filter.active));
    }
  }

  if (elements.visibleCount) {
    const visibleRows = visibleTurns.reduce(
      (count, entry) => count + countFilteredRows(entry.filtered),
      0,
    );
    elements.visibleCount.textContent = `${visibleRows} 项活动`;
  }

  if (elements.empty) {
    elements.empty.hidden = visibleTurns.length > 0;
    const title = elements.empty.querySelector('.empty-title, p:not(.empty-hint)');
    const hint = elements.empty.querySelector('.empty-hint');
    if (title) title.textContent = current.projectRoot ? '没有匹配的活动' : '尚未打开项目';
    if (hint) {
      hint.textContent = current.projectRoot
        ? '等待新的代理活动，或清空当前过滤条件'
        : '打开一个项目后即可查看完整执行时间线';
    }
  }
}

function renderTableHeader() {
  const header = createElement('div', 'activity-table-header');
  header.setAttribute('role', 'row');
  for (const [label, className] of [
    ['', 'indicator-column'],
    ['来源', 'source-column'],
    ['状态', 'status-column'],
    ['类型', 'type-column'],
    ['步骤', 'name-column'],
    ['耗时', 'duration-column'],
  ]) {
    const cell = createElement('span', `activity-heading ${className}`, label);
    cell.setAttribute('role', 'columnheader');
    header.appendChild(cell);
  }
  return header;
}

function renderTurnGroup(turn, filtered, turnIndex, filtering) {
  const section = createElement('section', 'turn-group');
  section.id = turnDomId(turnIndex);
  section.dataset.turnId = turn.id || String(turnIndex);

  const heading = createElement('div', 'turn-group-heading');
  const identity = createElement('div', 'turn-group-identity');
  identity.append(
    createElement('span', 'turn-index', String(turnIndex + 1).padStart(2, '0')),
    createElement('h2', 'turn-name', turn.name || `执行轮次 ${turnIndex + 1}`),
  );
  const meta = createElement('div', 'turn-group-meta');
  const provider = sourceLabel(normalizeSource(turn.provider));
  meta.textContent = `${provider} · ${countFilteredRows(filtered)} 项活动`;
  heading.append(identity, meta);
  section.appendChild(heading);

  const body = createElement('div', 'activity-table-body');
  body.setAttribute('role', 'rowgroup');
  for (const [index, child] of filtered.children.entries()) {
    const key = `${turn.id || turnIndex}/${child.node.id || child.node.type}:${index}`;
    appendNodeRows(body, child, 0, key, filtering);
  }
  section.appendChild(body);
  return section;
}

function appendNodeRows(parent, filtered, depth, key, filtering) {
  const node = filtered.node;
  const isGroup = node.type === 'explore_group';
  parent.appendChild(renderActivityRow(node, depth, key, isGroup));

  if (isGroup && collapsedGroups.has(key) && !filtering) return;
  for (const [index, child] of filtered.children.entries()) {
    appendNodeRows(
      parent,
      child,
      depth + 1,
      `${key}/${child.node.id || child.node.type}:${index}`,
      filtering,
    );
  }
}

function renderActivityRow(node, depth, key, isGroup) {
  const status = nodeStatus(node);
  const source = nodeSource(node);
  const row = createElement(
    'button',
    `activity-row source-${cssToken(source)} status-${cssToken(status)}`,
  );
  row.type = 'button';
  row.setAttribute('role', 'row');
  row.style.setProperty('--depth', String(depth));
  row.classList.toggle('group-row', isGroup);
  row.classList.toggle('selected', selectedNodeKey === key);
  row.dataset.nodeId = node.id || '';
  row.dataset.nodeType = node.type || '';

  const markerCell = createElement('span', 'activity-cell indicator-column');
  const marker = createElement('span', 'row-marker');
  marker.setAttribute('aria-label', statusLabel(status));
  markerCell.appendChild(marker);

  const sourceCell = createElement('span', 'activity-cell source-column');
  sourceCell.appendChild(
    createElement('span', `source-mark source-${cssToken(source)}`, sourceLabel(source)),
  );

  const statusCell = createElement('span', 'activity-cell status-column');
  statusCell.appendChild(createElement('span', 'status-text', statusLabel(status)));

  const typeCell = createElement('span', 'activity-cell type-column', typeLabel(node.type));

  const nameCell = createElement('span', 'activity-cell name-column');
  const indent = createElement('span', 'row-indent');
  indent.style.width = `${depth * 16}px`;
  nameCell.appendChild(indent);
  if (isGroup) {
    const chevron = createElement('span', 'group-chevron', collapsedGroups.has(key) ? '›' : '⌄');
    chevron.setAttribute('aria-hidden', 'true');
    nameCell.appendChild(chevron);
  }
  nameCell.appendChild(
    createElement('span', 'activity-name', node.name || node.type || '未命名步骤'),
  );

  const durationCell = createElement(
    'span',
    'activity-cell duration-column',
    formatDuration(nodeDuration(node)),
  );
  row.append(markerCell, sourceCell, statusCell, typeCell, nameCell, durationCell);

  row.addEventListener('click', () => {
    if (isGroup) {
      if (collapsedGroups.has(key)) collapsedGroups.delete(key);
      else collapsedGroups.add(key);
      renderTurns();
      return;
    }
    selectedNode = node;
    selectedNodeKey = key;
    renderTurns();
    renderDetail();
  });
  return row;
}

function parseSearch(value) {
  const filter = { terms: [], types: [], sources: [], active: false };
  for (const token of value.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const match = token.match(/^(type|source):(.+)$/);
    if (!match) filter.terms.push(token);
    else if (match[1] === 'type') filter.types.push(match[2]);
    else filter.sources.push(normalizeSource(match[2]));
  }
  filter.active = Boolean(filter.terms.length || filter.types.length || filter.sources.length || sourceFilter);
  return filter;
}

function filterTree(node, filter) {
  if (!showProgramCalls() && node.type === 'program_call') return null;
  const children = (node.children || []).map((child) => filterTree(child, filter)).filter(Boolean);
  const ownMatch = matchesNode(node, filter);
  if (!ownMatch && children.length === 0) return null;
  return { node, children, ownMatch };
}

function matchesNode(node, filter) {
  const source = nodeSource(node);
  if (sourceFilter && source !== sourceFilter) return false;
  if (filter.types.length && !filter.types.some((value) => String(node.type || '').toLowerCase().includes(value))) {
    return false;
  }
  if (filter.sources.length && !filter.sources.includes(source)) return false;
  if (!filter.terms.length) return true;
  const text = safeStringify({
    type: node.type,
    name: node.name,
    status: node.status,
    source,
    provider: node.provider,
    sourceFile: node.sourceFile,
    id: node.id,
  }).toLowerCase();
  return filter.terms.every((term) => text.includes(term));
}

function renderDetail() {
  if (!elements.detailBody) return;
  elements.detailBody.replaceChildren();
  if (!selectedNode) {
    elements.detail?.classList.remove('open');
    const empty = createElement('div', 'inspector-empty');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 48 48');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML =
      '<circle cx="21" cy="21" r="11" /><path d="m29 29 9 9M21 16v10M16 21h10" />';
    empty.append(
      icon,
      createElement('p', null, '选择一条执行记录'),
      createElement('span', null, '在这里查看步骤输入、输出与原始数据。'),
    );
    elements.detailBody.appendChild(empty);
    return;
  }
  elements.detail?.classList.add('open');

  const summary = createElement('section', 'detail-summary');
  const summaryTop = createElement('div', 'detail-summary-top');
  const identity = createElement('div', 'detail-identity');
  identity.append(
    createElement(
      'span',
      `source-badge source-${cssToken(nodeSource(selectedNode))}`,
      sourceLabel(nodeSource(selectedNode)),
    ),
    createElement(
      'span',
      `status-badge status-${cssToken(nodeStatus(selectedNode))}`,
      statusLabel(nodeStatus(selectedNode)),
    ),
  );
  summaryTop.append(
    identity,
    createElement('span', 'detail-type', typeLabel(selectedNode.type)),
  );
  summary.append(
    summaryTop,
    createElement('h2', 'detail-name', selectedNode.name || selectedNode.type || '未命名步骤'),
  );
  if (selectedNode.sourceFile) {
    summary.appendChild(
      createElement('p', 'detail-source-file', String(selectedNode.sourceFile)),
    );
  }
  elements.detailBody.appendChild(summary);

  const fields = createElement('dl', 'detail-fields');
  const entries = [
    ['ID', selectedNode.id],
    ['来源', sourceLabel(nodeSource(selectedNode))],
    ['状态', statusLabel(nodeStatus(selectedNode))],
    ['类型', typeLabel(selectedNode.type)],
    ['耗时', formatDuration(nodeDuration(selectedNode))],
    ['开始时间', selectedNode.startedAt == null ? null : formatTime(selectedNode.startedAt)],
    ['结束时间', selectedNode.endedAt == null ? null : formatTime(selectedNode.endedAt)],
    ['提供方', selectedNode.provider],
    ['源文件', selectedNode.sourceFile],
  ];
  for (const [label, value] of entries) {
    if (value == null || value === '') continue;
    fields.append(
      createElement('dt', 'detail-field-label', label),
      createElement('dd', 'detail-field-value', String(value)),
    );
  }
  elements.detailBody.appendChild(createDetailCard('fields', '关键信息', fields));

  for (const [sectionId, label, key] of [
    ['arguments', '参数', 'arguments'],
    ['output', '输出', 'output'],
    ['args', '调用参数', 'args'],
    ['result', '调用结果', 'result'],
    ['error', '错误', 'error'],
  ]) {
    if (selectedNode[key] == null) continue;
    const body =
      key === 'error'
        ? createPayloadBlock(selectedNode[key], true)
        : createObjectOrPayload(selectedNode[key]);
    elements.detailBody.appendChild(createDetailCard(sectionId, label, body));
  }

  const rawText = safeStringify(selectedNode, 2);
  const rawBody = createElement('pre', 'raw-json', rawText);
  const copyButton = createElement('button', 'copy-button', '复制');
  copyButton.type = 'button';
  copyButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    copyButton.disabled = true;
    try {
      await navigator.clipboard.writeText(rawText);
      copyButton.textContent = '已复制';
      copyButton.classList.add('copied');
    } catch {
      copyButton.textContent = '复制失败';
      copyButton.classList.add('copy-failed');
    }
    window.setTimeout(() => {
      copyButton.disabled = false;
      copyButton.textContent = '复制';
      copyButton.classList.remove('copied', 'copy-failed');
    }, 1400);
  });
  elements.detailBody.appendChild(
    createDetailCard('raw', '原始数据', rawBody, copyButton),
  );
}

function createDetailCard(id, title, body, action) {
  const collapsed = collapsedDetailSections.has(id);
  const card = createElement('section', `detail-card${collapsed ? ' collapsed' : ''}`);
  card.dataset.sectionId = id;

  const header = createElement('button', 'detail-card-header');
  header.type = 'button';
  header.setAttribute('aria-expanded', String(!collapsed));

  const titleWrap = createElement('span', 'detail-card-title');
  titleWrap.append(
    createElement('span', 'detail-card-chevron', collapsed ? '›' : '⌄'),
    document.createTextNode(title),
  );

  const actions = createElement('span', 'detail-card-actions');
  if (action) actions.appendChild(action);
  header.append(titleWrap, actions);

  header.addEventListener('click', (event) => {
    if (event.target.closest('.copy-button')) return;
    if (collapsedDetailSections.has(id)) collapsedDetailSections.delete(id);
    else collapsedDetailSections.add(id);
    renderDetail();
  });

  const bodyWrap = createElement('div', 'detail-card-body');
  bodyWrap.appendChild(body);
  card.append(header, bodyWrap);
  return card;
}

function createObjectOrPayload(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const list = createElement('ul', 'detail-kv-list');
    for (const [key, entry] of Object.entries(value)) {
      const item = createElement('li', 'detail-kv-item');
      item.append(
        createElement('span', 'detail-kv-key', key),
        createElement('span', 'detail-kv-value', valueToText(entry)),
      );
      list.appendChild(item);
    }
    if (list.childNodes.length) return list;
  }
  return createPayloadBlock(value, false);
}

function createPayloadBlock(value, isError) {
  const block = createElement(
    'div',
    `detail-payload${isError ? ' detail-payload-error' : ''}`,
  );
  block.appendChild(createElement('pre', 'detail-payload-value', valueToText(value)));
  return block;
}

function renderError() {
  if (!elements.error) return;
  const adapterErrors = Object.entries(current.adapters || {})
    .filter(([, value]) => value?.error)
    .map(([name, value]) => `${sourceLabel(name)}：${value.error}`);
  const messages = [current.error, ...adapterErrors].filter(Boolean);
  elements.error.textContent = messages.join('\n');
  elements.error.hidden = messages.length === 0;
}

function nodeSource(node) {
  if (node.type === 'program_call' || node.type === 'program_group') return 'program';
  return normalizeSource(node.source || node.provider || 'program');
}

function normalizeSource(value) {
  const source = String(value || '').trim().toLowerCase();
  if (source.includes('codex')) return 'codex';
  if (source.includes('cursor')) return 'cursor';
  if (source.includes('program') || source.includes('程序')) return 'program';
  return source || 'program';
}

function sourceLabel(value) {
  const source = normalizeSource(value);
  return { codex: 'Codex', cursor: 'Cursor', program: '程序' }[source] || String(value || '未知');
}

function nodeStatus(node) {
  if (node.error != null) return 'error';
  if (node.incomplete) return 'running';
  return String(node.status || 'completed').toLowerCase();
}

function statusLabel(status) {
  return {
    completed: '完成',
    complete: '完成',
    success: '成功',
    succeeded: '成功',
    ready: '就绪',
    running: '进行中',
    pending: '等待中',
    error: '错误',
    failed: '失败',
    cancelled: '已取消',
    canceled: '已取消',
  }[status] || status || '未知';
}

function typeLabel(type) {
  return {
    agent_tool: '代理工具',
    program_call: '程序方法',
    explore_group: '探查组',
    program_group: '程序活动',
    turn: '执行轮次',
  }[type] || type || '活动';
}

function nodeDuration(node) {
  if (typeof node.durationMs === 'number') return node.durationMs;
  if (node.startedAt == null || node.endedAt == null) return null;
  const started = toTimestamp(node.startedAt);
  const ended = toTimestamp(node.endedAt);
  return started == null || ended == null ? null : Math.max(0, ended - started);
}

function toTimestamp(value) {
  if (typeof value === 'number') return value;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatDuration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN');
}

function childCount(node) {
  return (node.children || []).reduce((count, child) => count + 1 + childCount(child), 0);
}

function countFilteredRows(filtered) {
  return filtered.children.reduce((count, child) => count + 1 + countFilteredRows(child), 0);
}

function showProgramCalls() {
  return elements.toggleProgram ? elements.toggleProgram.checked : true;
}

function turnDomId(index) {
  return `turn-group-${index}`;
}

function cssToken(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function safeStringify(value, spacing = 0) {
  try {
    const result = JSON.stringify(value, null, spacing);
    return result === undefined ? String(value) : result;
  } catch {
    return '[无法序列化的数据]';
  }
}

function valueToText(value) {
  return typeof value === 'string' ? value : safeStringify(value, 2);
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
}

async function runWorkbenchAction(action, button) {
  if (button) button.disabled = true;
  try {
    const next = await action();
    if (next) current = next;
  } catch (error) {
    current = { ...current, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (button) button.disabled = false;
    render();
  }
}

elements.openProject?.addEventListener('click', async () => {
  selectedTurnId = null;
  selectedNode = null;
  selectedNodeKey = null;
  sourceFilter = null;
  collapsedGroups.clear();
  if (workbenchApi) {
    await runWorkbenchAction(() => workbenchApi.openProject(), elements.openProject);
  }
});

elements.refresh?.addEventListener('click', async () => {
  if (workbenchApi) {
    await runWorkbenchAction(() => workbenchApi.refresh(), elements.refresh);
  }
});

elements.search?.addEventListener('input', renderTurns);
elements.toggleProgram?.addEventListener('change', renderTurns);
elements.clearFilter?.addEventListener('click', () => {
  if (elements.search) elements.search.value = '';
  if (elements.toggleProgram) elements.toggleProgram.checked = true;
  sourceFilter = null;
  renderSourceFilters();
  renderTurns();
});

elements.detailClose?.addEventListener('click', () => {
  selectedNode = null;
  selectedNodeKey = null;
  renderTurns();
  renderDetail();
});

for (const trigger of document.querySelectorAll('[data-action="project-drawer"]')) {
  trigger.addEventListener('click', () => {
    const app = document.getElementById('app');
    const open = !app?.classList.contains('project-drawer-open');
    app?.classList.toggle('project-drawer-open', open);
    trigger.setAttribute('aria-expanded', String(open));
  });
}

if (workbenchApi) {
  workbenchApi.onState((next) => {
    if (next) current = next;
    render();
  });

  workbenchApi.getState()
    .then((next) => {
      if (next) current = next;
      render();
    })
    .catch((error) => {
      current = { ...current, error: error instanceof Error ? error.message : String(error) };
      render();
    });
} else {
  render();
}
