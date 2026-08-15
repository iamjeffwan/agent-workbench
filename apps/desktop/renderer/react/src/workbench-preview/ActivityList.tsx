import * as React from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { VariableSizeList, type ListChildComponentProps } from 'react-window';
import { CaretDown, CaretRight, Function as FunctionIcon, GitDiff, Globe, TerminalWindow } from '@phosphor-icons/react';
import { faHistory } from '@fortawesome/free-solid-svg-icons/faHistory';
import { faChrome } from '@fortawesome/free-brands-svg-icons/faChrome';
import { faFolderOpen } from '@fortawesome/free-solid-svg-icons/faFolderOpen';
import { faPause } from '@fortawesome/free-solid-svg-icons/faPause';
import { faPlay } from '@fortawesome/free-solid-svg-icons/faPlay';
import { faQuestion } from '@fortawesome/free-solid-svg-icons/faQuestion';
import { faTimes } from '@fortawesome/free-solid-svg-icons/faTimes';
import { faCheck } from '@fortawesome/free-solid-svg-icons/faCheck';
import { faSpinner } from '@fortawesome/free-solid-svg-icons/faSpinner';
import { faSave } from '@fortawesome/free-solid-svg-icons/faSave';
import { faTrashAlt } from '@fortawesome/free-regular-svg-icons/faTrashAlt';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { styled, css } from '../upstream/theme';
import type { PreviewRecord } from './types';
import type { ActivityFocus, PreviewState, VisibleRow } from './view-model';
import { getRowHeight, getRowSpacing } from './view-model';
import { formatMethodLabel, formatStatusLabel } from './display-labels';
import { AgentBrandIcon } from './AgentBrandIcon';

const CompatibleAutoSizer = AutoSizer as unknown as React.ComponentType<{
  children(size: { height: number; width: number }): React.ReactNode;
}>;
const CompatibleList = VariableSizeList as unknown as React.ComponentType<any>;
const FocusableListOuter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (props, ref) => <div {...props} ref={ref} tabIndex={0} />,
);

const Container = styled.section`
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: ${p => p.theme.mainBackground};
`;

const Grid = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  background: ${p => p.theme.containerBackground};
  font-size: ${p => p.theme.textSize};

  > div > div[tabindex='0']:focus { outline: none; }
  > div > div[tabindex='0'] { overflow-x: hidden !important; }
`;

const PassiveMessage = styled.div<{ $error?: boolean }>`
  position: absolute;
  z-index: 1;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: ${p => p.$error ? p.theme.popColor : p.theme.containerWatermark};
  font-size: ${p => p.theme.textSize};
  text-align: center;
  pointer-events: none;
`;

const Columns = styled.div`
  height: 38px;
  flex: 0 0 38px;
  display: grid;
  grid-template-columns: 8px 105px 72px 58px minmax(120px, .9fr) minmax(160px, 1.25fr);
  align-items: center;
  gap: 10px;
  padding-right: 18px;
  border-bottom: 1px solid ${p => p.theme.containerBorder};
  font-weight: bold;
  background: ${p => p.theme.mainBackground};
  z-index: 2;

  > span {
    min-width: 0;
    padding: 5px 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    line-height: 18px;
  }
`;

const Marker = styled.span<{ $color: string; $visible: boolean }>`
  width: 5px;
  height: 100%;
  color: ${p => p.$color};
  background: currentColor;
  border-left: 5px solid ${p => p.$visible ? p.theme.containerBackground : 'transparent'};
  box-sizing: content-box;
  opacity: ${p => p.$visible ? 1 : 0};
`;

const Row = styled.div<{
  $kind: PreviewRecord['kind'];
  $depth: number;
  $gapTop: 0 | 2;
  $gapBottom: 0 | 2;
}>`
  display: grid;
  grid-template-columns: 8px 105px 72px 58px minmax(120px, .9fr) minmax(160px, 1.25fr);
  align-items: center;
  gap: 10px;
  padding-right: 18px;
  cursor: pointer;
  user-select: none;
  border-width: ${p => p.$gapTop}px 0 ${p => p.$gapBottom}px;
  border-style: solid;
  border-color: transparent;
  background-clip: padding-box;
  background-color: ${p => p.theme.mainBackground};

  ${p => (p.$kind === 'operation' || p.$kind === 'changes') && p.$depth === 0 && css`
    position: relative;
    z-index: 1;
    font-weight: 600;
    background-color: ${p.theme.mainLowlightBackground};
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.82),
      inset 0 -1px 0 rgba(0,0,0,0.18),
      0 2px 5px rgba(0,0,0,0.13),
      0 0 15px rgba(0,0,0,0.1);
  `}
  ${p => p.$kind === 'changes' && p.$depth > 0 && css`
    font-weight: 600;
  `}
  ${p => p.$depth > 0 && css`
    font-size: 13.5px;
  `}

  &.selected {
    background-color: ${p => p.theme.highlightBackground};
    color: ${p => p.theme.highlightColor};
    font-weight: bold;
    outline: thin dotted ${p => p.theme.popColor};
    outline-offset: -2px;
    box-shadow: none;
  }

  &:hover ${Marker}, &.selected ${Marker} {
    border-left-color: currentColor;
  }
`;

const TurnHeader = styled.div`
  height: 58px;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-rows: 20px 22px;
  column-gap: 9px;
  align-content: center;
  padding: 7px 14px 7px 12px;
  border-left: 5px solid #7057d9;
  border-bottom: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.mainLowlightBackground};
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);

  .turn-label {
    color: #7057d9;
    font: 700 11px ${p => p.theme.titleTextFamily};
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .turn-meta {
    color: ${p => p.theme.mainLowlightColor};
    font-size: 11px;
    white-space: nowrap;
  }

  .turn-prompt {
    grid-column: 1 / -1;
    min-width: 0;
    overflow: hidden;
    color: ${p => p.theme.mainColor};
    font-size: 13px;
    line-height: 21px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const Cell = styled.span`
  min-width: 0;
  padding: 2px 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  line-height: 20px;
`;

const MethodCell = styled(Cell)`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const MethodLeading = styled.span`
  flex: 0 0 14px;
  width: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

const ExpandButton = styled.button`
  border: 0;
  background: none;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: inherit;
`;

const Status = styled(Cell)<{ $status: string; $icon?: boolean }>`
  display: ${p => p.$icon ? 'flex' : 'block'};
  align-items: center;
  justify-content: ${p => p.$icon ? 'center' : 'flex-start'};
  text-align: ${p => p.$icon ? 'center' : 'left'};
  color: ${p => {
    const status = p.$status.toLowerCase();
    if (status === 'error' || status === 'failed') return p.theme.popColor;
    if (status === 'running' || status === 'pending' || status === 'changed' || status === 'observed') {
      return p.theme.warningColor;
    }
    if (/^2/.test(p.$status) || status === 'ok' || status === 'completed') return '#168a50';
    return p.theme.mainLowlightColor;
  }};
  font-weight: bold;
  font-variant-numeric: tabular-nums;
`;

const StatusIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  font-size: 13px;
  line-height: 1;
`;

const SourceIcons = styled.span`
  display: grid;
  grid-template-columns: 16px 18px;
  align-items: center;
  justify-items: center;
  column-gap: 4px;
`;

const SourceLeading = styled.span`
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

function statusIcon(status: string): { icon: IconDefinition; spin?: boolean } | null {
  const normalized = status.toLowerCase();
  if (normalized === 'completed' || normalized === 'ok' || normalized === 'changed' || normalized === 'observed') {
    return { icon: faCheck };
  }
  if (normalized === 'pending' || normalized === 'running') return { icon: faSpinner, spin: true };
  if (normalized === 'failed' || normalized === 'error') return { icon: faTimes };
  if (normalized === 'unknown') return { icon: faQuestion };
  return null;
}

function StatusCell({ record, depth }: { record: PreviewRecord; depth: number }) {
  const label = formatStatusLabel(record.status);
  const useSymbol = depth === 0 && (record.kind === 'operation' || record.kind === 'action' || record.kind === 'changes');
  if (useSymbol) {
    const icon = statusIcon(record.status);
    if (icon) {
      return (
        <Status $status={record.status} $icon title={label} aria-label={label}>
          <StatusIcon>
            <FontAwesomeIcon icon={icon.icon} spin={icon.spin} />
          </StatusIcon>
        </Status>
      );
    }
  }
  return <Status $status={record.status} title={label}>{label}</Status>;
}

const SourceCell = styled(Cell)`
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 18px;
`;

const Footer = styled.div`
  order: 1;
  min-height: 48px;
  width: 100%;
  padding-left: 2px;
  box-sizing: border-box;
  background-color: ${p => p.theme.mainBackground};
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const SearchFilterBox = styled.div`
  position: relative;
  flex-grow: 1;
  min-width: 0;
  overflow: hidden;
  border-radius: 4px;
  border: 1px solid ${p => p.theme.containerBorder};
  box-shadow: inset 0 2px 4px 1px rgba(0, 0, 0, 0.2);
  background-color: ${p => p.theme.inputBackground};
  color: ${p => p.theme.highlightColor};
  font-size: ${p => p.theme.textSize};
  display: flex;
  margin: 4px 0 4px 4px;

  &:focus-within { border-color: ${p => p.theme.highlightColor}; }
`;

const FilterInput = styled.input`
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  padding: 4px 32px 4px 6px;
  border: none;
  outline: none;
  background-color: ${p => p.theme.inputBackground};
  color: ${p => p.theme.inputColor};
  font-size: ${p => p.theme.textSize};
`;

const HelpButton = styled.button`
  position: absolute;
  z-index: 10;
  top: 0;
  right: 0;
  bottom: 0;
  width: 30px;
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: ${p => p.theme.mainColor};
  cursor: pointer;

  &:hover, &:focus { outline: none; color: ${p => p.theme.popColor}; }
`;

const RequestCounter = styled.div`
  margin-left: auto;
  padding: 0 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1;

  .count {
    font-family: ${p => p.theme.monoFontFamily};
    font-size: 20px;
    font-weight: bold;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .label {
    margin-top: 2px;
    font-size: ${p => p.theme.textSize};
    font-weight: lighter;
    opacity: 0.8;
  }
`;

const ViewMode = styled.div<{ $mode: 'live' | 'paused' | 'historical' }>`
  min-width: 70px;
  margin-left: 8px;
  padding: 5px 8px;
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 3px;
  color: ${p => p.$mode === 'live' ? '#168a50' : p.$mode === 'historical' ? p.theme.warningColor : p.theme.mainLowlightColor};
  background: ${p => p.theme.mainLowlightBackground};
  font-family: ${p => p.theme.titleTextFamily};
  font-size: 11px;
  font-weight: bold;
  text-align: center;
  text-transform: uppercase;
`;

const FocusSelect = styled.select`
  height: 30px;
  min-width: 92px;
  margin: 4px 0 4px 6px;
  padding: 3px 24px 3px 7px;
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 4px;
  background: ${p => p.theme.inputBackground};
  color: ${p => p.theme.inputColor};
  font-family: ${p => p.theme.titleTextFamily};
  font-size: 12px;
  font-weight: bold;
  text-transform: uppercase;
  &:focus { outline: thin dotted ${p => p.theme.popColor}; outline-offset: -2px; }
`;

const ButtonsContainer = styled.div`
  display: flex;
`;

const IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 10px;
  border: none;
  background: none;
  color: ${p => p.theme.mainColor};
  font-size: ${p => p.theme.textSize};
  cursor: pointer;

  &:hover, &:focus { outline: none; color: ${p => p.theme.popColor}; }
`;

const ProjectButton = styled(IconButton)`
  max-width: 150px;
  display: flex;
  align-items: center;
  gap: 6px;
  span {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

function SourceIcon({ record }: { record: PreviewRecord }) {
  if (record.kind === 'operation' || record.kind === 'action') {
    const hasEmbedded = record.kind === 'operation' && Boolean(record.embeddedChanges);
    return (
      <SourceIcons>
        <SourceLeading>
          {hasEmbedded ? <GitDiff weight="bold" color="#d57a08" size={15} /> : null}
        </SourceLeading>
        <AgentBrandIcon provider={record.provider} />
      </SourceIcons>
    );
  }
  if (record.kind === 'call') return <FunctionIcon weight="bold" color="#5b96a3" />;
  if (record.kind === 'changes') return <GitDiff weight="bold" color="#d57a08" />;
  if (record.event.source === 'Chrome') return <FontAwesomeIcon icon={faChrome} color="#1da462" />;
  if (record.event.source === 'Electron') return <TerminalWindow weight="fill" color="#5b96a3" />;
  return <Globe weight="bold" color="#6284fa" />;
}

export interface ActivityTurnSection {
  id: string;
  label: string;
  userInput: string;
  startedAt: string | null;
  status: string;
  rows: VisibleRow<PreviewRecord>[];
}

type ActivityListItem =
  | { kind: 'turn'; section: ActivityTurnSection }
  | { kind: 'record'; row: VisibleRow<PreviewRecord>; spacing: ReturnType<typeof getRowSpacing> };

interface RowData {
  items: ActivityListItem[];
  state: PreviewState;
  onSelected(id: string): void;
  onToggle(id: string): void;
}

function ActivityRow({ index, style, data: untypedData }: ListChildComponentProps) {
  const data = untypedData as RowData;
  const item = data.items[index];
  if (item.kind === 'turn') {
    return <TurnHeader style={style} role="row" aria-label={item.section.label}>
      <span className="turn-label">{item.section.label}</span>
      <span />
      <span className="turn-meta">{formatTurnMeta(item.section.startedAt, item.section.status)}</span>
      <span className="turn-prompt" title={item.section.userInput || 'No user prompt captured'}>
        {item.section.userInput || 'No user prompt captured'}
      </span>
    </TurnHeader>;
  }
  const { record, depth } = item.row;
  const selected = record.id === data.state.selectedId;
  const expanded = data.state.expandedOperationIds.includes(record.id);
  const spacing = item.spacing;
  return (
    <Row
      style={style}
      className={selected ? 'selected active' : ''}
      $kind={record.kind}
      $depth={depth}
      $gapTop={spacing.top}
      $gapBottom={spacing.bottom}
      role="row"
      aria-selected={selected}
      data-record-id={record.id}
      onMouseDown={event => event.currentTarget.parentElement?.parentElement?.focus()}
      onClick={() => data.onSelected(record.id)}
    >
      <Marker $color={record.color} $visible={record.kind !== 'operation' && !(record.kind === 'changes' && depth === 0)} />
      <MethodCell title={record.method}>
        <MethodLeading>
          {record.kind === 'operation' && record.children.length > 0 ? (
            <ExpandButton
              type="button"
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${record.method}`}
              onClick={event => { event.stopPropagation(); data.onToggle(record.id); }}
            >
              {expanded ? <CaretDown size={13} weight="bold" /> : <CaretRight size={13} weight="bold" />}
            </ExpandButton>
          ) : null}
        </MethodLeading>
        {formatMethodLabel(record.method)}
      </MethodCell>
      <StatusCell record={record} depth={depth} />
      <SourceCell title={record.source}><SourceIcon record={record} /></SourceCell>
      <Cell title={record.kind === 'operation' && record.scopeTooltip ? record.scopeTooltip : record.scope}>
        {record.scope}
      </Cell>
      <Cell title={record.target}>{record.target}</Cell>
    </Row>
  );
}

export function ActivityList({
  rows,
  historySections,
  state,
  message,
  messageIsError = false,
  projectRoot,
  following,
  viewMode,
  onSelected,
  onToggle,
  onQuery,
  onFocus,
  onOpenProject,
  onToggleFollowing,
  onHistory,
}: {
  rows: VisibleRow<PreviewRecord>[];
  historySections?: ActivityTurnSection[];
  state: PreviewState;
  message?: string;
  messageIsError?: boolean;
  projectRoot: string | null;
  following: boolean;
  viewMode: 'live' | 'paused' | 'historical';
  onSelected(id: string): void;
  onToggle(id: string): void;
  onQuery(query: string): void;
  onFocus(focus: ActivityFocus): void;
  onOpenProject?(): void;
  onToggleFollowing(): void;
  onHistory(): void;
}) {
  const hasQuery = state.query.length > 0;
  const projectName = projectRoot ? projectRoot.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || projectRoot : 'Open project';
  const items = React.useMemo<ActivityListItem[]>(() => historySections
    ? historySections.flatMap(section => [
        { kind: 'turn' as const, section },
        ...section.rows.map((row, index) => ({
          kind: 'record' as const,
          row,
          spacing: getRowSpacing(section.rows, index),
        })),
      ])
    : rows.map((row, index) => ({
        kind: 'record' as const,
        row,
        spacing: getRowSpacing(rows, index),
      })), [historySections, rows]);

  return (
    <Container aria-label="Preview activity list">
      <Footer>
        <SearchFilterBox>
          <FilterInput
            value={state.query}
            onChange={event => onQuery(event.target.value)}
            placeholder="Filter by operation, source, scope or target"
            aria-label="Filter activity"
          />
          <HelpButton
            type="button"
            title={hasQuery ? 'Clear filter' : 'Open filtering help'}
            aria-label={hasQuery ? 'Clear filter' : 'Open filtering help'}
            onClick={() => { if (hasQuery) onQuery(''); }}
          >
            <FontAwesomeIcon icon={hasQuery ? faTimes : faQuestion} />
          </HelpButton>
        </SearchFilterBox>
        <FocusSelect
          value={state.focus}
          onChange={event => onFocus(event.target.value as ActivityFocus)}
          aria-label="Activity focus"
          title="Activity focus"
        >
          <option value="all">All</option>
          <option value="agent">Agent</option>
          <option value="functions">Functions</option>
          <option value="tests">Tests</option>
          <option value="changes">Changes</option>
          <option value="search">Search</option>
          <option value="requests">Requests</option>
          <option value="errors">Errors</option>
        </FocusSelect>
        <ViewMode $mode={viewMode}>{viewMode === 'historical' ? 'History' : viewMode}</ViewMode>
        <RequestCounter>
          <span className="count">{rows.length}</span>
          <span className="label">records</span>
        </RequestCounter>
        <ButtonsContainer>
          <IconButton
            type="button"
            title={following ? 'Pause live view' : 'Start from now'}
            aria-label={following ? 'Pause live view' : 'Start from now'}
            onClick={onToggleFollowing}
            disabled={!projectRoot && !rows.length}
          ><FontAwesomeIcon icon={following ? faPause : faPlay} /></IconButton>
          <IconButton type="button" title="Open history" aria-label="Open history" onClick={onHistory}>
            <FontAwesomeIcon icon={faHistory} />
          </IconButton>
          <IconButton type="button" title="Export activity" aria-label="Export activity"><FontAwesomeIcon icon={faSave} /></IconButton>
          <ProjectButton
            type="button"
            title={projectRoot ?? 'Open project'}
            aria-label={projectRoot ? `Current project: ${projectRoot}` : 'Open project'}
            onClick={onOpenProject}
          ><FontAwesomeIcon icon={faFolderOpen} /><span>{projectName}</span></ProjectButton>
          <IconButton type="button" title="Clear activity" aria-label="Clear activity"><FontAwesomeIcon icon={faTrashAlt} /></IconButton>
        </ButtonsContainer>
      </Footer>
      <Columns role="row">
        <span />
        <span>Method</span>
        <span>Status</span>
        <span>Source</span>
        <span>Scope</span>
        <span>Target</span>
      </Columns>
      <Grid role="grid">
        {message ? <PassiveMessage $error={messageIsError}>{message}</PassiveMessage> : null}
        <CompatibleAutoSizer>
          {({ height, width }) => (
            <CompatibleList
              height={height}
              width={width}
              itemCount={items.length}
              itemSize={(index: number) => items[index].kind === 'turn' ? 58 : getRowHeight(items[index].row)}
              itemData={{ items, state, onSelected, onToggle }}
              itemKey={(index: number) => items[index].kind === 'turn' ? `turn:${items[index].section.id}` : items[index].row.record.id}
              overscanCount={8}
              outerElementType={FocusableListOuter}
            >
              {ActivityRow}
            </CompatibleList>
          )}
        </CompatibleAutoSizer>
      </Grid>
    </Container>
  );
}

function formatTurnMeta(startedAt: string | null, status: string): string {
  const parsed = startedAt ? Date.parse(startedAt) : Number.NaN;
  const time = Number.isNaN(parsed)
    ? 'Unknown time'
    : new Date(parsed).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${time} · ${status}`;
}
