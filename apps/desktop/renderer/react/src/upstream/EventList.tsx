/*
 * List, row, filter and footer styles copied from HTTP Toolkit UI at
 * 66488157be993c88152bf0b5964cfa1c63e0fbf5, AGPL-3.0-or-later.
 */
import * as React from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPause } from '@fortawesome/free-solid-svg-icons/faPause';
import { faLevelDownAlt } from '@fortawesome/free-solid-svg-icons/faLevelDownAlt';
import { faSave } from '@fortawesome/free-solid-svg-icons/faSave';
import { faFolderOpen } from '@fortawesome/free-solid-svg-icons/faFolderOpen';
import { faTrashAlt } from '@fortawesome/free-regular-svg-icons/faTrashAlt';
import { faQuestion } from '@fortawesome/free-solid-svg-icons/faQuestion';
import { faAtom } from '@fortawesome/free-solid-svg-icons/faAtom';
import { faChrome } from '@fortawesome/free-brands-svg-icons/faChrome';
import { faNodeJs } from '@fortawesome/free-brands-svg-icons/faNodeJs';
import { styled } from './theme';

const CompatibleAutoSizer = AutoSizer as unknown as React.ComponentType<{
  children(size: { height: number; width: number }): React.ReactNode;
}>;
const CompatibleFixedSizeList = FixedSizeList as unknown as React.ComponentType<any>;
const FocusableListOuter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (props, ref) => <div {...props} ref={ref} tabIndex={0} />,
);

export interface MockEvent {
  id: string;
  method: string;
  status: string;
  source: string;
  host: string;
  path: string;
  color: string;
}

export const mockEvents: MockEvent[] = [
  { id: '1', method: 'GET', status: '200', source: 'Chrome', host: 'api.github.com', path: '/repos/httptoolkit/httptoolkit-ui', color: '#5cb85c' },
  { id: '2', method: 'POST', status: '201', source: 'Node', host: 'api.example.com', path: '/v1/sessions', color: '#5cb85c' },
  { id: '3', method: 'GET', status: '304', source: 'Chrome', host: 'fonts.googleapis.com', path: '/css2?family=DM+Sans', color: '#818490' },
  { id: '4', method: 'OPTIONS', status: '204', source: 'Chrome', host: 'api.example.com', path: '/v1/events', color: '#6284fa' },
  { id: '5', method: 'GET', status: '200', source: 'Electron', host: 'localhost', path: '/assets/index.js', color: '#5cb85c' },
  { id: '6', method: 'POST', status: '400', source: 'Node', host: 'api.example.com', path: '/v1/validate', color: '#f1971f' },
  { id: '7', method: 'GET', status: '404', source: 'Chrome', host: 'cdn.example.com', path: '/images/avatar.png', color: '#e1421f' },
  { id: '8', method: 'PATCH', status: '200', source: 'Node', host: 'api.example.com', path: '/v1/projects/agent-workbench', color: '#5cb85c' },
  { id: '9', method: 'GET', status: '101', source: 'Chrome', host: 'stream.example.com', path: '/socket', color: '#6284fa' },
  { id: '10', method: 'PUT', status: '202', source: 'Electron', host: 'api.example.com', path: '/v1/records/10', color: '#5cb85c' },
  { id: '11', method: 'DELETE', status: '204', source: 'Node', host: 'api.example.com', path: '/v1/cache', color: '#e1421f' },
  { id: '12', method: 'GET', status: '200', source: 'Chrome', host: 'httptoolkit.com', path: '/docs/reference/view-page/', color: '#5cb85c' },
  { id: '13', method: 'POST', status: '500', source: 'Node', host: 'api.example.com', path: '/v1/process', color: '#e1421f' },
  { id: '14', method: 'GET', status: '200', source: 'Electron', host: 'localhost', path: '/health', color: '#5cb85c' },
];

const Column = styled.div`
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 3px 0;
`;

const RowMarker = styled(Column)<{ categoryColor: string }>`
  transition: color 0.2s;
  color: ${p => p.categoryColor};
  background-color: currentColor;
  flex-basis: 5px;
  flex-shrink: 0;
  flex-grow: 0;
  height: 100%;
  padding: 0;
  border-left: 5px solid ${p => p.theme.containerBackground};
  box-sizing: content-box;
`;

const EventListRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  user-select: none;
  cursor: pointer;

  &.selected {
    background-color: ${p => p.theme.highlightBackground};
    font-weight: bold;
    color: ${p => p.theme.highlightColor};
    fill: ${p => p.theme.highlightColor};

    * { color: ${p => p.theme.highlightColor}; fill: ${p => p.theme.highlightColor}; }
  }
`;

const TrafficEventListRow = styled(EventListRow)`
  background-color: ${p => p.theme.mainBackground};
  border-width: 2px 0;
  border-style: solid;
  border-color: transparent;
  background-clip: padding-box;
  box-sizing: border-box;

  &:hover ${RowMarker}, &.selected ${RowMarker} { border-color: currentColor; }
  > * { margin-right: 10px; }
`;

const Method = styled(Column)`flex-basis: 71px; flex-shrink: 0; flex-grow: 0;`;
const Status = styled(Column)`flex-basis: 45px; flex-shrink: 0; flex-grow: 0;`;
const Source = styled(Column)`
  flex-basis: 49px; flex-shrink: 0; flex-grow: 0;
  display: flex; align-items: center; justify-content: center;
`;
const SourceIcon = styled(FontAwesomeIcon)`font-size: 17px;`;
const Host = styled(Column)`flex-shrink: 1; flex-grow: 0; flex-basis: 500px;`;
const PathAndQuery = styled(Column)`flex-shrink: 1; flex-grow: 0; flex-basis: 1000px;`;
const MarkerHeader = styled.div`flex-basis: 10px; flex-shrink: 0;`;

const TableHeaderRow = styled.div`
  height: 38px;
  overflow: hidden;
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: ${p => p.theme.mainBackground};
  color: ${p => p.theme.mainColor};
  font-weight: bold;
  border-bottom: 1px solid ${p => p.theme.containerBorder};
  box-shadow: 0 0 30px rgba(0,0,0,0.2);
  padding-right: 18px;
  box-sizing: border-box;

  > div { padding: 5px 0; margin-right: 10px; min-width: 0; }
`;

const ListContainer = styled.div`
  display: block;
  flex-grow: 1;
  min-height: 0;
  position: relative;
  width: 100%;
  box-sizing: border-box;
  font-size: ${p => p.theme.textSize};

  &::after {
    content: '';
    position: absolute;
    top: 38px;
    bottom: 0;
    left: 0;
    right: 0;
    box-shadow: rgba(0,0,0,0.1) 0 0 30px inset;
    pointer-events: none;
  }

  & > div > div[tabindex="0"]:focus {
    outline: none;
  }

  & > div > div[tabindex="0"]:focus .active {
    outline: thin dotted ${p => p.theme.popColor};
    outline-offset: -1px;
  }
`;

const EmptyStateOverlay = styled.div`
  position: absolute;
  top: 38px;
  bottom: 0;
  height: auto;
  width: 100%;
  box-sizing: border-box;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: ${p => p.theme.containerWatermark};
  font-size: ${p => p.theme.loudHeadingSize};
  letter-spacing: -1px;
  line-height: 1.3;
  text-align: center;

  > svg {
    font-size: 150px;
    margin-bottom: 20px;
  }
`;

const SearchFilterBox = styled.div`
  position: relative;
  flex-grow: 1;
  min-width: 0;
  border-radius: 4px;
  border: 1px solid ${p => p.theme.containerBorder};
  box-shadow: inset 0 2px 4px 1px rgba(0,0,0,${p => p.theme.boxShadowAlpha / 2});
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
  height: 28px;
  padding: 3px 32px 4px 5px;
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
  align-items: flex-end;

  .count {
    font-size: 20px;
    font-weight: bold;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    font-family: ${p => p.theme.monoFontFamily};
  }
  .label { margin-top: -4px; font-size: ${p => p.theme.textSize}; opacity: 0.8; font-weight: lighter; }
`;

const Footer = styled.div`
  order: 1;
  min-height: 38px;
  width: 100%;
  padding-left: 2px;
  box-sizing: border-box;
  background-color: ${p => p.theme.mainBackground};
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const ButtonsContainer = styled.div`display: flex;`;
const IconButton = styled.button`
  border: none;
  background: none;
  color: ${p => p.theme.mainColor};
  font-size: ${p => p.theme.textSize};
  padding: 5px 10px;
  cursor: pointer;
  &:hover, &:focus { outline: none; color: ${p => p.theme.popColor}; }
`;

function Row({ index, style, data }: ListChildComponentProps) {
  const event = data.events[index];
  const isActive = event.id === data.selectedId;
  const sourceIcon = event.source === 'Chrome'
    ? faChrome
    : event.source === 'Node'
      ? faNodeJs
      : faAtom;
  const sourceColor = event.source === 'Chrome'
    ? '#1da462'
    : event.source === 'Node'
      ? '#3c873a'
      : '#5b96a3';

  return (
    <TrafficEventListRow
      style={style}
      className={isActive ? 'selected active' : ''}
      role="row"
      aria-selected={isActive}
      onMouseDown={(mouseEvent) => {
        mouseEvent.currentTarget.parentElement?.parentElement?.focus();
      }}
      onClick={() => data.onSelected(event)}
    >
      <RowMarker categoryColor={event.color} role="gridcell" />
      <Method role="gridcell">{event.method}</Method>
      <Status role="gridcell">{event.status}</Status>
      <Source role="gridcell" title={event.source}>
        <SourceIcon icon={sourceIcon} color={sourceColor} />
      </Source>
      <Host role="gridcell">{event.host}</Host>
      <PathAndQuery role="gridcell">{event.path}</PathAndQuery>
    </TrafficEventListRow>
  );
}

export function EventList({ selectedId, onSelected }: { selectedId: string; onSelected(event: MockEvent): void }) {
  const [query, setQuery] = React.useState('');
  const events = mockEvents.filter((event) =>
    Object.values(event).some((value) => String(value).toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <>
      <Footer>
        <SearchFilterBox>
          <FilterInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by method, host, headers, status..." aria-label="Filter intercepted traffic" />
          <HelpButton type="button" title="Open filtering docs"><FontAwesomeIcon icon={faQuestion} /></HelpButton>
        </SearchFilterBox>
        <RequestCounter><span className="count">{events.length}</span><span className="label">requests</span></RequestCounter>
        <ButtonsContainer>
          <IconButton type="button" title="Pause collecting intercepted exchanges"><FontAwesomeIcon icon={faPause} /></IconButton>
          <IconButton type="button" title="Scroll to the bottom"><FontAwesomeIcon icon={faLevelDownAlt} /></IconButton>
          <IconButton type="button" title="Export as HAR"><FontAwesomeIcon icon={faSave} /></IconButton>
          <IconButton type="button" title="Import HAR"><FontAwesomeIcon icon={faFolderOpen} /></IconButton>
          <IconButton type="button" title="Clear all"><FontAwesomeIcon icon={faTrashAlt} /></IconButton>
        </ButtonsContainer>
      </Footer>
      <ListContainer role="grid">
        <TableHeaderRow role="row">
          <MarkerHeader role="columnheader" aria-label="Category" />
          <Method role="columnheader">Method</Method>
          <Status role="columnheader">Status</Status>
          <Source role="columnheader">Source</Source>
          <Host role="columnheader">Host</Host>
          <PathAndQuery role="columnheader">Path and query</PathAndQuery>
        </TableHeaderRow>
        {events.length === 0 ? (
          <EmptyStateOverlay>
            <FontAwesomeIcon icon={faQuestion} />
            No requests match this search filter
          </EmptyStateOverlay>
        ) : (
          <CompatibleAutoSizer>{({ height, width }) => (
            <CompatibleFixedSizeList
              height={Math.max(0, height - 38)}
              width={width}
              itemCount={events.length}
              itemSize={32}
              itemData={{ events, selectedId, onSelected }}
              outerElementType={FocusableListOuter}
            >
              {Row}
            </CompatibleFixedSizeList>
          )}</CompatibleAutoSizer>
        )}
      </ListContainer>
    </>
  );
}
