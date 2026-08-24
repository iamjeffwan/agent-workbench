import * as React from 'react';
import {
  CaretDown,
  CaretRight,
  Check,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  PencilSimple,
  SpinnerGap,
  Trash,
  X,
} from '@phosphor-icons/react';

import { styled } from '../upstream/theme';
import { MarkdownDocument } from './MarkdownDocument';
import { TaskAssetComposer, type TaskAssetComposerProps } from './TaskAssetComposer';
import type {
  ProjectAssetDocument,
  ProjectAssetIndex,
  ProjectAssetResult,
  ProjectDocumentNode,
  SaveTaskScriptInput,
  TaskRecord,
  TaskResult,
  TaskSummary,
  ReviewResult,
} from './workbench-data';

const Page = styled.main`
  width: 100%;
  height: 100%;
  max-height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(280px, 34%) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
  background: ${p => p.theme.mainLowlightBackground};
  color: ${p => p.theme.mainColor};
`;

const Library = styled.aside`
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.mainBackground};
`;

const Header = styled.header`
  padding: 20px 18px 16px;
  border-bottom: 1px solid ${p => p.theme.containerBorder};

  h1 { margin: 0; font-size: 22px; font-family: ${p => p.theme.titleTextFamily}; }
  p { margin: 6px 0 0; color: ${p => p.theme.mainLowlightColor}; font-size: 13px; overflow-wrap: anywhere; }
`;

const Tabs = styled.div`
  display: flex;
  gap: 5px;
  margin-top: 13px;
  button { padding: 6px 10px; border: 1px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.mainLowlightBackground}; cursor: pointer; }
  button[data-active="true"] { border-color: ${p => p.theme.popColor}; font-weight: 700; }
`;

const Actions = styled.div`
  min-height: 45px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  border-bottom: 1px solid ${p => p.theme.containerBorder};
  button { padding: 5px 8px; border: 1px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.mainBackground}; cursor: pointer; }
  button:disabled { opacity: 0.55; cursor: default; }
  span { min-width: 0; overflow: hidden; color: ${p => p.theme.mainLowlightColor}; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
`;

const Groups = styled.div`
  flex: 1 1 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 8px 0 0;
`;

const TreeCanvas = styled.div`
  min-height: 100%;
  padding-bottom: 88px;
`;

const FolderButton = styled.button<{ $selected: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  border: 1px solid ${p => p.$selected ? p.theme.highlightColor : 'transparent'};
  background: ${p => p.$selected ? p.theme.mainLowlightBackground : 'transparent'};
  color: ${p => p.theme.mainLowlightColor};
  font: 600 12px ${p => p.theme.titleTextFamily};
  text-align: left;
  cursor: pointer;

  &:hover { background: ${p => p.theme.mainLowlightBackground}; }
`;

const FileButton = styled.button<{ $selected: boolean }>`
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 9px;
  align-items: center;
  padding: 8px 9px;
  border: 1px solid ${p => p.$selected ? p.theme.highlightColor : 'transparent'};
  border-radius: 3px;
  background: ${p => p.$selected ? p.theme.mainLowlightBackground : 'transparent'};
  color: inherit;
  text-align: left;
  cursor: pointer;

  &:hover { background: ${p => p.theme.mainLowlightBackground}; }
  span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

const TaskButton = styled(FileButton)`
  grid-template-columns: auto minmax(0, 1fr) auto;
`;

const TaskStatus = styled.span`
  justify-self: end;
  color: ${p => p.theme.mainLowlightColor};
  font-size: 11px;
`;

const Viewer = styled.section`
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ContentScroll = styled.div`
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 18px;
`;

const Workspace = styled.section`
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const WorkspaceTabs = styled(Tabs)`
  flex: 0 0 auto;
  margin: 0;
  padding: 12px 18px;
  border-bottom: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.mainBackground};
`;

const WorkspaceBody = styled.div`
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: 18px;
`;

const ContextMenu = styled.div`
  position: fixed;
  z-index: 1500;
  width: 210px;
  padding: 5px;
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 3px;
  background: ${p => p.theme.mainBackground};
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
`;

const MenuButton = styled.button<{ $danger?: boolean }>`
  width: 100%;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 9px;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: ${p => p.$danger ? p.theme.popColor : p.theme.mainColor};
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled), &:focus-visible { background: ${p => p.theme.highlightBackground}; }
  &:disabled { opacity: 0.5; cursor: default; }
`;

const MenuDivider = styled.div`
  height: 1px;
  margin: 4px 3px;
  background: ${p => p.theme.containerBorder};
`;

const InlineFolder = styled.form`
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 9px;
  background: ${p => p.theme.mainLowlightBackground};

  input {
    min-width: 0;
    flex: 1;
    height: 27px;
    padding: 3px 6px;
    border: 1px solid ${p => p.theme.highlightColor};
    background: ${p => p.theme.inputBackground};
    color: ${p => p.theme.inputColor};
    font: inherit;
  }

  button {
    width: 25px;
    height: 25px;
    flex: 0 0 25px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid ${p => p.theme.containerBorder};
    background: ${p => p.theme.mainBackground};
    color: ${p => p.theme.mainLowlightColor};
    cursor: pointer;
  }

  button:hover, button:focus-visible { color: ${p => p.theme.mainColor}; }
`;

type TreeMenu = {
  type: 'folder' | 'file';
  path: string;
  x: number;
  y: number;
};

type TreeEditor = {
  mode: 'create' | 'rename';
  type: 'folder' | 'file';
  path: string;
  value: string;
};

type TrashTarget = { type: 'folder' | 'file'; path: string };

const ConfirmOverlay = styled.div`
  position: fixed;
  z-index: 1600;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(30, 32, 40, 0.18);
`;

const ConfirmDialog = styled.section`
  width: min(410px, calc(100vw - 48px));
  padding: 18px;
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 4px;
  background: ${p => p.theme.mainBackground};
  box-shadow: 0 8px 36px rgba(0, 0, 0, 0.36);
  h2 { margin: 0 0 8px; font: 600 18px ${p => p.theme.titleTextFamily}; }
  p { margin: 0 0 17px; color: ${p => p.theme.mainLowlightColor}; overflow-wrap: anywhere; }
  div { display: flex; justify-content: flex-end; gap: 8px; }
  button { min-height: 31px; padding: 5px 11px; border: 1px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.mainLowlightBackground}; cursor: pointer; }
  button[data-danger='true'] { border-color: ${p => p.theme.popColor}; color: ${p => p.theme.popColor}; }
`;

const Notice = styled.div`
  height: 100%;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 30px;
  color: ${p => p.theme.mainLowlightColor};
  text-align: center;

  strong { color: ${p => p.theme.mainColor}; font-size: 17px; }
`;

export function AssetsPage({
  projectRoot,
  listAssets,
  readAsset,
  listTasks,
  taskUpdates,
  readTask,
  discussTask,
  saveTaskScript,
  createDraft,
  writeDraft,
  initializeDocs,
  createFolder,
  createDocument,
  renameFolder,
  trashFolder,
  renameFile,
  trashFile,
  startReview,
}: {
  projectRoot: string | null;
  listAssets(projectRoot?: string | null): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  readAsset(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetDocument | null>>;
  listTasks(projectRoot?: string | null): Promise<TaskResult<TaskSummary[]>>;
  taskUpdates: TaskSummary[];
  readTask(taskId: string): Promise<TaskResult<TaskRecord | null>>;
  discussTask(taskId: string, message: string): Promise<TaskResult<TaskRecord | null>>;
  saveTaskScript(taskId: string, input: SaveTaskScriptInput): Promise<TaskResult<TaskRecord | null>>;
  createDraft: TaskAssetComposerProps['createDraft'];
  writeDraft: TaskAssetComposerProps['writeDraft'];
  initializeDocs(projectRoot: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  createFolder(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  createDocument(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  renameFolder(projectRoot: string, relativePath: string, nextName: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  trashFolder(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  renameFile?(projectRoot: string, relativePath: string, nextName: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  trashFile?(projectRoot: string, relativePath: string): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  startReview(input: { source: 'task'; taskId: string }): Promise<ReviewResult<{ caseId: string } | null>>;
}) {
  const [tab, setTab] = React.useState<'tasks' | 'docs'>('tasks');
  const [index, setIndex] = React.useState<ProjectAssetIndex | null>(null);
  const [document, setDocument] = React.useState<ProjectAssetDocument | null>(null);
  const [selectedFolder, setSelectedFolder] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [task, setTask] = React.useState<TaskRecord | null>(null);
  const [tasks, setTasks] = React.useState<TaskSummary[]>([]);
  const [menu, setMenu] = React.useState<TreeMenu | null>(null);
  const [treeEditor, setTreeEditor] = React.useState<TreeEditor | null>(null);
  const [pendingTrash, setPendingTrash] = React.useState<TrashTarget | null>(null);
  const [collapsedFolders, setCollapsedFolders] = React.useState<Set<string>>(() => new Set());
  const [mutationBusy, setMutationBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const activeTaskId = task?.id ?? null;

  React.useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setDocument(null);
    setSelectedFolder(null);
    setTreeEditor(null);
    setCollapsedFolders(new Set());
    void listAssets(projectRoot).then(result => {
      if (!active) return;
      setIndex(result.data);
      setError(result.status === 'ready' ? null : result.error);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [listAssets, projectRoot]);

  React.useEffect(() => {
    void listTasks(projectRoot).then(result => setTasks(result.data));
  }, [listTasks, projectRoot]);

  React.useEffect(() => {
    if (taskUpdates.length === 0) return;
    setTasks(current => taskUpdates.reduce(
      (next, update) => [update, ...next.filter(item => item.id !== update.id)],
      current,
    ));
    if (activeTaskId && taskUpdates.some(update => update.id === activeTaskId)) {
      void readTask(activeTaskId).then(result => { if (result.data) setTask(result.data); });
    }
  }, [activeTaskId, readTask, taskUpdates]);

  const openFile = async (relativePath: string) => {
    if (!projectRoot) return;
    setLoading(true);
    const result = await readAsset(projectRoot, relativePath);
    setLoading(false);
    setDocument(result.data);
    setError(result.status === 'ready' ? null : result.error);
  };

  const initialize = async () => {
    if (!projectRoot) return;
    setMutationBusy(true);
    const result = await initializeDocs(projectRoot);
    setMutationBusy(false);
    if (result.data) setIndex(result.data);
    setFeedback(result.status === 'ready' ? 'Project document folders are ready.' : result.error);
  };

  const submitTreeEditor = async () => {
    if (!projectRoot || !treeEditor?.value.trim() || mutationBusy) return;
    setMutationBusy(true);
    const result = treeEditor.mode === 'create'
      ? treeEditor.type === 'file'
        ? await createDocument(projectRoot, `${treeEditor.path}/${markdownFileName(treeEditor.value)}`)
        : await createFolder(projectRoot, `${treeEditor.path}/${treeEditor.value.trim()}`)
      : treeEditor.type === 'file'
        ? renameFile
          ? await renameFile(projectRoot, treeEditor.path, treeEditor.value.trim())
          : { status: 'error' as const, source: 'workbench-assets', data: null, error: 'File rename is not available yet.' }
        : await renameFolder(projectRoot, treeEditor.path, treeEditor.value.trim());
    setMutationBusy(false);
    if (result.data) setIndex(result.data);
    setFeedback(result.status === 'ready' ? null : result.error);
    if (result.status === 'ready') {
      setFeedback(treeEditor.mode === 'create' ? `${treeEditor.type === 'file' ? 'Document' : 'Folder'} created.` : `${treeEditor.type === 'file' ? 'Document' : 'Folder'} renamed.`);
      setSelectedFolder(null);
      setTreeEditor(null);
    }
  };

  const confirmTrash = async () => {
    if (!projectRoot || !pendingTrash) return;
    setMutationBusy(true);
    const result = pendingTrash.type === 'file'
      ? trashFile
        ? await trashFile(projectRoot, pendingTrash.path)
        : { status: 'error' as const, source: 'workbench-assets', data: null, error: 'File removal is not available yet.' }
      : await trashFolder(projectRoot, pendingTrash.path);
    setMutationBusy(false);
    if (result.data) setIndex(result.data);
    setFeedback(result.status === 'ready' ? null : result.error);
    if (result.status === 'ready') {
      setFeedback(`${pendingTrash.type === 'file' ? 'Document' : 'Folder'} moved to the recycle bin.`);
      setSelectedFolder(null);
      setPendingTrash(null);
    }
  };

  return <Page aria-label="Library">
    <Library>
      <Header>
        <h1>{tab === 'tasks' ? 'Tasks' : 'Project Docs'}</h1>
        <p>{projectRoot ?? 'Open a project to browse its long-term context.'}</p>
        <Tabs><button data-active={tab === 'tasks'} onClick={() => setTab('tasks')}>Tasks</button><button data-active={tab === 'docs'} onClick={() => setTab('docs')}>Project Docs</button></Tabs>
      </Header>
      {tab === 'docs' ? <Actions><button disabled={!projectRoot || mutationBusy} onClick={() => void initialize()}>{mutationBusy ? 'Working…' : 'Initialize'}</button><span>{error ?? feedback ?? 'Right-click a folder to manage it.'}</span></Actions> : null}
      <Groups>{tab === 'tasks'
        ? tasks.map(item => <TaskButton key={item.id} type="button" $selected={task?.id === item.id} onClick={() => void readTask(item.id).then(result => setTask(result.data))}><FileText size={17} /><span>{item.title}</span><TaskStatus>{item.status}</TaskStatus></TaskButton>)
        : <TreeCanvas onMouseDown={event => { if (event.target === event.currentTarget) setTreeEditor(null); }} onContextMenu={event => {
          event.preventDefault();
          const path = selectedFolder ?? 'docs';
          setMenu({ type: 'folder', path, x: event.clientX, y: event.clientY });
        }}><DocumentTree nodes={index?.tree ?? []} selectedFile={document?.relativePath} selectedFolder={selectedFolder} editor={treeEditor} collapsedFolders={collapsedFolders} onToggleFolder={path => setCollapsedFolders(current => {
          const next = new Set(current);
          if (next.has(path)) next.delete(path); else next.add(path);
          return next;
        })} onSubmitEditor={() => void submitTreeEditor()} onCancelEditor={() => setTreeEditor(null)} onEditorValue={value => setTreeEditor(current => current ? { ...current, value } : current)} onSelectFolder={path => { setTreeEditor(null); setSelectedFolder(path); }} onContextMenu={(type, path, x, y) => {
          setTreeEditor(null);
          if (type === 'folder') setSelectedFolder(path);
          setMenu({ type, path, x, y });
        }} onOpen={path => { setTreeEditor(null); void openFile(path); }} /></TreeCanvas>}
      </Groups>
    </Library>
    <Viewer>
      {tab === 'tasks' ? <TaskWorkspace task={task} discussTask={discussTask} saveTaskScript={saveTaskScript} listAssets={listAssets} createDraft={createDraft} writeDraft={writeDraft} startReview={startReview} />
        : <ContentScroll>{loading ? <Notice><SpinnerGap size={28} className="spin" /><strong>Loading documents…</strong></Notice>
        : error ? <Notice><strong>Documents unavailable</strong><span>{error}</span></Notice>
          : document ? <MarkdownDocument markdown={document.markdown} />
            : <Notice><FolderOpen size={35} /><strong>Select a project document</strong><span>Project documents remain in the project folder and are shown here without moving them.</span></Notice>}</ContentScroll>}
    </Viewer>
    {menu ? <ContextMenu role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 222), top: Math.min(menu.y, window.innerHeight - 190) }} onMouseDown={event => event.stopPropagation()}>
      {menu.type === 'file' ? <MenuButton type="button" role="menuitem" onClick={() => { void openFile(menu.path); setMenu(null); }}><FileText size={17} />Open</MenuButton> : null}
      {menu.type === 'folder' ? <><MenuButton type="button" role="menuitem" onClick={() => {
        setCollapsedFolders(current => { const next = new Set(current); next.delete(menu.path); return next; });
        setTreeEditor({ mode: 'create', type: 'file', path: menu.path, value: 'untitled.md' });
        setMenu(null);
      }}><FileText size={17} />New document</MenuButton><MenuButton type="button" role="menuitem" onClick={() => {
        setCollapsedFolders(current => { const next = new Set(current); next.delete(menu.path); return next; });
        setTreeEditor({ mode: 'create', type: 'folder', path: menu.path, value: '' });
        setMenu(null);
      }}><FolderPlus size={17} />New folder</MenuButton></> : null}
      <MenuButton type="button" role="menuitem" disabled={menu.path === 'docs' || menu.path === 'AGENTS.md' || (menu.type === 'file' && !renameFile)} title={menu.type === 'file' && !renameFile ? 'File rename is not available yet.' : undefined} onClick={() => { setTreeEditor({ mode: 'rename', type: menu.type, path: menu.path, value: folderName(menu.path) }); setMenu(null); }}><PencilSimple size={17} />Rename</MenuButton>
      <MenuDivider />
      <MenuButton type="button" role="menuitem" $danger disabled={menu.path === 'docs' || menu.path === 'AGENTS.md' || (menu.type === 'file' && !trashFile)} title={menu.type === 'file' && !trashFile ? 'File removal is not available yet.' : undefined} onClick={() => { setPendingTrash({ type: menu.type, path: menu.path }); setMenu(null); }}><Trash size={17} />Move to recycle bin</MenuButton>
    </ContextMenu> : null}
    {pendingTrash ? <ConfirmOverlay role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPendingTrash(null); }}><ConfirmDialog role="dialog" aria-modal="true" aria-label={`Move ${pendingTrash.type} to recycle bin`}><h2>Move {pendingTrash.type} to recycle bin?</h2><p>{pendingTrash.path}</p><div><button type="button" onClick={() => setPendingTrash(null)}>Cancel</button><button type="button" data-danger="true" disabled={mutationBusy} onClick={() => void confirmTrash()}>{mutationBusy ? 'Moving…' : 'Move to recycle bin'}</button></div></ConfirmDialog></ConfirmOverlay> : null}
  </Page>;
}

function DocumentTree({ nodes, selectedFile, selectedFolder, editor, collapsedFolders, onToggleFolder, onSubmitEditor, onCancelEditor, onEditorValue, onSelectFolder, onContextMenu, onOpen, depth = 0 }: { nodes: ProjectDocumentNode[]; selectedFile?: string; selectedFolder: string | null; editor: TreeEditor | null; collapsedFolders: Set<string>; onToggleFolder(path: string): void; onSubmitEditor(): void; onCancelEditor(): void; onEditorValue(value: string): void; onSelectFolder(path: string): void; onContextMenu(type: 'folder' | 'file', path: string, x: number, y: number): void; onOpen(path: string): void; depth?: number }) {
  return <>{nodes.map(node => node.type === 'folder'
    ? <React.Fragment key={node.relativePath}>
      {editor?.mode === 'rename' && editor.type === 'folder' && editor.path === node.relativePath
        ? <FolderEditor value={editor.value} depth={depth} onChange={onEditorValue} onSubmit={onSubmitEditor} onCancel={onCancelEditor} />
        : <FolderButton type="button" $selected={selectedFolder === node.relativePath} style={{ paddingLeft: 9 + depth * 12 }} onClick={() => { onSelectFolder(node.relativePath); onToggleFolder(node.relativePath); }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onContextMenu('folder', node.relativePath, event.clientX, event.clientY); }}>{collapsedFolders.has(node.relativePath) ? <CaretRight size={12} /> : <CaretDown size={12} />}<Folder size={14} /> {node.name}</FolderButton>}
      {!collapsedFolders.has(node.relativePath) ? <>
        {editor?.mode === 'create' && editor.path === node.relativePath ? <FolderEditor value={editor.value} depth={depth + 1} onChange={onEditorValue} onSubmit={onSubmitEditor} onCancel={onCancelEditor} /> : null}
        <DocumentTree nodes={node.children} selectedFile={selectedFile} selectedFolder={selectedFolder} editor={editor} collapsedFolders={collapsedFolders} onToggleFolder={onToggleFolder} onSubmitEditor={onSubmitEditor} onCancelEditor={onCancelEditor} onEditorValue={onEditorValue} onSelectFolder={onSelectFolder} onContextMenu={onContextMenu} onOpen={onOpen} depth={depth + 1} />
      </> : null}
    </React.Fragment>
    : editor?.mode === 'rename' && editor.type === 'file' && editor.path === node.relativePath
      ? <FolderEditor key={node.relativePath} value={editor.value} depth={depth} icon="file" onChange={onEditorValue} onSubmit={onSubmitEditor} onCancel={onCancelEditor} />
      : <FileButton key={node.relativePath} type="button" $selected={selectedFile === node.relativePath} style={{ paddingLeft: 9 + depth * 12 }} onClick={() => onOpen(node.relativePath)} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onContextMenu('file', node.relativePath, event.clientX, event.clientY); }}><FileText size={17} /><span>{node.name}</span></FileButton>)}</>;
}

function FolderEditor({ value, depth, icon = 'folder', onChange, onSubmit, onCancel }: { value: string; depth: number; icon?: 'folder' | 'file'; onChange(value: string): void; onSubmit(): void; onCancel(): void }) {
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <InlineFolder style={{ paddingLeft: 9 + depth * 12 }} onMouseDown={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); onSubmit(); }}>{icon === 'file' ? <FileText size={14} /> : <Folder size={14} />}<input ref={input} value={value} aria-label={`${icon === 'file' ? 'Document' : 'Folder'} name`} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }} /><button type="submit" aria-label="Confirm" title="Confirm"><Check size={14} /></button><button type="button" aria-label="Cancel" title="Cancel" onClick={onCancel}><X size={14} /></button></InlineFolder>;
}

function TaskWorkspace({ task, discussTask, saveTaskScript, listAssets, createDraft, writeDraft, startReview }: { task: TaskRecord | null; discussTask(taskId: string, message: string): Promise<TaskResult<TaskRecord | null>>; saveTaskScript(taskId: string, input: SaveTaskScriptInput): Promise<TaskResult<TaskRecord | null>>; listAssets: TaskAssetComposerProps['listAssets']; createDraft: TaskAssetComposerProps['createDraft']; writeDraft: TaskAssetComposerProps['writeDraft']; startReview(input: { source: 'task'; taskId: string }): Promise<ReviewResult<{ caseId: string } | null>> }) {
  const [current, setCurrent] = React.useState(task);
  const [message, setMessage] = React.useState('');
  const [section, setSection] = React.useState<'flow' | 'discussion' | 'drafts' | 'scripts'>('flow');
  const [reviewStarting, setReviewStarting] = React.useState(false);
  const [reviewError, setReviewError] = React.useState<string | null>(null);
  React.useEffect(() => setCurrent(task), [task]);
  if (!current) return <Notice><strong>Select a task</strong></Notice>;
  if (!current.document) return <Notice>{current.status === 'failed' ? <><strong>Generation failed</strong><span>{current.error}</span></> : <><SpinnerGap size={28} className="spin" /><strong>Generating flow document…</strong></>}</Notice>;
  const launchReview = async () => {
    if (reviewStarting) return;
    setReviewStarting(true); setReviewError(null);
    const result = await startReview({ source: 'task', taskId: current.id });
    setReviewStarting(false);
    if (result.status !== 'ready') setReviewError(result.error);
  };
  return <Workspace><WorkspaceTabs><button data-active={section === 'flow'} onClick={() => setSection('flow')}>Flow document</button><button data-active={section === 'discussion'} onClick={() => setSection('discussion')}>Discussion</button><button data-active={section === 'drafts'} onClick={() => setSection('drafts')}>Drafts</button><button data-active={section === 'scripts'} onClick={() => setSection('scripts')}>Scripts</button><button type="button" disabled={reviewStarting} onClick={() => { void launchReview(); }}>{reviewStarting ? 'Starting review…' : 'Start review'}</button></WorkspaceTabs>{reviewError ? <ScriptError role="alert">{reviewError}</ScriptError> : null}<WorkspaceBody>{section === 'flow' ? <MarkdownDocument markdown={current.document.markdown} /> : section === 'discussion' ? <Panel><h2>Discussion</h2>{current.discussion.map(item => <p key={item.id}><strong>{item.role}</strong>: {item.content}</p>)}<textarea value={message} onChange={event => setMessage(event.target.value)} /><button disabled={!message.trim()} onClick={() => void discussTask(current.id, message).then(result => { if (result.data) setCurrent(result.data); setMessage(''); })}>Send</button></Panel> : section === 'drafts' ? <TaskAssetComposer task={current} listAssets={listAssets} createDraft={createDraft} writeDraft={writeDraft} /> : <ScriptWorkspace task={current} onSaved={setCurrent} saveTaskScript={saveTaskScript} />}</WorkspaceBody></Workspace>;
}

function ScriptWorkspace({ task, saveTaskScript, onSaved }: { task: TaskRecord; saveTaskScript(taskId: string, input: SaveTaskScriptInput): Promise<TaskResult<TaskRecord | null>>; onSaved(task: TaskRecord): void }) {
  const scripts = task.scripts ?? [];
  const [editingId, setEditingId] = React.useState<string | undefined>();
  const [title, setTitle] = React.useState('');
  const [language, setLanguage] = React.useState<SaveTaskScriptInput['language']>('shell');
  const [content, setContent] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const edit = (id?: string) => {
    const script = scripts.find(item => item.id === id);
    setEditingId(script?.id);
    setTitle(script?.title ?? '');
    setLanguage(script?.language ?? 'shell');
    setContent(script?.content ?? '');
    setError(null);
  };
  const save = async () => {
    if (!title.trim() || !content.trim() || saving) return;
    setSaving(true);
    setError(null);
    const result = await saveTaskScript(task.id, { id: editingId, title, language, content });
    setSaving(false);
    if (result.status !== 'ready' || !result.data) {
      setError(result.error ?? 'The script draft could not be saved.');
      return;
    }
    onSaved(result.data);
    const saved = result.data.scripts[0];
    setEditingId(saved?.id);
  };
  return <ScriptLayout>
    <ScriptSidebar>
      <button type="button" onClick={() => edit()}>New script draft</button>
      {scripts.map(script => <button type="button" key={script.id} data-active={script.id === editingId} onClick={() => edit(script.id)}><strong>{script.title}</strong><span>{script.language} · draft</span></button>)}
    </ScriptSidebar>
    <ScriptEditor>
      <h2>{editingId ? 'Edit script draft' : 'Create script draft'}</h2>
      <p>Drafts are saved with this task. They are not executed or marked verified here.</p>
      <label>Name<input value={title} onChange={event => setTitle(event.target.value)} placeholder="Example: verify generated document" /></label>
      <label>Language<select value={language} onChange={event => setLanguage(event.target.value as SaveTaskScriptInput['language'])}><option value="shell">Shell</option><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="python">Python</option><option value="other">Other</option></select></label>
      <label>Content<textarea value={content} onChange={event => setContent(event.target.value)} spellCheck={false} placeholder="Enter the script content" /></label>
      {error ? <ScriptError role="alert">{error}</ScriptError> : null}
      <button type="button" disabled={!title.trim() || !content.trim() || saving} onClick={() => { void save(); }}>{saving ? 'Saving…' : 'Save draft'}</button>
    </ScriptEditor>
  </ScriptLayout>;
}

function folderName(relativePath: string): string {
  return relativePath.split('/').at(-1) ?? relativePath;
}

function markdownFileName(value: string): string {
  const trimmed = value.trim();
  return trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`;
}

const Panel = styled.section`margin: 18px 0; padding: 14px; border: 1px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.mainBackground}; textarea { width: 100%; min-height: 80px; box-sizing: border-box; }`;
const ScriptLayout = styled.div`min-height: 100%; display: grid; grid-template-columns: minmax(180px, 28%) minmax(0, 1fr); border: 1px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.mainBackground};`;
const ScriptSidebar = styled.aside`padding: 8px; border-right: 1px solid ${p => p.theme.containerBorder}; button { width: 100%; display: block; margin: 0 0 6px; padding: 8px; border: 1px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.mainLowlightBackground}; color: inherit; text-align: left; cursor: pointer; } button[data-active='true'] { border-color: ${p => p.theme.highlightColor}; } strong, span { display: block; } span { margin-top: 3px; color: ${p => p.theme.mainLowlightColor}; font-size: 11px; }`;
const ScriptEditor = styled.section`padding: 18px; h2 { margin: 0; font: 600 18px ${p => p.theme.titleTextFamily}; } p { margin: 5px 0 16px; color: ${p => p.theme.mainLowlightColor}; } label { display: block; margin: 0 0 12px; font-weight: 600; } input, select, textarea { width: 100%; box-sizing: border-box; margin-top: 5px; padding: 7px; border: 1px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.inputBackground}; color: ${p => p.theme.inputColor}; font: inherit; } textarea { min-height: 220px; resize: vertical; font-family: ${p => p.theme.monoFontFamily}; } > button { padding: 7px 12px; border: 1px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.mainLowlightBackground}; cursor: pointer; } > button:disabled { opacity: 0.55; cursor: default; }`;
const ScriptError = styled.div`margin: 0 0 12px; color: ${p => p.theme.popColor};`;
