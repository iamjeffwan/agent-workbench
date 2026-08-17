import * as React from 'react';
import { ClipboardText, FileText } from '@phosphor-icons/react';
import { styled } from '../upstream/theme';
import type {
  HistoryTurnSummary,
  WorkbenchResultReview,
  WorkbenchReviewEvidence,
  WorkbenchValidationCheckResult,
} from './workbench-data';

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

const Panel = styled.section<{ $accent?: string }>`
  max-width: 980px;
  margin: 0 auto 18px;
  padding: 20px;
  border-left: 5px solid ${p => p.$accent ?? '#6284fa'};
  border-radius: 4px;
  background: ${p => p.theme.mainBackground};
  box-shadow: 0 2px 10px rgba(0,0,0,${p => p.theme.boxShadowAlpha});
`;

const PanelHeader = styled.header`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  h2 { margin: 0; font-family: ${p => p.theme.titleTextFamily}; font-size: 18px; text-transform: uppercase; }
`;

const Status = styled.span<{ $status: string }>`
  margin-left: auto;
  padding: 5px 8px 3px;
  border-radius: 4px;
  color: ${p => p.theme.mainColor};
  background: ${p => p.$status === 'error' ? '#f5cbc3' : p.$status === 'warning' ? '#f8e5b7' : p.$status === 'idle' ? '#e0e1e5' : '#cdebd9'};
  font-weight: bold;
  text-transform: uppercase;
`;

const Facts = styled.dl`
  margin: 0;
  display: grid;
  grid-template-columns: minmax(130px, auto) minmax(0, 1fr);
  gap: 9px 16px;
  dt { color: ${p => p.theme.containerWatermark}; font-family: ${p => p.theme.titleTextFamily}; text-transform: uppercase; }
  dd { min-width: 0; margin: 0; overflow-wrap: anywhere; font-family: ${p => p.theme.monoFontFamily}; }
`;

const Section = styled.section`
  margin-top: 22px;
  h3 { margin: 0 0 10px; font-family: ${p => p.theme.titleTextFamily}; font-size: 14px; text-transform: uppercase; }
`;

const Rows = styled.div`
  display: grid;
  gap: 8px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 10px 12px;
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 4px;
`;

const RowTitle = styled.strong`
  display: block;
  overflow-wrap: anywhere;
`;

const CommandLine = styled.code`
  display: block;
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const RowMeta = styled.span`
  display: block;
  margin-top: 4px;
  color: ${p => p.theme.mainLowlightColor};
  font-size: 12px;
  overflow-wrap: anywhere;
`;

const ResultText = styled.pre`
  max-height: 160px;
  margin: 8px 0 0;
  padding: 8px 10px;
  overflow: auto;
  border-left: 3px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.mainLowlightBackground};
  color: ${p => p.theme.mainColor};
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const Empty = styled(Panel)`
  color: ${p => p.theme.mainLowlightColor};
  p { margin: 8px 0 0; }
`;

export function SourcesPage({
  selectedTurns,
  reviewsByTurn,
}: {
  selectedTurns: HistoryTurnSummary[];
  reviewsByTurn: Record<string, WorkbenchResultReview>;
}) {
  return <Page aria-label="Workbench sources">
    <Header>
      <h1>Sources</h1>
      <p>Result review for the selected turn</p>
    </Header>
    {selectedTurns.length === 0 ? (
      <Empty $accent="#9a9da8">
        <PanelHeader><ClipboardText size={23} /><h2>Result Review</h2><Status $status="idle">No turn</Status></PanelHeader>
        <p>Select a turn in History to review its execution result, validation checks, and evidence.</p>
      </Empty>
    ) : selectedTurns.map(turn => (
      <ReviewPanel
        key={`${turn.sessionId}:${turn.id}`}
        turn={turn}
        review={reviewsByTurn[`${turn.sessionId}:${turn.id}`] ?? null}
      />
    ))}
  </Page>;
}

function ReviewPanel({ turn, review }: { turn: HistoryTurnSummary; review: WorkbenchResultReview | null }) {
  if (!review) {
    return <Empty $accent="#9a9da8">
      <PanelHeader><ClipboardText size={23} /><h2>Result Review</h2><Status $status="idle">Unavailable</Status></PanelHeader>
      <Facts><dt>Turn</dt><dd>{turn.id}</dd><dt>Reason</dt><dd>No review was generated for this turn.</dd></Facts>
    </Empty>;
  }

  const status = statusTone(review.status);
  return <Panel $accent={status === 'error' ? '#e1421f' : status === 'warning' ? '#d49b23' : '#5b96a3'}>
    <PanelHeader>
      <ClipboardText size={23} />
      <h2>Result Review</h2>
      <Status $status={status}>{review.status}</Status>
    </PanelHeader>
    <Facts>
      <dt>Turn</dt><dd>{turn.id}</dd>
      <dt>Prompt</dt><dd>{turn.userInput || 'No user prompt captured'}</dd>
      <dt>Profile</dt><dd>{review.profileId ?? 'Not specified'}</dd>
      <dt>Checked events</dt><dd>{review.checkedEventCount}</dd>
      <dt>Evidence</dt><dd>{review.evidence.length}</dd>
      <dt>Findings</dt><dd>{review.findings.length}</dd>
    </Facts>
    <Section>
      <h3>Validation checks</h3>
      {review.checks.length > 0 ? <Rows>{review.checks.map(check => <CheckRow key={check.id} check={check} />)}</Rows> : <RowMeta>No validation checks were recorded for this turn.</RowMeta>}
    </Section>
    <Section>
      <h3>Findings</h3>
      {review.findings.length > 0 ? <Rows>{review.findings.map(finding => <Row key={finding.id}>
        <div>
          <RowTitle>{finding.title}</RowTitle>
          <RowMeta>{finding.summary}</RowMeta>
          {finding.expected || finding.actual ? <RowMeta>Expected: {finding.expected ?? '—'} · Actual: {finding.actual ?? '—'}</RowMeta> : null}
          <RowMeta>Events: {finding.eventIds.length} · Evidence: {finding.evidenceIds.length}</RowMeta>
        </div>
        <Status $status={finding.severity === 'error' ? 'error' : 'warning'}>{finding.severity}</Status>
      </Row>)}</Rows> : <RowMeta>No findings. The checks above are the recorded review result.</RowMeta>}
    </Section>
    <Section>
      <h3>Evidence</h3>
      {review.evidence.length > 0 ? <Rows>{review.evidence.map(evidence => <EvidenceRow key={evidence.id} evidence={evidence} />)}</Rows> : <RowMeta>No evidence was recorded for this turn.</RowMeta>}
    </Section>
  </Panel>;
}

function CheckRow({ check }: { check: WorkbenchValidationCheckResult }) {
  const command = check.command || check.label || check.id;
  const result = check.result || check.summary || resultLabel(check.status);
  const duration = check.durationMs != null ? ` · ${check.durationMs} ms` : '';
  return <Row>
    <div>
      <RowTitle><CommandLine>{command}</CommandLine></RowTitle>
      <RowMeta>{check.kind || 'validation'}{duration}</RowMeta>
      <ResultText>{result}</ResultText>
      {check.artifacts?.length ? <RowMeta>Artifacts: {check.artifacts.length}</RowMeta> : null}
    </div>
    <Status $status={statusTone(check.status)}>{check.status}</Status>
  </Row>;
}

function EvidenceRow({ evidence }: { evidence: WorkbenchReviewEvidence }) {
  const source = evidence.source?.line ? `line ${evidence.source.line}` : evidence.source?.path || '';
  return <Row>
    <div>
      <RowTitle>{evidence.summary}</RowTitle>
      <RowMeta>{evidence.kind}{source ? ` · ${source}` : ''}</RowMeta>
    </div>
    <FileText size={18} />
  </Row>;
}

function resultLabel(status: WorkbenchValidationCheckResult['status']): string {
  if (status === 'passed') return 'Completed successfully.';
  if (status === 'failed') return 'The command failed.';
  if (status === 'not_run') return 'The command was not run.';
  if (status === 'incomplete') return 'The command did not finish.';
  return 'The command result is unknown.';
}

function statusTone(status: string): 'ready' | 'error' | 'warning' | 'idle' {
  if (status === 'failed') return 'error';
  if (status === 'incomplete') return 'warning';
  if (status === 'unknown' || status === 'not_run') return 'idle';
  return 'ready';
}
