import * as React from 'react';
import { CheckCircle, Key, SpinnerGap, WarningCircle } from '@phosphor-icons/react';
import { styled } from '../upstream/theme';
import type {
  ModelCallEvent,
  ModelCallSummary,
  ModelCompletion,
  ModelResult,
  ModelStatus,
} from './workbench-data';
import { parseModelCallEvents } from './model-call-format';

const Page = styled.main`
  width: 100%;
  height: 100vh;
  overflow: auto;
  padding: 42px;
  background: ${p => p.theme.containerBackground};
`;

const Panel = styled.section`
  width: min(980px, 100%);
  margin: 0 auto;
  background: ${p => p.theme.mainBackground};
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
  overflow: hidden;
`;

const History = styled.section`
  width: min(980px, 100%);
  margin: 22px auto 0;
  background: ${p => p.theme.mainBackground};
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
  overflow: hidden;
`;

const HistoryTitle = styled.h2`
  padding: 15px 18px;
  border-bottom: 1px solid ${p => p.theme.containerBorder};
  font-family: ${p => p.theme.titleTextFamily};
  font-size: ${p => p.theme.subHeadingSize};
  font-weight: 600;
`;

const HistoryGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(260px, 35%) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 480px;
  min-height: 280px;
  overflow: hidden;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    grid-template-rows: 180px minmax(0, 1fr);
    height: 620px;
  }
`;

const CallList = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  border-right: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.mainLowlightBackground};

  @media (max-width: 900px) {
    border-right: 0;
    border-bottom: 1px solid ${p => p.theme.containerBorder};
  }
`;

const CallRow = styled.button<{ $selected: boolean }>`
  display: block;
  width: 100%;
  padding: 11px 13px;
  border: 0;
  border-bottom: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.$selected ? p.theme.highlightBackground : 'transparent'};
  text-align: left;
  cursor: pointer;

  &:hover { background: ${p => p.theme.highlightBackground}; }

  strong, span { display: block; }
  strong { margin-bottom: 3px; }
  span {
    color: ${p => p.theme.mainLowlightColor};
    font-size: ${p => p.theme.smallPrintSize};
  }
`;

const DetailsPane = styled.div`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 14px;
  background: ${p => p.theme.editorBackground};
`;

const RecordCard = styled.section`
  min-width: 0;
  overflow: hidden;
  border: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.highlightBackground};

  & + & { margin-top: 13px; }

  h3 {
    padding: 9px 11px;
    border-bottom: 1px solid ${p => p.theme.containerBorder};
    font-family: ${p => p.theme.titleTextFamily};
    font-weight: 600;
  }
`;

const RecordSection = styled.div`
  min-width: 0;
  padding: 10px 11px;

  & + & { border-top: 1px solid ${p => p.theme.containerBorder}; }

  h4 {
    margin-bottom: 6px;
    color: ${p => p.theme.mainLowlightColor};
    font-size: ${p => p.theme.smallPrintSize};
    font-weight: 600;
    text-transform: uppercase;
  }
`;

const TextBlock = styled.pre`
  width: 100%;
  max-width: 100%;
  max-height: 520px;
  overflow: auto;
  margin: 0;
  padding: 10px 11px;
  border: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.editorBackground};
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
`;

const FieldGrid = styled.dl`
  display: grid;
  grid-template-columns: minmax(120px, 170px) minmax(0, 1fr);
  margin: 0;
  border: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.mainBackground};

  dt, dd {
    min-width: 0;
    padding: 7px 9px;
    border-bottom: 1px solid ${p => p.theme.containerBorder};
  }

  dt {
    color: ${p => p.theme.mainLowlightColor};
    font-size: ${p => p.theme.smallPrintSize};
    font-weight: 600;
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
    font-family: ${p => p.theme.monoFontFamily};
    font-size: 12px;
    white-space: pre-wrap;
  }

  dt:nth-last-of-type(1), dd:nth-last-of-type(1) { border-bottom: 0; }
`;

const MessageTitle = styled.div`
  margin-bottom: 10px;
  padding: 10px 11px;
  border-left: 4px solid ${p => p.theme.primaryInputBackground};
  background: ${p => p.theme.mainBackground};
  font-family: ${p => p.theme.titleTextFamily};
  font-weight: 600;
  overflow-wrap: anywhere;
`;

const Disclosure = styled.details`
  border: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.mainBackground};

  & + & { margin-top: 8px; }

  > summary {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 7px 10px;
    cursor: pointer;
    font-weight: 600;
    list-style-position: inside;
  }

  &[open] > summary { border-bottom: 1px solid ${p => p.theme.containerBorder}; }
`;

const DisclosureBody = styled.div`
  padding: 10px;
`;

const CountBadge = styled.span`
  margin-left: auto;
  padding: 2px 7px;
  border-radius: 10px;
  background: ${p => p.theme.mainLowlightBackground};
  color: ${p => p.theme.mainLowlightColor};
  font-size: ${p => p.theme.smallPrintSize};
  font-weight: 600;
`;

const EventList = styled.div`
  margin-top: 10px;
`;

const EventDisclosure = styled(Disclosure)`
  > summary {
    min-height: 34px;
    font-family: ${p => p.theme.monoFontFamily};
    font-size: 12px;
    font-weight: 400;
  }
`;

const EmptyHistory = styled.div`
  padding: 20px;
  color: ${p => p.theme.mainLowlightColor};
`;

const Header = styled.header`
  padding: 24px 28px 20px;
  border-bottom: 1px solid ${p => p.theme.containerBorder};

  h1 {
    font-family: ${p => p.theme.titleTextFamily};
    font-size: ${p => p.theme.largeHeadingSize};
    font-weight: 600;
    margin-bottom: 5px;
  }

  p { color: ${p => p.theme.mainLowlightColor}; }
`;

const Body = styled.div`
  padding: 26px 28px 30px;
`;

const ModelName = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: ${p => p.theme.subHeadingSize};
  font-weight: 600;
  margin-bottom: 22px;
`;

const Label = styled.label`
  display: block;
  font-weight: 600;
  margin-bottom: 7px;
`;

const KeyInput = styled.input`
  width: 100%;
  height: 38px;
  padding: 7px 10px;
  border: 1px solid ${p => p.theme.inputBorder};
  border-radius: 3px;
  background: ${p => p.theme.inputBackground};
  color: ${p => p.theme.inputColor};
  font-family: ${p => p.theme.monoFontFamily};
  font-size: ${p => p.theme.textInputFontSize};

  &:focus {
    outline: 2px solid ${p => p.theme.secondaryInputBorder};
    outline-offset: 1px;
  }
`;

const Hint = styled.p`
  margin-top: 8px;
  color: ${p => p.theme.mainLowlightColor};
  font-size: ${p => p.theme.smallPrintSize};
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 20px;
`;

const Button = styled.button<{ $primary?: boolean }>`
  min-height: 36px;
  padding: 7px 14px;
  border: 1px solid ${p => p.$primary ? p.theme.primaryInputBackground : p.theme.containerBorder};
  border-radius: 3px;
  background: ${p => p.$primary ? p.theme.primaryInputBackground : p.theme.highlightBackground};
  color: ${p => p.$primary ? p.theme.primaryInputColor : p.theme.mainColor};
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) { filter: brightness(0.96); }
  &:disabled { cursor: default; opacity: 0.5; }
`;

const Status = styled.div<{ $error?: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-height: 42px;
  margin-top: 22px;
  padding: 11px 12px;
  border: 1px solid ${p => p.$error ? p.theme.popColor : p.theme.containerBorder};
  background: ${p => p.$error ? '#fff1ee' : p.theme.mainLowlightBackground};
  color: ${p => p.$error ? p.theme.popColor : p.theme.mainColor};

  svg { flex: 0 0 auto; margin-top: 1px; }
`;

const Spin = styled(SpinnerGap)`
  animation: spin 0.8s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;

export function ModelSettingsPage() {
  const bridge = window.workbench;
  const [apiKey, setApiKey] = React.useState('');
  const [status, setStatus] = React.useState<ModelStatus | null>(null);
  const [message, setMessage] = React.useState('Loading model configuration...');
  const [error, setError] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [calls, setCalls] = React.useState<ModelCallSummary[]>([]);
  const [selectedCallId, setSelectedCallId] = React.useState<string | null>(null);
  const [callDetails, setCallDetails] = React.useState<ModelCallEvent[] | null>(null);

  const refreshCalls = React.useCallback(async () => {
    if (!bridge) return [];
    const result = await bridge.listModelCalls();
    if (result.status === 'ready') setCalls(result.data);
    return result.status === 'ready' ? result.data : [];
  }, [bridge]);

  const selectCall = React.useCallback(async (callId: string) => {
    if (!bridge) return;
    setSelectedCallId(callId);
    setCallDetails(null);
    const result = await bridge.readModelCall(callId);
    setCallDetails(result.status === 'ready' ? result.data : [{
      version: 1,
      event: 'response.failed',
      callId,
      timestamp: new Date().toISOString(),
      error: result.error,
    }]);
  }, [bridge]);

  const applyStatus = React.useCallback((result: ModelResult<ModelStatus>) => {
    setStatus(result.data);
    setError(result.status === 'error');
    if (result.error) {
      setMessage(result.error);
    } else if (result.data.configured) {
      setMessage(result.data.credentialSource === 'environment'
        ? 'API key loaded from the DEEPSEEK_API_KEY environment variable.'
        : 'API key saved securely on this computer.');
    } else {
      setMessage('No API key is configured.');
    }
  }, []);

  React.useEffect(() => {
    if (!bridge) {
      setError(true);
      setMessage('Model settings are unavailable in the static preview.');
      return;
    }
    void Promise.all([bridge.getModelStatus(), refreshCalls()])
      .then(([modelStatus]) => applyStatus(modelStatus))
      .catch(caught => {
        setError(true);
        setMessage(errorMessage(caught));
      });
  }, [bridge, applyStatus, refreshCalls]);

  const run = async (operation: () => Promise<ModelResult<ModelStatus>>) => {
    setBusy(true);
    try {
      applyStatus(await operation());
    } catch (caught) {
      setError(true);
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    if (!bridge) return;
    const previousCallIds = new Set(calls.map(call => call.callId));
    setBusy(true);
    setError(false);
    setMessage('Calling DeepSeek V4 Flash...');
    try {
      const result: ModelResult<ModelCompletion | null> = await bridge.testDeepSeekConnection();
      const latestCalls = await refreshCalls();
      const recordedCall = result.data?.callId
        ?? latestCalls.find(call => !previousCallIds.has(call.callId))?.callId;
      if (recordedCall) await selectCall(recordedCall);
      if (result.status !== 'ready' || !result.data) {
        setError(true);
        setMessage(result.error ?? 'The connection test failed.');
      } else {
        setMessage(`Connection successful · ${result.data.latencyMs ?? 0} ms · ${result.data.usage.totalTokens} tokens`);
      }
    } catch (caught) {
      setError(true);
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page aria-label="Model settings">
      <Panel>
        <Header>
          <h1>Model connection</h1>
          <p>Configure the model used by Agent Workbench.</p>
        </Header>
        <Body>
          <ModelName><Key size={24} />DeepSeek V4 Flash</ModelName>
          <Label htmlFor="deepseek-api-key">API key</Label>
          <KeyInput
            id="deepseek-api-key"
            type="password"
            value={apiKey}
            autoComplete="off"
            placeholder={status?.configured ? 'Enter a new key to replace the saved key' : 'sk-...'}
            onChange={event => setApiKey(event.currentTarget.value)}
          />
          <Hint>The key is encrypted by the operating system and is never written to the project.</Hint>
          <Actions>
            <Button
              $primary
              type="button"
              disabled={busy || !apiKey.trim() || !bridge}
              onClick={() => {
                if (!bridge) return;
                void run(async () => {
                  const result = await bridge.saveDeepSeekApiKey(apiKey);
                  if (result.status === 'ready') setApiKey('');
                  return result;
                });
              }}
            >Save key</Button>
            <Button type="button" disabled={busy || !status?.configured || !bridge} onClick={() => { void testConnection(); }}>
              Test connection
            </Button>
            <Button
              type="button"
              disabled={busy || status?.credentialSource !== 'saved' || !bridge}
              onClick={() => { if (bridge) void run(() => bridge.clearDeepSeekApiKey()); }}
            >Clear saved key</Button>
          </Actions>
          <Status $error={error} role="status">
            {busy ? <Spin size={20} /> : error ? <WarningCircle size={20} /> : <CheckCircle size={20} />}
            <span>{message}</span>
          </Status>
        </Body>
      </Panel>
      <History>
        <HistoryTitle>Model call history</HistoryTitle>
        <HistoryGrid>
          <CallList>
            {calls.length === 0
              ? <EmptyHistory>No model calls recorded yet.</EmptyHistory>
              : calls.map(call => (
                <CallRow
                  key={call.callId}
                  type="button"
                  $selected={selectedCallId === call.callId}
                  onClick={() => { void selectCall(call.callId); }}
                >
                  <strong>{call.purpose} · {call.status}</strong>
                  <span>{formatCallTime(call.startedAt)} · {call.totalTokens} tokens · {call.durationMs ?? 0} ms</span>
                </CallRow>
              ))}
          </CallList>
          {selectedCallId
            ? callDetails
              ? <ModelCallDetails events={callDetails} />
              : <EmptyHistory>Loading complete record...</EmptyHistory>
            : <EmptyHistory>Select a call to load its complete request and response.</EmptyHistory>}
        </HistoryGrid>
      </History>
    </Page>
  );
}

function ModelCallDetails({ events }: { events: ModelCallEvent[] }) {
  const call = parseModelCallEvents(events);
  const responseMetadata = {
    ...call.response.metadata,
    finishReason: call.response.finishReason,
    usage: call.response.usage,
  };

  return (
    <DetailsPane>
      <RecordCard>
        <h3>Request</h3>
        <RecordSection>
          <h4>Request metadata</h4>
          <RecordFields value={call.request.metadata} />
        </RecordSection>
        <RecordSection>
          <h4>Model parameters</h4>
          <RecordFields value={call.request.parameters} />
        </RecordSection>
        {call.request.systemPrompt && (
          <RecordSection>
            <h4>System prompt</h4>
            <TextBlock>{call.request.systemPrompt}</TextBlock>
          </RecordSection>
        )}
        <RecordSection>
          <h4>User message</h4>
          {call.request.userMessage.title && (
            <MessageTitle>{call.request.userMessage.title}</MessageTitle>
          )}
          <TextBlock>{call.request.userMessage.instructions || 'No user message recorded.'}</TextBlock>
        </RecordSection>
        {call.request.evidence && (
          <RecordSection>
            <TaskEvidenceDetails evidence={call.request.evidence} />
          </RecordSection>
        )}
      </RecordCard>
      <RecordCard>
        <h3>Response</h3>
        <RecordSection>
          <h4>Status, headers and metrics</h4>
          <RecordFields value={responseMetadata} />
        </RecordSection>
        {call.response.content && (
          <RecordSection>
            <h4>Model output</h4>
            <TextBlock>{call.response.content}</TextBlock>
          </RecordSection>
        )}
        {call.response.reasoning && (
          <RecordSection>
            <Disclosure>
              <summary>Reasoning content</summary>
              <DisclosureBody><TextBlock>{call.response.reasoning}</TextBlock></DisclosureBody>
            </Disclosure>
          </RecordSection>
        )}
      </RecordCard>
    </DetailsPane>
  );
}

function TaskEvidenceDetails({ evidence }: { evidence: Record<string, unknown> }) {
  const turns = Array.isArray(evidence.turns) ? evidence.turns.map(asRecord) : [];
  const view = asRecord(evidence.evidenceView);
  const summary = compactRecord({
    conversation: evidence.conversationId,
    projectRoot: evidence.projectRoot,
    sourceSession: evidence.sessionFile,
    boundedEvents: view.boundedEventCount,
    originalDetailCharacters: view.originalDetailChars,
    includedDetailCharacters: view.includedDetailChars,
  });
  return (
    <>
      <h4>Task evidence · {turns.length} {turns.length === 1 ? 'turn' : 'turns'}</h4>
      <RecordFields value={summary} />
      <EventList>
        {turns.map((turn, index) => (
          <TurnEvidence key={stringValue(turn.id) || index} turn={turn} index={index} />
        ))}
      </EventList>
    </>
  );
}

function TurnEvidence({ turn, index }: { turn: Record<string, unknown>; index: number }) {
  const events = Array.isArray(turn.events) ? turn.events.map(asRecord) : [];
  const turnFields = compactRecord({
    turnId: turn.id,
    conversationId: turn.conversationId,
    workingDirectory: turn.cwd,
    status: turn.status,
    startedAt: turn.startedAt,
    updatedAt: turn.updatedAt,
    metrics: turn.metrics,
  });
  return (
    <Disclosure open={index === 0}>
      <summary>
        Turn {index + 1}
        <CountBadge>{events.length} events</CountBadge>
      </summary>
      <DisclosureBody>
        <RecordFields value={turnFields} />
        <EventList>
          {events.map((event, eventIndex) => (
            <EventEvidence
              key={`${stringValue(event.source) || ''}-${eventIndex}`}
              event={event}
              index={eventIndex}
            />
          ))}
        </EventList>
      </DisclosureBody>
    </Disclosure>
  );
}

function EventEvidence({ event, index }: { event: Record<string, unknown>; index: number }) {
  const source = asRecord(event.source);
  const detailView = asRecord(event.detailView);
  const fields = compactRecord({
    time: event.timestamp,
    kind: event.kind,
    name: event.name,
    callId: event.callId,
    success: event.success,
    source: sourceLocation(source),
    detailView: Object.keys(detailView).length > 0 ? detailView : undefined,
  });
  const label = [stringValue(event.kind), stringValue(event.name)].filter(Boolean).join(' · ');
  return (
    <EventDisclosure>
      <summary>{index + 1}. {label || 'Event'}</summary>
      <DisclosureBody>
        <RecordFields value={fields} />
        {typeof event.detail === 'string' && event.detail && (
          <TextBlock>{formatStructuredText(event.detail)}</TextBlock>
        )}
      </DisclosureBody>
    </EventDisclosure>
  );
}

function RecordFields({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null);
  if (entries.length === 0) return <EmptyHistory>No data recorded.</EmptyHistory>;
  return (
    <FieldGrid>
      {entries.map(([key, entry]) => (
        <React.Fragment key={key}>
          <dt>{humanizeKey(key)}</dt>
          <dd>{formatFieldValue(entry)}</dd>
        </React.Fragment>
      ))}
    </FieldGrid>
  );
}

function formatStructuredText(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatFieldValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function humanizeKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, character => character.toUpperCase());
}

function sourceLocation(source: Record<string, unknown>): string | undefined {
  const file = stringValue(source.sessionFile);
  const line = typeof source.line === 'number' ? source.line : null;
  if (!file) return undefined;
  return line === null ? file : `${file} · line ${line}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function formatCallTime(value: string | null): string {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to update the model configuration.';
}
