import * as React from 'react';
import { CaretDown, CaretRight, CaretUp, FileCode, Folder, Function as FunctionIcon, GitDiff, X } from '@phosphor-icons/react';
import { mix } from 'polished';
import { styled, css } from '../upstream/theme';
import { CollapsibleSection, CollapsibleSectionBody, CollapsibleSectionSummary } from '../upstream/CollapsibleSection';
import { CodeViewer } from '../upstream/CodeViewer';
import { HttpDetailsPane } from '../upstream/HttpDetailsPane';
import { DiffViewer } from './DiffViewer';
import type { AgentAction, AgentOperation, ChangedFile, CodeChanges, PreviewRecord, ProgramCall, ProjectFile } from './types';
import type { DiffLayout } from './view-model';
import { formatMethodLabel, formatStatusLabel, formatDisplayPath } from './display-labels';
import { AgentBrandIcon } from './AgentBrandIcon';
import { FormattedArguments, FormattedResult, buildOperationParams } from './ToolContentViews';
import { isErrorStatus } from './workbench-data';

const Pane = styled.div`
  width: 100%;
  height: 100%;
  overflow-y: auto;
  padding: 20px;
  background: ${p => p.theme.containerBackground};
`;

const Card = styled.section<{ $accent: string; $collapsed: boolean }>`
  padding: 20px;
  margin-bottom: ${p => p.$collapsed ? '-16px' : '20px'};
  border-radius: 4px;
  border-left: 5px solid ${p => p.$accent};
  background: ${p => p.theme.mainBackground};
  box-shadow: 0 2px 10px rgba(0,0,0,${p => p.theme.boxShadowAlpha});
  transition: margin .1s;

  > header {
    min-height: 29px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    color: ${p => p.theme.containerWatermark};
    text-align: right;
    text-transform: uppercase;
    ${p => !p.$collapsed && css`margin-bottom: 20px;`}
  }
  > header h1 {
    margin: 0;
    font-family: ${p => p.theme.titleTextFamily};
    font-size: ${p => p.theme.headingSize};
    font-weight: bold;
    white-space: nowrap;
    cursor: pointer;
  }
  &:focus-within { border-color: ${p => p.theme.popColor}; }
`;

const Pill = styled.span<{ $color?: string }>`
  max-width: 48%;
  padding: 5px 8px 3px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border-radius: 4px;
  color: ${p => p.theme.mainColor};
  background: ${p => mix(.3, p.$color ?? p.theme.pillDefaultColor, p.theme.mainBackground)};
  font-weight: bold;
  text-transform: none;
`;

const HeaderIcon = styled.span<{ $color?: string }>`
  display: inline-flex;
  color: ${p => p.$color ?? p.theme.mainColor};
  font-size: 21px;
`;

const Toggle = styled.button`
  margin: 0 -10px 0 -3px;
  padding: 4px 10px;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  &:hover, &:focus { outline: 0; color: ${p => p.theme.popColor}; }
`;

const Label = styled.h2`
  display: inline-block;
  margin: 0 7px 0 0;
  font-size: ${p => p.theme.textSize};
  font-weight: 400;
  font-family: ${p => p.theme.titleTextFamily};
  text-transform: uppercase;
  color: ${p => p.theme.containerWatermark};
`;

const Mono = styled.span`
  font-family: ${p => p.theme.monoFontFamily};
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const PropertyGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(115px, auto) 1fr;
  gap: 9px 18px;
  align-items: baseline;
  font-size: ${p => p.theme.textSize};
  > ${Label} { margin: 0; }
`;

const ResultBox = styled.pre<{ $error?: boolean }>`
  margin: 0;
  padding: 14px 16px;
  border-left: 3px solid ${p => p.$error ? p.theme.popColor : '#168a50'};
  background: ${p => p.theme.mainLowlightBackground};
  color: ${p => p.theme.mainColor};
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 14px;
  line-height: 1.45;
  white-space: pre-wrap;
`;

function CollapsibleCard({ title, accent, header, children, defaultCollapsed = false }: {
  title: string;
  accent: string;
  header: React.ReactNode;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  return (
    <Card $accent={accent} $collapsed={collapsed} aria-expanded={!collapsed}>
      <header>
        {header}
        <h1 onClick={() => setCollapsed(!collapsed)}>{title}</h1>
        <Toggle type="button" onClick={() => setCollapsed(!collapsed)} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}>
          {collapsed ? <CaretDown weight="bold" /> : <CaretUp weight="bold" />}
        </Toggle>
      </header>
      {collapsed ? null : children}
    </Card>
  );
}

function JsonBody({ value }: { value: unknown }) {
  return <CodeViewer value={formatValue(value)} language="json" expanded={false} />;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'No result was recorded.';
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

const EditChangesLayout = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
`;

const EditHeaderPane = styled.div`
  padding: 16px 20px 0;
  background: ${p => p.theme.containerBackground};
`;

function OperationInspector({
  record,
  diffLayout,
  focusedChangedPath,
  sourceModalPath,
  onDiffLayout,
  onProjectFile,
  onCloseSource,
}: {
  record: AgentOperation | AgentAction;
  diffLayout: DiffLayout;
  focusedChangedPath?: string;
  sourceModalPath?: string;
  onDiffLayout(layout: DiffLayout): void;
  onProjectFile(path: string, changed: boolean): void;
  onCloseSource(): void;
}) {
  const params = buildOperationParams(record.arguments);
  const embedded = record.kind === 'operation' ? record.embeddedChanges : undefined;
  const heading = <>
    <HeaderIcon><AgentBrandIcon provider={record.provider} size={21} /></HeaderIcon>
    {embedded ? <HeaderIcon $color="#d57a08"><GitDiff weight="bold" /></HeaderIcon> : null}
    <Pill>{record.provider}</Pill>
    <Pill $color={record.color}>{formatMethodLabel(record.method)} {record.target}</Pill>
  </>;

  if (embedded && record.kind === 'operation') {
    const filePath = record.workingDirectory
      || record.scopeTooltip
      || embedded.files[0]?.path
      || 'Unavailable';
    return (
      <EditChangesLayout aria-label="Selected edit operation details">
        <EditHeaderPane>
          <CollapsibleCard title="Operation" accent={record.color} header={heading}>
            <PropertyGrid>
              <Label>Status:</Label><Mono>{formatStatusLabel(record.status)}</Mono>
              <Label>Started:</Label><Mono>{record.startedAt}</Mono>
              <Label>Duration:</Label><Mono>{record.duration}</Mono>
              <Label>Directory:</Label><Mono title={filePath}>{filePath}</Mono>
            </PropertyGrid>
            <CollapsibleSection contentName="raw record" defaultOpen={false} layout="stacked">
              <CollapsibleSectionSummary><Label>Raw Record</Label></CollapsibleSectionSummary>
              <CollapsibleSectionBody><JsonBody value={record.rawRecord} /></CollapsibleSectionBody>
            </CollapsibleSection>
          </CollapsibleCard>
        </EditHeaderPane>
        <ChangesInspector
          record={embedded}
          layout={diffLayout}
          focusedPath={focusedChangedPath}
          sourcePath={sourceModalPath}
          hideFilePaths
          onLayout={onDiffLayout}
          onProjectFile={onProjectFile}
          onCloseSource={onCloseSource}
        />
      </EditChangesLayout>
    );
  }

  return <Pane aria-label="Selected operation details">
    <CollapsibleCard title={record.kind === 'action' ? 'Action' : 'Operation'} accent={record.color} header={heading}>
      <PropertyGrid>
        <Label>Status:</Label><Mono>{formatStatusLabel(record.status)}</Mono>
        <Label>Started:</Label><Mono>{record.startedAt}</Mono>
        <Label>Duration:</Label><Mono>{record.duration}</Mono>
        <Label>Directory:</Label><Mono>{record.workingDirectory}</Mono>
      </PropertyGrid>
      <CollapsibleSection contentName="operation parameters" defaultOpen layout="stacked">
        <CollapsibleSectionSummary><Label>{params.title}</Label></CollapsibleSectionSummary>
        <CollapsibleSectionBody>{params.body}</CollapsibleSectionBody>
      </CollapsibleSection>
    </CollapsibleCard>
    <CollapsibleCard title="Result" accent={isErrorStatus(record.status) || Boolean(record.error) ? '#e1421f' : '#168a50'} header={<Pill $color={isErrorStatus(record.status) || record.error ? '#e1421f' : '#5cb85c'}>{formatStatusLabel(record.status)}</Pill>}>
      <FormattedResult value={record.error ?? record.result} error={isErrorStatus(record.status) || Boolean(record.error)} />
    </CollapsibleCard>
    <CollapsibleCard title="Raw Record" accent="#9a9da8" header={<Pill>JSON</Pill>}>
      <JsonBody value={record.rawRecord} />
    </CollapsibleCard>
  </Pane>;
}

function CallInspector({ record }: { record: ProgramCall }) {
  const heading = <>
    <HeaderIcon $color="#5b96a3"><FunctionIcon weight="bold" /></HeaderIcon>
    <Pill>Function</Pill>
    <Pill $color={record.color}>{record.functionName}</Pill>
  </>;
  return <Pane aria-label="Selected program call details">
    <CollapsibleCard title="Call" accent="#5b96a3" header={heading}>
      <PropertyGrid>
        <Label>Function:</Label><Mono>{record.functionName}</Mono>
        <Label>File:</Label><Mono>{record.file}</Mono>
        <Label>Started:</Label><Mono>{record.startedAt}</Mono>
        <Label>Duration:</Label><Mono>{record.duration}</Mono>
      </PropertyGrid>
      <CollapsibleSection contentName="call arguments" defaultOpen layout="stacked">
        <CollapsibleSectionSummary><Label>Arguments</Label></CollapsibleSectionSummary>
        <CollapsibleSectionBody><FormattedArguments value={record.arguments} /></CollapsibleSectionBody>
      </CollapsibleSection>
    </CollapsibleCard>
    <CollapsibleCard title="Result" accent={isErrorStatus(record.status) || Boolean(record.error) ? '#e1421f' : '#168a50'} header={<Pill $color={isErrorStatus(record.status) || record.error ? '#e1421f' : '#5cb85c'}>{formatStatusLabel(record.status)}</Pill>}>
      <FormattedResult value={record.error ?? record.result} error={isErrorStatus(record.status) || Boolean(record.error)} />
    </CollapsibleCard>
    <CollapsibleCard title="Raw Record" accent="#9a9da8" header={<Pill>JSON</Pill>}>
      <JsonBody value={record.rawRecord} />
    </CollapsibleCard>
  </Pane>;
}

const ChangesPane = styled.div`
  width: 100%; height: 100%; min-height: 0;
  display: grid; grid-template-columns: minmax(0, 1fr) 280px;
  background: ${p => p.theme.containerBackground};
`;

const ChangesMain = styled.div`min-width: 0; overflow-y: auto; padding: 16px 20px 40px;`;

const EmptyChanges = styled.div`
  padding: 24px 18px;
  border-left: 5px solid ${p => p.theme.warningColor};
  border-radius: 4px;
  background: ${p => p.theme.mainBackground};
  box-shadow: 0 2px 10px rgba(0,0,0,${p => p.theme.boxShadowAlpha});
  color: ${p => p.theme.mainLowlightColor};
  p { margin: 0 0 10px; }
`;

const EmptyTree = styled.div`
  padding: 8px;
  color: ${p => p.theme.containerWatermark};
  font-size: 12.5px;
`;
const Toolbar = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px; padding: 8px 10px;
  border-radius: 4px; background: ${p => p.theme.mainBackground};
  box-shadow: 0 2px 8px rgba(0,0,0,.16);
`;
const Segmented = styled.div`display: flex; flex-shrink: 0; border: 1px solid ${p => p.theme.containerBorder}; border-radius: 4px; overflow: hidden;`;
const Segment = styled.button<{ $active: boolean }>`
  border: 0; border-right: 1px solid ${p => p.theme.containerBorder};
  padding: 6px 10px; cursor: pointer; font-weight: bold;
  background: ${p => p.$active ? p.theme.primaryInputBackground : p.theme.mainBackground};
  color: ${p => p.$active ? p.theme.primaryInputColor : p.theme.mainColor};
  &:last-child { border-right: 0; }
`;
const Summary = styled.span`
  min-width: 0; margin-left: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ${p => p.theme.titleTextFamily}; font-weight: bold; color: ${p => p.theme.mainLowlightColor};
`;

const PathPill = styled(Pill)`
  flex: 1 1 auto;
  min-width: 0;
  max-width: min(56vw, 480px);
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 12.5px;
  font-weight: 400;
`;

const FileCard = styled.section<{ $collapsed: boolean }>`
  margin-bottom: ${p => p.$collapsed ? '10px' : '18px'};
  padding: 0 0 1px;
  border-left: 5px solid ${p => p.theme.warningColor}; border-radius: 4px;
  background: ${p => p.theme.mainBackground}; box-shadow: 0 2px 10px rgba(0,0,0,${p => p.theme.boxShadowAlpha});
  scroll-margin-top: 16px;
  transition: margin .1s;
  > header {
    display: flex; justify-content: flex-end; align-items: center; gap: 8px;
    padding: 13px 14px; color: ${p => p.theme.containerWatermark};
    ${p => !p.$collapsed && css`margin-bottom: 0;`}
  }
  > header ${PathPill} {
    flex: 1 1 auto;
  }
  > header h2 {
    margin: 0;
    font-family: ${p => p.theme.titleTextFamily}; font-size: 17px; font-weight: bold;
    text-transform: uppercase; white-space: nowrap; cursor: pointer;
  }
`;

const FileCardToggle = styled.button`
  margin: 0 -6px 0 -3px;
  padding: 4px 8px;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  &:hover, &:focus { outline: 0; color: ${p => p.theme.popColor}; }
`;

const Tree = styled.aside`
  min-width: 0; overflow: auto; padding: 14px 10px;
  border-left: 1px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.mainBackground};
  h2 { margin: 2px 8px 13px; font-family: ${p => p.theme.titleTextFamily}; font-size: 17px; font-weight: bold; text-transform: uppercase; color: ${p => p.theme.containerWatermark}; text-align: right; }
`;
const TreeFile = styled.button<{ $changed: boolean; $depth: number }>`
  width: 100%; display: flex; align-items: center; gap: 6px;
  padding: 5px 6px 5px ${p => 8 + p.$depth * 13}px;
  border: 0; background: transparent; color: ${p => p.theme.mainColor}; cursor: pointer; text-align: left;
  font-family: ${p => p.theme.fontFamily}; font-size: 12.5px;
  &:hover, &:focus { outline: none; background: ${p => p.theme.mainLowlightBackground}; }
  ${p => p.$changed && css`font-weight: bold;`}
  span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
const TreeFolder = styled.button<{ $depth: number }>`
  width: 100%;
  display: flex; align-items: center; gap: 6px;
  padding: 6px 6px 3px ${p => 8 + p.$depth * 13}px;
  border: 0;
  background: transparent;
  color: ${p => p.theme.mainLowlightColor}; font-size: 12.5px; font-weight: bold;
  font-family: ${p => p.theme.fontFamily};
  cursor: pointer;
  text-align: left;
  &:hover, &:focus { outline: none; background: ${p => p.theme.mainLowlightBackground}; color: ${p => p.theme.mainColor}; }
`;
const ChangeBadge = styled.span<{ $change?: ChangedFile['change'] }>`
  min-width: 52px;
  text-align: right;
  font-size: 11px;
  color: ${p => !p.$change ? 'transparent' : p.$change === 'deleted' ? p.theme.popColor : p.$change === 'added' ? '#168a50' : p.theme.warningColor};
  font-family: ${p => p.theme.fontFamily};
  font-weight: bold;
`;

const Overlay = styled.div`
  position: fixed; z-index: 1000; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: 34px; background: rgba(30,32,40,.58);
`;
const Modal = styled.section`
  width: min(980px, 92vw); height: min(720px, 88vh); display: flex; flex-direction: column;
  border-radius: 4px; background: ${p => p.theme.mainBackground}; box-shadow: 0 8px 36px rgba(0,0,0,.45); overflow: hidden;
  > header { min-height: 58px; display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding: 12px 16px; color: ${p => p.theme.containerWatermark}; }
  > header h2 { font-family: ${p => p.theme.titleTextFamily}; font-size: 19px; font-weight: bold; text-transform: uppercase; }
  > div { flex: 1; min-height: 0; padding: 0 20px 20px; }
`;
const Close = styled.button`border: 0; background: none; cursor: pointer; color: inherit; &:hover, &:focus { color: ${p => p.theme.popColor}; outline: none; }`;
const SourceEditor = styled.div`
  height: 100%;
  min-height: 0;
  > div { height: 100%; margin: 0; }
`;

function changeLabel(change: ChangedFile['change']) {
  return change === 'added' ? 'Added'
    : change === 'deleted' ? 'Deleted'
      : change === 'renamed' ? 'Renamed'
        : 'Modified';
}

interface ProjectTreeNode {
  name: string;
  path: string;
  file?: ProjectFile;
  children: ProjectTreeNode[];
}

function buildProjectTree(files: ProjectFile[]): ProjectTreeNode[] {
  const root: ProjectTreeNode = { name: '', path: '', children: [] };
  for (const file of files) {
    let parent = root;
    const parts = file.path.split('/');
    parts.forEach((part, index) => {
      let node = parent.children.find(child => child.name === part);
      if (!node) {
        node = {
          name: part,
          path: parts.slice(0, index + 1).join('/'),
          children: [],
        };
        parent.children.push(node);
      }
      if (index === parts.length - 1) node.file = file;
      parent = node;
    });
  }
  const sort = (nodes: ProjectTreeNode[]): ProjectTreeNode[] => nodes
    .sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name))
    .map(node => ({ ...node, children: sort(node.children) }));
  return sort(root.children);
}

function CollapsibleFileCard({ file, layout, defaultCollapsed, hidePath, cardRef }: {
  file: ChangedFile;
  layout: DiffLayout;
  defaultCollapsed: boolean;
  hidePath?: boolean;
  cardRef(node: HTMLElement | null): void;
}) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const fullPath = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
  const displayPath = file.previousPath
    ? `${formatDisplayPath(file.previousPath, 24)} → ${formatDisplayPath(file.path, 24)}`
    : formatDisplayPath(file.path);
  return (
    <FileCard ref={cardRef} $collapsed={collapsed} aria-expanded={!collapsed}>
      <header>
        <HeaderIcon $color="#d57a08"><GitDiff weight="bold" /></HeaderIcon>
        <Pill $color={file.change === 'deleted' ? '#e1421f' : file.change === 'added' ? '#5cb85c' : '#f1971f'}>{changeLabel(file.change)}</Pill>
        {hidePath ? null : <PathPill title={fullPath}>{displayPath}</PathPill>}
        <h2 onClick={() => setCollapsed(current => !current)}>File Change</h2>
        <FileCardToggle
          type="button"
          onClick={() => setCollapsed(current => !current)}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${file.path}`}
        >
          {collapsed ? <CaretDown weight="bold" /> : <CaretUp weight="bold" />}
        </FileCardToggle>
      </header>
      {collapsed ? null : <DiffViewer file={file} layout={layout} />}
    </FileCard>
  );
}

function ProjectTreeRows({ nodes, depth, collapsedPaths, onToggleFolder, onProjectFile }: {
  nodes: ProjectTreeNode[];
  depth: number;
  collapsedPaths: Set<string>;
  onToggleFolder(path: string): void;
  onProjectFile(path: string, changed: boolean): void;
}) {
  return <>
    {nodes.map(node => node.file ? (
      <TreeFile
        key={node.path}
        type="button"
        $changed={Boolean(node.file.change)}
        $depth={depth}
        title={node.file.path}
        data-project-path={node.file.path}
        onClick={() => onProjectFile(node.file!.path, Boolean(node.file!.change))}
      >
        <FileCode size={15} />
        <span>{node.name}</span>
        <ChangeBadge $change={node.file.change}>{node.file.change ? changeLabel(node.file.change) : '·'}</ChangeBadge>
      </TreeFile>
    ) : (
      <React.Fragment key={node.path}>
        <TreeFolder
          type="button"
          $depth={depth}
          aria-expanded={!collapsedPaths.has(node.path)}
          onClick={() => onToggleFolder(node.path)}
        >
          {collapsedPaths.has(node.path) ? <CaretRight size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
          <Folder size={15} weight="fill" />
          <span>{node.name}</span>
        </TreeFolder>
        {!collapsedPaths.has(node.path) ? (
          <ProjectTreeRows
            nodes={node.children}
            depth={depth + 1}
            collapsedPaths={collapsedPaths}
            onToggleFolder={onToggleFolder}
            onProjectFile={onProjectFile}
          />
        ) : null}
      </React.Fragment>
    ))}
  </>;
}

function SourceModal({ file, onClose }: { file: ProjectFile; onClose(): void }) {
  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  return <Overlay role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <Modal role="dialog" aria-modal="true" aria-label={`Source for ${file.path}`}>
      <header><HeaderIcon><FileCode weight="bold" /></HeaderIcon><Pill>{file.path}</Pill><h2>Source</h2><Close type="button" onClick={onClose} aria-label="Close source"><X size={22} /></Close></header>
      <div><SourceEditor><CodeViewer value={file.source} language={file.language} expanded /></SourceEditor></div>
    </Modal>
  </Overlay>;
}

function ChangesInspector({ record, layout, focusedPath, sourcePath, hideFilePaths, onLayout, onProjectFile, onCloseSource }: {
  record: CodeChanges;
  layout: DiffLayout;
  focusedPath?: string;
  sourcePath?: string;
  hideFilePaths?: boolean;
  onLayout(layout: DiffLayout): void;
  onProjectFile(path: string, changed: boolean): void;
  onCloseSource(): void;
}) {
  const refs = React.useRef(new Map<string, HTMLElement>());
  const [collapsedFolders, setCollapsedFolders] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => { if (focusedPath) refs.current.get(focusedPath)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [focusedPath]);
  const modalFile = record.projectFiles.find(file => file.path === sourcePath);
  const projectTree = React.useMemo(() => buildProjectTree(record.projectFiles), [record.projectFiles]);
  const toggleFolder = React.useCallback((path: string) => {
    setCollapsedFolders(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  return <ChangesPane aria-label="Code changes details">
    <ChangesMain>
      <Toolbar>
        <Segmented aria-label="Diff layout">
          <Segment type="button" $active={layout === 'unified'} onClick={() => onLayout('unified')}>UNIFIED</Segment>
          <Segment type="button" $active={layout === 'split'} onClick={() => onLayout('split')}>SPLIT</Segment>
        </Segmented>
        <Summary>{record.files.length} FILES · {record.summary}</Summary>
      </Toolbar>
      {record.files.length === 0 ? (
        <EmptyChanges>
          <p>No file-level patch is available for this change.</p>
          <Mono>{record.summary}</Mono>
        </EmptyChanges>
      ) : record.files.map((file, index) => (
        <CollapsibleFileCard
          key={`${file.path}:${index}`}
          file={file}
          layout={layout}
          defaultCollapsed={index > 0}
          hidePath={hideFilePaths}
          cardRef={node => { if (node) refs.current.set(file.path, node); else refs.current.delete(file.path); }}
        />
      ))}
    </ChangesMain>
    <Tree aria-label="Project directory">
      <h2>Project Files</h2>
      {projectTree.length === 0 ? (
        <EmptyTree>No files recorded</EmptyTree>
      ) : (
        <ProjectTreeRows
          nodes={projectTree}
          depth={0}
          collapsedPaths={collapsedFolders}
          onToggleFolder={toggleFolder}
          onProjectFile={onProjectFile}
        />
      )}
    </Tree>
    {modalFile && !modalFile.change ? <SourceModal file={modalFile} onClose={onCloseSource} /> : null}
  </ChangesPane>;
}

export function Inspector({ record, diffLayout, focusedChangedPath, sourceModalPath, onDiffLayout, onProjectFile, onCloseSource }: {
  record?: PreviewRecord;
  diffLayout: DiffLayout;
  focusedChangedPath?: string;
  sourceModalPath?: string;
  onDiffLayout(layout: DiffLayout): void;
  onProjectFile(path: string, changed: boolean): void;
  onCloseSource(): void;
}) {
  if (!record) return <Pane><ResultBox>Select an activity record to inspect it.</ResultBox></Pane>;
  if (record.kind === 'operation' || record.kind === 'action') {
    return (
      <OperationInspector
        record={record}
        diffLayout={diffLayout}
        focusedChangedPath={focusedChangedPath}
        sourceModalPath={sourceModalPath}
        onDiffLayout={onDiffLayout}
        onProjectFile={onProjectFile}
        onCloseSource={onCloseSource}
      />
    );
  }
  if (record.kind === 'call') return <CallInspector record={record} />;
  if (record.kind === 'network') return <HttpDetailsPane event={record.event} />;
  if (record.kind === 'changes') {
    return <ChangesInspector record={record} layout={diffLayout} focusedPath={focusedChangedPath} sourcePath={sourceModalPath} onLayout={onDiffLayout} onProjectFile={onProjectFile} onCloseSource={onCloseSource} />;
  }
  return <Pane><ResultBox>Unsupported activity record.</ResultBox></Pane>;
}
