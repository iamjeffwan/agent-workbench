import * as React from 'react';
import { CheckCircle, ClipboardText, FileSearch } from '@phosphor-icons/react';
import { styled } from '../upstream/theme';
import type {
  HistoryTurnSummary,
  ReviewAnnotationInput,
  ReviewChangeEvent,
  ReviewEvidenceResolution,
  ReviewRecord,
  ReviewResult,
  ReviewStartInput,
  ReviewSummary,
  WorkbenchResultReview,
} from './workbench-data';

const Page = styled.main`
  width: 100%; height: 100%; overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr);
  background: ${p => p.theme.containerBackground}; color: ${p => p.theme.mainColor};
`;
const Header = styled.header`
  display: flex; align-items: center; gap: 16px; padding: 24px 28px 18px; border-bottom: 1px solid ${p => p.theme.containerBorder};
  h1 { margin: 0; font-family: ${p => p.theme.titleTextFamily}; font-size: 25px; text-transform: uppercase; }
  p { margin: 0; color: ${p => p.theme.mainLowlightColor}; }
  button { margin-left: auto; }
`;
const Layout = styled.div`
  min-height: 0; display: grid; grid-template-columns: minmax(250px, 300px) minmax(0, 1fr); overflow: hidden;
  @media (max-width: 900px) { grid-template-columns: 1fr; grid-template-rows: minmax(180px, 35%) minmax(0, 1fr); }
`;
const Sidebar = styled.aside`
  min-height: 0; overflow: auto; border-right: 1px solid ${p => p.theme.containerBorder}; padding: 12px;
  @media (max-width: 900px) { border-right: 0; border-bottom: 1px solid ${p => p.theme.containerBorder}; }
`;
const CaseButton = styled.button<{ $selected: boolean }>`
  width: 100%; margin: 0 0 8px; padding: 12px; border: 1px solid ${p => p.$selected ? p.theme.highlightColor : p.theme.containerBorder};
  border-left: 4px solid ${p => p.$selected ? p.theme.popColor : p.theme.containerBorder}; background: ${p => p.$selected ? p.theme.mainBackground : p.theme.mainLowlightBackground};
  color: inherit; text-align: left; cursor: pointer;
  strong, span { display: block; } strong { font-size: 14px; } span { margin-top: 4px; color: ${p => p.theme.mainLowlightColor}; font-size: 12px; }
`;
const Detail = styled.section`min-width: 0; min-height: 0; overflow: auto; padding: 22px 28px 38px;`;
const Panel = styled.section`
  max-width: 1060px; margin: 0 auto 16px; padding: 18px; border: 1px solid ${p => p.theme.containerBorder};
  border-left: 5px solid ${p => p.theme.highlightColor}; background: ${p => p.theme.mainBackground}; box-shadow: 0 2px 10px rgba(0,0,0,${p => p.theme.boxShadowAlpha});
`;
const PanelHeading = styled.header`
  display: flex; align-items: flex-start; gap: 11px; h2 { margin: 0; font-family: ${p => p.theme.titleTextFamily}; font-size: 19px; }
  p { margin: 5px 0 0; color: ${p => p.theme.mainLowlightColor}; } > div { min-width: 0; } > span { margin-left: auto; }
`;
const Badge = styled.span<{ $tone: string }>`
  display: inline-flex; align-items: center; min-height: 24px; padding: 0 8px; border-radius: 3px; font-size: 12px; font-weight: 700; text-transform: uppercase;
  color: ${p => p.theme.mainColor}; background: ${p => p.$tone === 'failed' || p.$tone === 'critical' || p.$tone === 'high' ? '#f5cbc3' : p.$tone === 'running' || p.$tone === 'medium' ? '#f8e5b7' : p.$tone === 'completed' || p.$tone === 'low' ? '#cdebd9' : '#e0e1e5'};
`;
const ActionButton = styled.button`
  min-height: 32px; padding: 6px 11px; border: 1px solid ${p => p.theme.highlightColor}; border-radius: 3px; background: ${p => p.theme.mainBackground}; color: ${p => p.theme.mainColor}; cursor: pointer;
  &:hover, &:focus-visible { outline: none; background: ${p => p.theme.mainLowlightBackground}; }
  &:disabled { opacity: .55; cursor: default; }
`;
const Facts = styled.dl`
  display: grid; grid-template-columns: minmax(135px, auto) minmax(0, 1fr); gap: 8px 16px; margin: 16px 0 0;
  dt { color: ${p => p.theme.containerWatermark}; font-family: ${p => p.theme.titleTextFamily}; text-transform: uppercase; }
  dd { min-width: 0; margin: 0; overflow-wrap: anywhere; font-family: ${p => p.theme.monoFontFamily}; font-size: 13px; }
`;
const Finding = styled.article`
  margin-top: 12px; padding: 15px; border: 1px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.mainBackground};
  h3 { margin: 0; font-size: 16px; } p { margin: 7px 0; line-height: 1.5; } small { color: ${p => p.theme.mainLowlightColor}; }
`;
const FindingMeta = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const EvidenceList = styled.div`display: grid; gap: 7px; margin-top: 12px;`;
const EvidenceButton = styled.button`
  width: 100%; padding: 10px; border: 1px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.mainLowlightBackground}; color: inherit; text-align: left; cursor: pointer;
  strong, span { display: block; } span { margin-top: 4px; color: ${p => p.theme.mainLowlightColor}; font-size: 12px; overflow-wrap: anywhere; }
`;
const ReviewForm = styled.form`
  display: grid; gap: 9px; margin-top: 15px; padding-top: 14px; border-top: 1px solid ${p => p.theme.containerBorder};
  label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; }
  select, input, textarea { width: 100%; box-sizing: border-box; padding: 7px; border: 1px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.inputBackground}; color: ${p => p.theme.inputColor}; font: inherit; }
  textarea { min-height: 62px; resize: vertical; } button { justify-self: start; }
`;
const EvidencePanel = styled(Panel)<{ $availability: string }>`border-left-color: ${p => p.$availability === 'changed' ? '#d49b23' : p.$availability === 'unavailable' ? '#e1421f' : '#168a50'};`;
const Code = styled.pre`
  max-height: 330px; margin: 13px 0 0; padding: 11px; overflow: auto; background: ${p => p.theme.mainLowlightBackground}; border-left: 3px solid ${p => p.theme.containerBorder};
  color: ${p => p.theme.mainColor}; font: 12px/1.5 ${p => p.theme.monoFontFamily}; white-space: pre-wrap; overflow-wrap: anywhere;
`;
const Notice = styled.div`
  max-width: 760px; margin: 14vh auto; padding: 24px; border-left: 5px solid ${p => p.theme.containerBorder}; background: ${p => p.theme.mainBackground}; text-align: center;
  strong, span { display: block; } span { margin-top: 8px; color: ${p => p.theme.mainLowlightColor}; }
`;
const InlineError = styled.p`margin: 10px 0 0; color: ${p => p.theme.popColor};`;

export function SourcesPage({
  projectRoot,
  selectedTurns,
  reviewsByTurn,
  reviewUpdates,
  focusedCaseId,
  startReview,
  listReviews,
  getReview,
  resolveEvidence,
  appendAnnotation,
  onFocusedCase,
  onOpenEvidenceLocation,
}: {
  projectRoot: string | null;
  selectedTurns: HistoryTurnSummary[];
  reviewsByTurn: Record<string, WorkbenchResultReview>;
  reviewUpdates: ReviewChangeEvent[];
  focusedCaseId: string | null;
  startReview(input: ReviewStartInput): Promise<ReviewResult<{ caseId: string } | null>>;
  listReviews(projectRoot?: string | null): Promise<ReviewResult<ReviewSummary[]>>;
  getReview(projectRoot: string | null, caseId: string): Promise<ReviewResult<ReviewRecord | null>>;
  resolveEvidence(projectRoot: string | null, caseId: string, evidenceId: string): Promise<ReviewResult<ReviewEvidenceResolution | null>>;
  appendAnnotation(projectRoot: string | null, input: ReviewAnnotationInput): Promise<ReviewResult<ReviewRecord | null>>;
  onFocusedCase(caseId: string | null): void;
  onOpenEvidenceLocation(location: ReviewEvidenceResolution['location']): void;
}) {
  const [cases, setCases] = React.useState<ReviewSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = React.useState<string | null>(focusedCaseId);
  const [record, setRecord] = React.useState<ReviewRecord | null>(null);
  const [evidence, setEvidence] = React.useState<ReviewEvidenceResolution | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);

  const refresh = React.useCallback(async (preferredCaseId?: string | null) => {
    if (!projectRoot) { setCases([]); setRecord(null); return; }
    setLoading(true);
    const result = await listReviews(projectRoot);
    setLoading(false);
    if (result.status !== 'ready') { setError(result.error); return; }
    setError(null);
    setCases(result.data);
    const next = preferredCaseId ?? selectedCaseId ?? result.data[0]?.caseId ?? null;
    if (next && result.data.some(item => item.caseId === next)) {
      setSelectedCaseId(next);
      onFocusedCase(next);
    } else {
      setSelectedCaseId(null);
      setRecord(null);
    }
  }, [listReviews, onFocusedCase, projectRoot, selectedCaseId]);

  React.useEffect(() => { void refresh(focusedCaseId); }, [focusedCaseId, projectRoot]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (reviewUpdates.length === 0) return;
    void refresh(focusedCaseId);
  }, [reviewUpdates]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!projectRoot || !selectedCaseId) return;
    let active = true;
    void getReview(projectRoot, selectedCaseId).then(result => {
      if (!active) return;
      if (result.status === 'ready') { setRecord(result.data); setError(null); }
      else setError(result.error);
    });
    return () => { active = false; };
  }, [getReview, projectRoot, selectedCaseId, reviewUpdates]);

  const startSelected = async () => {
    if (!projectRoot || selectedTurns.length === 0 || starting) return;
    setStarting(true); setError(null);
    const result = await startReview({ source: 'turns', projectRoot, sessionId: selectedTurns[0].sessionId, turnIds: selectedTurns.map(item => item.id) });
    setStarting(false);
    if (result.status !== 'ready' || !result.data) { setError(result.error); return; }
    setSelectedCaseId(result.data.caseId); onFocusedCase(result.data.caseId); await refresh(result.data.caseId);
  };

  const selectCase = (caseId: string) => { setEvidence(null); setSelectedCaseId(caseId); onFocusedCase(caseId); };
  const openEvidence = async (evidenceId: string) => {
    if (!projectRoot || !selectedCaseId) return;
    const result = await resolveEvidence(projectRoot, selectedCaseId, evidenceId);
    if (result.status !== 'ready') { setError(result.error); return; }
    setEvidence(result.data);
  };

  return <Page aria-label="Review workspace">
    <Header>
      <div><h1>Review</h1><p>Evidence-backed review for the current project</p></div>
      {selectedTurns.length > 0 ? <ActionButton type="button" onClick={() => { void startSelected(); }} disabled={starting}>{starting ? 'Starting…' : `Start review · ${selectedTurns.length} turn${selectedTurns.length === 1 ? '' : 's'}`}</ActionButton> : null}
    </Header>
    <Layout>
      <Sidebar aria-label="Review records">
        {loading && cases.length === 0 ? <small>Loading reviews…</small> : null}
        {cases.map(item => <CaseButton key={item.caseId} type="button" $selected={item.caseId === selectedCaseId} onClick={() => selectCase(item.caseId)}>
          <strong>{sourceLabel(item.sourceType)}</strong>
          <span>{statusLabel(item.runStatus)} · {item.judgementCount} findings · {item.reviewedCount} reviewed</span>
          <span>{formatDate(item.createdAt)}</span>
        </CaseButton>)}
        {!loading && cases.length === 0 ? <small>{projectRoot ? 'No review has been started for this project.' : 'Open a project to browse reviews.'}</small> : null}
      </Sidebar>
      <Detail>
        {error ? <InlineError role="alert">{error}</InlineError> : null}
        {!projectRoot ? <Notice><strong>Open a project</strong><span>Reviews are available after a project is selected.</span></Notice>
          : !selectedCaseId ? <Notice><ClipboardText size={30} /><strong>Start a review</strong><span>Select turns in History, or open a ready task in Library, then start an evidence-backed review.</span></Notice>
            : record ? <ReviewDetail record={record} reviewsByTurn={reviewsByTurn} onEvidence={openEvidence} onAnnotation={async input => {
              const result = await appendAnnotation(projectRoot, input);
              if (result.status !== 'ready') { setError(result.error); return; }
              setRecord(result.data); setEvidence(null); await refresh(record.reviewCase.caseId);
            }} />
              : <Notice><strong>Loading review…</strong></Notice>}
        {evidence ? <EvidenceDetail value={evidence} onOpen={() => onOpenEvidenceLocation(evidence.location)} /> : null}
      </Detail>
    </Layout>
  </Page>;
}

function ReviewDetail({ record, reviewsByTurn, onEvidence, onAnnotation }: { record: ReviewRecord; reviewsByTurn: Record<string, WorkbenchResultReview>; onEvidence(evidenceId: string): void; onAnnotation(input: ReviewAnnotationInput): Promise<void> }) {
  const latestRun = [...record.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).at(0) ?? null;
  const judgements = latestRun ? record.judgements.filter(item => item.runId === latestRun.runId) : [];
  const baseline = record.reviewCase.turns.flatMap(turn => reviewsByTurn[`${turn.sessionId}:${turn.turnId}`]?.findings ?? []);
  return <>
    <Panel>
      <PanelHeading><ClipboardText size={23} /><div><h2>Review result</h2><p>{record.reviewCase.turns.length} selected turn{record.reviewCase.turns.length === 1 ? '' : 's'} · {sourceLabel(record.reviewCase.sourceType)}</p></div><Badge $tone={latestRun?.status ?? 'queued'}>{statusLabel(latestRun?.status ?? 'queued')}</Badge></PanelHeading>
      <Facts>
        <dt>Model</dt><dd>{latestRun?.invocation.model ?? 'Waiting to start'}</dd>
        <dt>Prompt / policy</dt><dd>{latestRun ? `${latestRun.invocation.promptVersion} / ${latestRun.invocation.reviewPolicyVersion}` : '—'}</dd>
        <dt>Started</dt><dd>{latestRun ? formatDate(latestRun.startedAt) : formatDate(record.reviewCase.createdAt)}</dd>
        <dt>Duration</dt><dd>{latestRun?.latencyMs != null ? `${Math.round(latestRun.latencyMs)} ms` : '—'}</dd>
      </Facts>
      {latestRun?.failureReason ? <InlineError role="alert">{latestRun.failureReason}</InlineError> : null}
    </Panel>
    {baseline.length > 0 ? <Panel><PanelHeading><CheckCircle size={23} /><div><h2>Baseline checks</h2><p>{baseline.length} deterministic finding{baseline.length === 1 ? '' : 's'} from the selected turns.</p></div></PanelHeading></Panel> : null}
    {latestRun?.status === 'running' || latestRun?.status === 'queued' ? <Notice><strong>Review in progress</strong><span>The result will appear here when the model has finished and evidence has been verified.</span></Notice> : null}
    {latestRun?.status === 'completed' && judgements.length === 0 ? <Notice><CheckCircle size={30} /><strong>No model findings</strong><span>The review completed without an evidence-backed finding.</span></Notice> : null}
    {judgements.map(judgement => <Finding key={judgement.judgementId}>
      <FindingMeta><Badge $tone={judgement.severity}>{judgement.severity}</Badge><Badge $tone="idle">{judgement.category.replaceAll('_', ' ')}</Badge><small>{Math.round(judgement.confidence * 100)}% confidence · {judgement.reviewability.replaceAll('_', ' ')}</small></FindingMeta>
      <h3>{judgement.title}</h3><p>{judgement.summary}</p><p><strong>Impact:</strong> {judgement.impact}</p><p><strong>Recommendation:</strong> {judgement.recommendation}</p><p><small>Alternative explanation: {judgement.alternativeExplanation}</small></p>
      <EvidenceList>{record.evidence.filter(item => item.judgementId === judgement.judgementId).map(item => <EvidenceButton key={item.evidenceId} type="button" onClick={() => onEvidence(item.evidenceId)}><strong>{item.targetType.replaceAll('_', ' ')} · {item.targetId}</strong><span>{item.description}</span></EvidenceButton>)}</EvidenceList>
      <AnnotationForm judgementId={judgement.judgementId} caseId={record.reviewCase.caseId} annotations={record.annotations.filter(item => item.judgementId === judgement.judgementId)} onSubmit={onAnnotation} />
    </Finding>)}
  </>;
}

function AnnotationForm({ caseId, judgementId, annotations, onSubmit }: { caseId: string; judgementId: string; annotations: ReviewRecord['annotations']; onSubmit(input: ReviewAnnotationInput): Promise<void> }) {
  const [verdict, setVerdict] = React.useState<ReviewAnnotationInput['verdict']>('correct');
  const [reason, setReason] = React.useState('');
  const [missingIssue, setMissingIssue] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const latest = annotations.at(-1);
  return <ReviewForm onSubmit={event => { event.preventDefault(); if (saving) return; setSaving(true); void onSubmit({ caseId, judgementId, verdict, reason: reason.trim() || undefined, ...(missingIssue.trim() ? { missingIssue: missingIssue.trim() } : {}) }).finally(() => { setSaving(false); setReason(''); setMissingIssue(''); }); }}>
    <label>Human review<select value={verdict} onChange={event => setVerdict(event.target.value as ReviewAnnotationInput['verdict'])}><option value="correct">Correct</option><option value="incorrect">Incorrect</option></select></label>
    <label>Reason (optional)<textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain the confirmation or rejection" /></label>
    <label>Missing issue (optional)<textarea value={missingIssue} onChange={event => setMissingIssue(event.target.value)} placeholder="Record an issue the review missed" /></label>
    {latest ? <small>Latest review: {latest.verdict.replaceAll('_', ' ')} · {formatDate(latest.createdAt)}</small> : <small>No human review has been saved yet.</small>}
    <ActionButton type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save review'}</ActionButton>
  </ReviewForm>;
}

function EvidenceDetail({ value, onOpen }: { value: ReviewEvidenceResolution; onOpen(): void }) {
  return <EvidencePanel $availability={value.availability}>
    <PanelHeading><FileSearch size={23} /><div><h2>Evidence</h2><p>{value.evidence.targetType.replaceAll('_', ' ')} · {value.evidence.targetId}</p></div><Badge $tone={value.availability === 'available' ? 'completed' : value.availability}>{value.availability}</Badge></PanelHeading>
    {value.message ? <InlineError>{value.message}</InlineError> : null}
    <Facts><dt>Recorded hash</dt><dd>{value.evidence.contentHash ?? 'Not recorded'}</dd><dt>Current hash</dt><dd>{value.currentContentHash ?? 'Not available'}</dd></Facts>
    <Code>{value.content || value.evidence.cachedExcerpt || 'No content is available.'}</Code>
    {value.location.kind !== 'inline' ? <ActionButton type="button" onClick={onOpen}>{value.location.kind === 'activity' ? 'Open activity in View' : 'Open project file in View'}</ActionButton> : null}
  </EvidencePanel>;
}

function sourceLabel(value: ReviewSummary['sourceType']) { return value === 'task' ? 'Task review' : value === 'manual_turn_selection' ? 'Selected turns' : value.replaceAll('_', ' '); }
function statusLabel(value: string) { return value.replaceAll('_', ' '); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
