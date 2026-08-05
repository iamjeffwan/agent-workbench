import * as React from 'react';
import { FolderOpen, Plugs } from '@phosphor-icons/react';
import { styled } from '../upstream/theme';
import { AgentBrandIcon } from './AgentBrandIcon';
import type { WorkbenchAdapterState, WorkbenchSourceCoverage, WorkbenchState } from './workbench-data';

const Page = styled.main`
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 28px;
  box-sizing: border-box;
  background: ${p => p.theme.containerBackground};
  color: ${p => p.theme.mainColor};
`;

const Header = styled.header`
  max-width: 980px;
  margin: 0 auto 20px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 20px;
  h1 {
    margin: 0;
    font-family: ${p => p.theme.titleTextFamily};
    font-size: 25px;
    text-transform: uppercase;
  }
  p { margin: 0; color: ${p => p.theme.mainLowlightColor}; }
`;

const Grid = styled.div`
  max-width: 980px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  @media (max-width: 980px) { grid-template-columns: 1fr; }
`;

const Card = styled.section<{ $accent: string }>`
  min-width: 0;
  padding: 19px 20px 20px;
  border-left: 5px solid ${p => p.$accent};
  border-radius: 4px;
  background: ${p => p.theme.mainBackground};
  box-shadow: 0 2px 10px rgba(0,0,0,${p => p.theme.boxShadowAlpha});
`;

const CardHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 18px;
  color: ${p => p.theme.containerWatermark};
  h2 {
    margin: 0;
    font-family: ${p => p.theme.titleTextFamily};
    font-size: 18px;
    text-transform: uppercase;
  }
`;

const Icon = styled.span`
  margin-right: auto;
  display: inline-flex;
  align-items: center;
  font-size: 23px;
`;

const Status = styled.span<{ $status: string }>`
  padding: 5px 8px 3px;
  border-radius: 4px;
  color: ${p => p.theme.mainColor};
  background: ${p => p.$status === 'error' ? '#f5cbc3' : p.$status === 'idle' ? '#e0e1e5' : '#cdebd9'};
  font-weight: bold;
  text-transform: uppercase;
`;

const Facts = styled.dl`
  margin: 0;
  display: grid;
  grid-template-columns: minmax(110px, auto) minmax(0, 1fr);
  gap: 9px 16px;
  dt {
    color: ${p => p.theme.containerWatermark};
    font-family: ${p => p.theme.titleTextFamily};
    text-transform: uppercase;
  }
  dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    font-family: ${p => p.theme.monoFontFamily};
  }
`;

export function SourcesPage({ state }: { state: WorkbenchState }) {
  const cursor = state.adapters.cursor ?? {};
  const codex = state.adapters.codex ?? {};
  const unassigned = state.turns.filter(turn => turn.type === 'turn' && !turn.generationId).length;
  return <Page aria-label="Workbench sources">
    <Header>
      <h1>Sources</h1>
      <p>Project-bound observation status</p>
    </Header>
    <Grid>
      <Card $accent="#6284fa">
        <CardHeader>
          <Icon><FolderOpen weight="fill" /></Icon>
          <Status $status={state.projectRoot ? 'ready' : 'idle'}>{state.projectRoot ? 'Open' : 'Idle'}</Status>
          <h2>Project</h2>
        </CardHeader>
        <Facts>
          <dt>Root</dt><dd>{state.projectRoot ?? 'No project selected'}</dd>
          <dt>Observation</dt><dd>{state.observation ? 'Installed' : 'Unavailable'}</dd>
          <dt>Unassigned</dt><dd>{unassigned} turns</dd>
        </Facts>
      </Card>
      <AdapterCard provider="Codex" adapter={codex} coverage={state.sources.codex} accent="#111111" />
      <AdapterCard provider="Cursor" adapter={cursor} coverage={state.sources.cursor} accent="#7547d8" />
      <EvidenceCard title="Runtime" coverage={state.sources.runtime} accent="#5b96a3" />
      <EvidenceCard title="Changes" coverage={state.sources.changes} accent="#f1971f" />
      <Card $accent={state.fileBus.status === 'error' ? '#e1421f' : '#5b96a3'}>
        <CardHeader>
          <Icon><Plugs weight="bold" /></Icon>
          <Status $status={state.fileBus.status}>{state.fileBus.status}</Status>
          <h2>File Bus</h2>
        </CardHeader>
        <Facts>
          <dt>Directory</dt><dd>{state.fileBus.directory ?? 'Not watching'}</dd>
          <dt>Last refresh</dt><dd>{formatTime(state.fileBus.lastRefreshAt)}</dd>
          <dt>Files</dt><dd>{Object.values(state.files).filter(Boolean).length}</dd>
          <dt>Error</dt><dd>{state.fileBus.error ?? 'None'}</dd>
        </Facts>
      </Card>
    </Grid>
  </Page>;
}

function AdapterCard({ provider, adapter, coverage, accent }: {
  provider: 'Codex' | 'Cursor';
  adapter: WorkbenchAdapterState;
  coverage?: WorkbenchSourceCoverage;
  accent: string;
}) {
  const status = adapter.status ?? 'idle';
  return <Card $accent={status === 'error' ? '#e1421f' : accent}>
    <CardHeader>
      <Icon><AgentBrandIcon provider={provider} size={23} /></Icon>
      <Status $status={status}>{status}</Status>
      <h2>{provider}</h2>
    </CardHeader>
    <Facts>
      <CoverageFacts coverage={coverage} />
      <dt>Conversations</dt><dd>{adapter.sessionCount ?? '—'}</dd>
      <dt>Last event</dt><dd>{formatTime(adapter.lastEventAt ?? adapter.lastSyncAt)}</dd>
      <dt>Error</dt><dd>{adapter.error ?? 'None'}</dd>
      <dt>Last hook error</dt><dd>{typeof adapter.lastHookError === 'string' ? adapter.lastHookError : 'None'}</dd>
    </Facts>
  </Card>;
}

function EvidenceCard({ title, coverage, accent }: {
  title: string;
  coverage?: WorkbenchSourceCoverage;
  accent: string;
}) {
  return <Card $accent={accent}>
    <CardHeader>
      <Icon><Plugs weight="bold" /></Icon>
      <Status $status="ready">Ready</Status>
      <h2>{title}</h2>
    </CardHeader>
    <Facts>
      <CoverageFacts coverage={coverage} />
      {coverage?.unassigned !== undefined ? <><dt>Unassigned</dt><dd>{coverage.unassigned}</dd></> : null}
    </Facts>
  </Card>;
}

function CoverageFacts({ coverage }: { coverage?: WorkbenchSourceCoverage }) {
  return <>
    <dt>Source records</dt><dd>{coverage?.sourceRecords ?? 0}</dd>
    <dt>Turn assigned</dt><dd>{coverage?.assignedToTurn ?? 0}</dd>
    <dt>Project assigned</dt><dd>{coverage?.assignedToProject ?? 0}</dd>
    <dt>Normalized</dt><dd>{coverage?.normalized ?? 0}</dd>
    <dt>Rendered</dt><dd>{coverage?.rendered ?? 0}</dd>
    <dt>Hidden</dt><dd>{coverage?.hidden ?? 0}</dd>
    <dt>Unknown</dt><dd>{coverage?.unknown ?? 0}</dd>
    <dt>Invalid</dt><dd>{coverage?.invalid ?? 0}</dd>
  </>;
}

function formatTime(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'Never';
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Date(time).toLocaleString();
}
