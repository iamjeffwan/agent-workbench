import * as React from 'react';
import { X } from '@phosphor-icons/react';
import { styled, css } from '../upstream/theme';
import { AgentBrandIcon } from './AgentBrandIcon';
import type { ObservableActivity, ObservableTurnSummary } from './turn-model';

const Overlay = styled.div`
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: flex;
  justify-content: flex-end;
  padding: 24px;
  box-sizing: border-box;
  background: rgba(30,32,40,.14);
`;

const Modal = styled.section`
  width: min(480px, calc(100vw - 48px));
  height: calc(100vh - 48px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  background: ${p => p.theme.mainBackground};
  color: ${p => p.theme.mainColor};
  box-shadow: 0 8px 36px rgba(0,0,0,.45);
  overflow: hidden;
`;

const Header = styled.header`
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 11px 14px 9px 18px;
  color: ${p => p.theme.containerWatermark};
  border-bottom: 1px solid ${p => p.theme.containerBorder};
  h1 {
    margin: 0;
    font-family: ${p => p.theme.titleTextFamily};
    font-size: 19px;
    font-weight: bold;
    text-transform: uppercase;
  }
`;

const SelectionCount = styled.span`
  margin-right: auto;
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 12px;
  color: ${p => p.theme.mainLowlightColor};
`;

const Close = styled.button`
  padding: 6px;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  &:hover, &:focus { outline: 0; color: ${p => p.theme.popColor}; }
`;

const Filters = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
  padding: 10px 12px;
  border-bottom: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.mainLowlightBackground};
  select, input {
    min-width: 0;
    height: 30px;
    box-sizing: border-box;
    border: 1px solid ${p => p.theme.containerBorder};
    border-radius: 3px;
    padding: 4px 6px;
    background: ${p => p.theme.inputBackground};
    color: ${p => p.theme.inputColor};
    font: inherit;
  }
  input { grid-column: 1 / -1; }
  select:focus, input:focus { outline: 1px solid ${p => p.theme.highlightColor}; }
`;

const HistoryBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 18px;
  background: ${p => p.theme.containerBackground};
`;

const Day = styled.section`
  h2 {
    position: sticky;
    z-index: 2;
    top: 0;
    margin: 0 -12px 6px;
    padding: 10px 16px 8px;
    background: ${p => p.theme.containerBackground};
    color: ${p => p.theme.containerWatermark};
    font-family: ${p => p.theme.titleTextFamily};
    font-size: 14px;
    text-transform: uppercase;
    box-shadow: 0 1px 0 ${p => p.theme.containerBorder};
  }
`;

const TurnButton = styled.button<{ $selected: boolean; $status: string }>`
  width: 100%;
  margin: 0 0 5px;
  padding: 10px 11px 9px;
  display: grid;
  grid-template-columns: 55px 23px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  border: 0;
  border-left: 4px solid ${p => p.$status === 'ERROR' ? p.theme.popColor : p.$status === 'RUNNING' ? p.theme.warningColor : '#5cb85c'};
  border-radius: 3px;
  background: ${p => p.theme.mainBackground};
  color: ${p => p.theme.mainColor};
  box-shadow: 0 1px 4px rgba(0,0,0,.12);
  cursor: pointer;
  text-align: left;
  &:hover, &:focus { outline: none; box-shadow: 0 2px 7px rgba(0,0,0,.2); }
  ${p => p.$selected && css`
    outline: thin dotted ${p.theme.popColor};
    outline-offset: -3px;
    background: ${p.theme.highlightBackground};
  `}
`;

const Time = styled.span`
  padding-top: 2px;
  font-family: ${p => p.theme.monoFontFamily};
  font-variant-numeric: tabular-nums;
`;

const TurnFacts = styled.span`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const ActivityLine = styled.strong`
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const TargetLine = styled.span`
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: ${p => p.theme.mainLowlightColor};
  font-size: 12.5px;
`;

const Empty = styled.div`
  padding: 45px 18px;
  color: ${p => p.theme.containerWatermark};
  text-align: center;
`;

const Footer = styled.footer`
  padding: 9px 13px;
  border-top: 1px solid ${p => p.theme.containerBorder};
  color: ${p => p.theme.mainLowlightColor};
  font-size: 12px;
  text-align: right;
`;

const activities: ObservableActivity[] = ['SEARCH', 'FUNCTION', 'PROCESS', 'REQUEST', 'WRITE', 'DIFF', 'TEST', 'ERROR'];

export function HistoryModal({ turns, selectedTurnIds, onSelected, onClose }: {
  turns: ObservableTurnSummary[];
  selectedTurnIds: string[];
  onSelected(turnIds: string[]): void;
  onClose(): void;
}) {
  const [source, setSource] = React.useState('ALL');
  const [activity, setActivity] = React.useState('ALL');
  const [status, setStatus] = React.useState('ALL');
  const [query, setQuery] = React.useState('');
  const anchor = React.useRef<string>();
  const chronological = React.useMemo(
    () => [...turns].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)),
    [turns],
  );
  const filtered = chronological.filter(turn => {
    if (source !== 'ALL' && turn.provider.toUpperCase() !== source) return false;
    if (activity !== 'ALL' && !turn.activities.includes(activity as ObservableActivity)) return false;
    if (status !== 'ALL' && turn.status !== status) return false;
    const needle = query.trim().toLowerCase();
    return !needle || [turn.provider, turn.activities.join(' '), turn.scope, turn.target]
      .join(' ').toLowerCase().includes(needle);
  });
  const grouped = groupByDay([...filtered].reverse());

  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const choose = (turnId: string, shiftKey: boolean) => {
    if (shiftKey && anchor.current) {
      const first = chronological.findIndex(turn => turn.id === anchor.current);
      const last = chronological.findIndex(turn => turn.id === turnId);
      if (first >= 0 && last >= 0) {
        onSelected(chronological.slice(Math.min(first, last), Math.max(first, last) + 1).map(turn => turn.id));
        return;
      }
    }
    anchor.current = turnId;
    onSelected([turnId]);
  };

  return <Overlay role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <Modal role="dialog" aria-modal="true" aria-label="Activity history">
      <Header>
        <SelectionCount>{selectedTurnIds.length} selected</SelectionCount>
        <h1>History</h1>
        <Close type="button" onClick={onClose} aria-label="Close history"><X size={20} weight="bold" /></Close>
      </Header>
      <Filters>
        <select value={source} onChange={event => setSource(event.target.value)} aria-label="Filter history by source">
          <option value="ALL">All sources</option><option value="CODEX">Codex</option><option value="CURSOR">Cursor</option>
        </select>
        <select value={activity} onChange={event => setActivity(event.target.value)} aria-label="Filter history by activity">
          <option value="ALL">All activity</option>{activities.map(value => <option value={value} key={value}>{value}</option>)}
        </select>
        <select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter history by status">
          <option value="ALL">All status</option><option value="OK">OK</option><option value="ERROR">Error</option><option value="RUNNING">Running</option>
        </select>
        <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter scope, target or activity" aria-label="Filter history" />
      </Filters>
      <HistoryBody>
        {grouped.map(([day, dayTurns]) => <Day key={day}>
          <h2>{day}</h2>
          {dayTurns.map(turn => <TurnButton
            type="button"
            key={turn.id}
            $selected={selectedTurnIds.includes(turn.id)}
            $status={turn.status}
            onClick={event => choose(turn.id, event.shiftKey)}
            title={`${turn.provider} · ${turn.generationId}`}
          >
            <Time>{formatTime(turn.startedAt)}</Time>
            <AgentBrandIcon provider={turn.provider} size={20} />
            <TurnFacts>
              <ActivityLine>{turn.status} · {turn.activities.filter(value => value !== 'ERROR').join(' · ') || 'ERROR'}</ActivityLine>
              <TargetLine>{turn.scope} · {turn.target}</TargetLine>
            </TurnFacts>
          </TurnButton>)}
        </Day>)}
        {grouped.length === 0 ? <Empty>No observable turns match these filters.</Empty> : null}
      </HistoryBody>
      <Footer>Click to inspect · Shift-click to select a continuous range</Footer>
    </Modal>
  </Overlay>;
}

function groupByDay(turns: ObservableTurnSummary[]): Array<[string, ObservableTurnSummary[]]> {
  const groups = new Map<string, ObservableTurnSummary[]>();
  for (const turn of turns) {
    const day = formatDay(turn.startedAt);
    groups.set(day, [...(groups.get(day) ?? []), turn]);
  }
  return [...groups.entries()];
}

const HISTORY_DATE_LOCALE = 'en-US';

function formatDay(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(HISTORY_DATE_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(HISTORY_DATE_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
