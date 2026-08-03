const openBtn = document.getElementById('openBtn');
const refreshBtn = document.getElementById('refreshBtn');
const expandExplore = document.getElementById('expandExplore');
const projectLabel = document.getElementById('projectLabel');
const observeLabel = document.getElementById('observeLabel');
const tree = document.getElementById('tree');
const detail = document.getElementById('detail');
const empty = document.getElementById('empty');
const status = document.getElementById('status');

/** @type {any} */
let current = {
  projectRoot: null,
  turns: [],
  error: null,
  observation: null,
  files: {},
};

/** @type {any} */
let selected = null;

function kindBadge(node) {
  if (node.type === 'explore_group') return 'explore';
  if (node.type === 'program_call') return 'program';
  if (node.name === 'Shell' || node.launchesProcess) return 'shell';
  return '';
}

function renderNode(node, depth = 0) {
  const wrap = document.createElement('div');
  wrap.className = node.type === 'turn' || node.type === 'program_group' ? 'turn' : 'node';
  if (selected && selected.id === node.id) {
    wrap.classList.add('selected');
  }

  const head = document.createElement('div');
  head.className = 'head';
  const left = document.createElement('div');
  left.className = 'title';
  left.textContent = node.name;
  const right = document.createElement('div');
  right.className = 'meta';
  const badge = document.createElement('span');
  badge.className = `badge ${kindBadge(node)}`;
  badge.textContent = node.type;
  right.appendChild(badge);
  if (typeof node.durationMs === 'number') {
    const dur = document.createElement('span');
    dur.textContent = ` ${node.durationMs}ms`;
    right.appendChild(dur);
  }
  head.append(left, right);
  head.addEventListener('click', () => {
    selected = node;
    showDetail(node);
    renderTree();
  });
  wrap.appendChild(head);

  const children = Array.isArray(node.children) ? node.children : [];
  const showChildren =
    node.type !== 'explore_group' || expandExplore.checked || depth === 0;
  if (children.length && (node.type !== 'explore_group' || expandExplore.checked)) {
    const box = document.createElement('div');
    box.className = 'children';
    for (const child of children) {
      if (node.type === 'explore_group' && !expandExplore.checked) continue;
      box.appendChild(renderNode(child, depth + 1));
    }
    if (box.childNodes.length) {
      wrap.appendChild(box);
    } else if (node.type === 'explore_group' && !expandExplore.checked) {
      const hint = document.createElement('div');
      hint.className = 'meta';
      hint.textContent = '默认折叠；勾选“展开探查”查看明细';
      wrap.appendChild(hint);
    }
  } else if (node.type === 'explore_group' && !showChildren) {
    const hint = document.createElement('div');
    hint.className = 'meta';
    hint.textContent = JSON.stringify(node.summary || {});
    wrap.appendChild(hint);
  }

  return wrap;
}

function renderTree() {
  tree.replaceChildren();
  for (const turn of current.turns || []) {
    tree.appendChild(renderNode(turn));
  }
}

function showDetail(node) {
  empty.classList.add('hidden');
  detail.classList.remove('hidden');
  const copy = { ...node };
  delete copy.children;
  detail.textContent = JSON.stringify(copy, null, 2);
}

function renderObservation() {
  if (!current.projectRoot) {
    observeLabel.textContent = '打开项目后会自动注入 Cursor 观察配置';
    observeLabel.classList.remove('warn');
    return;
  }
  if (current.observation?.workbenchHome) {
    observeLabel.textContent =
      '已注入观察配置：Cursor 工具步骤会写入本项目 .agent-workbench/';
    observeLabel.classList.remove('warn');
    return;
  }
  observeLabel.textContent = '尚未完成观察配置注入；可点“刷新”重试';
  observeLabel.classList.add('warn');
}

function renderState(next) {
  current = next || current;
  projectLabel.textContent = current.projectRoot || '未选择项目';
  renderObservation();
  if (current.error) {
    status.textContent = current.error;
    status.classList.add('error');
  } else {
    const count = (current.turns || []).length;
    status.textContent = current.projectRoot
      ? `已加载 ${count} 个轮次/分组`
      : '等待打开项目';
    status.classList.remove('error');
  }
  renderTree();
  if (!selected) {
    empty.classList.remove('hidden');
    detail.classList.add('hidden');
    empty.textContent = current.projectRoot
      ? '已开始观察。在 Cursor 里对该项目执行工具后，操作流会出现在左侧。'
      : '选择项目目录后，工作台会自动注入 Cursor 观察配置，并读取其中的操作流。';
  }
}

openBtn.addEventListener('click', async () => {
  const next = await window.workbench.openProject();
  selected = null;
  renderState(next);
});

refreshBtn.addEventListener('click', async () => {
  const next = await window.workbench.refresh();
  renderState(next);
});

expandExplore.addEventListener('change', () => {
  renderTree();
});

window.workbench.onState((next) => {
  renderState(next);
});

window.workbench.getState().then((next) => {
  renderState(next);
});
