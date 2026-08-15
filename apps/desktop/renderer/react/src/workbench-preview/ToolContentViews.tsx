import * as React from 'react';
import { styled } from '../upstream/theme';
import { CodeViewer } from '../upstream/CodeViewer';
import {
  extractCommand,
  formatArgumentsJson,
  formatCommandDisplay,
  formatToolResult,
  type FormattedResultView,
  type SearchHit,
} from './tool-content-format';

const MetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
`;

const MetaChip = styled.span<{ $tone?: 'ok' | 'error' | 'neutral' }>`
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  background: ${p => p.theme.mainLowlightBackground};
  color: ${p => p.theme.mainColor};
  font-size: 13px;
  line-height: 1.3;

  strong {
    font-family: ${p => p.theme.monoFontFamily};
    font-weight: 700;
    color: ${p => {
      if (p.$tone === 'error') return p.theme.popColor;
      if (p.$tone === 'ok') return '#168a50';
      return p.theme.mainColor;
    }};
  }
`;

const SectionLabel = styled.div`
  margin: 0 0 8px;
  font-family: ${p => p.theme.titleTextFamily};
  font-size: ${p => p.theme.textSize};
  font-weight: 400;
  text-transform: uppercase;
  color: ${p => p.theme.containerWatermark};
`;

const Block = styled.div`
  margin-bottom: 14px;
  &:last-child { margin-bottom: 0; }
`;

const CommandBox = styled.pre`
  margin: 0;
  padding: 12px 14px;
  border-left: 3px solid #7547d8;
  background: ${p => p.theme.mainLowlightBackground};
  color: ${p => p.theme.mainColor};
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const StdoutBox = styled.pre`
  margin: 0;
  padding: 12px 14px;
  border-left: 3px solid #5b96a3;
  background: ${p => p.theme.mainLowlightBackground};
  color: ${p => p.theme.mainColor};
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const HitList = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const HitItem = styled.li`
  padding: 10px 12px;
  border-left: 3px solid #6284fa;
  background: ${p => p.theme.mainLowlightBackground};
`;

const HitPath = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 4px;
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 12px;
  color: ${p => p.theme.containerWatermark};
`;

const HitLine = styled.span`
  color: #6284fa;
  font-weight: 700;
`;

const HitText = styled.div`
  font-family: ${p => p.theme.monoFontFamily};
  font-size: 13px;
  line-height: 1.45;
  color: ${p => p.theme.mainColor};
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const FallbackBox = styled.pre<{ $error?: boolean }>`
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

const EmptyValue = styled.span`
  color: ${p => p.theme.containerWatermark};
  font-family: ${p => p.theme.monoFontFamily};
`;

function formatPlain(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'No result was recorded.';
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function HitRows({ hits }: { hits: SearchHit[] }) {
  return (
    <HitList>
      {hits.map((hit, index) => (
        <HitItem key={`${hit.path}:${hit.line ?? 'x'}:${index}`}>
          <HitPath>
            <span>{hit.path}</span>
            {hit.line != null ? <HitLine>:{hit.line}</HitLine> : null}
          </HitPath>
          <HitText>{hit.text || '(empty match)'}</HitText>
        </HitItem>
      ))}
    </HitList>
  );
}

function ShellResultBody({ view }: { view: FormattedResultView }) {
  const exitTone = view.meta.exitCode == null
    ? 'neutral'
    : view.meta.exitCode === '0'
      ? 'ok'
      : 'error';
  return (
    <>
      {(view.meta.exitCode || view.meta.wallTime) && (
        <MetaRow>
          {view.meta.exitCode != null && (
            <MetaChip $tone={exitTone}>Exit code <strong>{view.meta.exitCode}</strong></MetaChip>
          )}
          {view.meta.wallTime != null && (
            <MetaChip $tone="neutral">Wall time <strong>{view.meta.wallTime}</strong></MetaChip>
          )}
        </MetaRow>
      )}
      {view.stdout ? (
        <Block>
          <SectionLabel>Output</SectionLabel>
          <StdoutBox>{view.stdout}</StdoutBox>
        </Block>
      ) : null}
      {view.hits.length > 0 ? (
        <Block>
          <SectionLabel>Matches · {view.hits.length}</SectionLabel>
          <HitRows hits={view.hits} />
        </Block>
      ) : null}
    </>
  );
}

/** Section title + body: Command code block when possible, else Arguments JSON. */
export function buildOperationParams(value: unknown): {
  title: string;
  body: React.ReactNode;
} {
  const command = extractCommand(value);
  if (command) {
    return {
      title: 'Command',
      body: <CommandBox>{formatCommandDisplay(command)}</CommandBox>,
    };
  }

  const hasArgs = value != null && !(typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0);
  if (!hasArgs) {
    return {
      title: 'Arguments',
      body: <EmptyValue>—</EmptyValue>,
    };
  }

  return {
    title: 'Arguments',
    body: <CodeViewer value={formatArgumentsJson(value)} language="json" expanded={false} />,
  };
}

export function FormattedArguments({ value }: { value: unknown }) {
  return <>{buildOperationParams(value).body}</>;
}

export function FormattedResult({ value, error }: { value: unknown; error?: boolean }) {
  const view = React.useMemo(() => formatToolResult(value), [value]);
  if (!view) {
    return <FallbackBox $error={error}>{formatPlain(value)}</FallbackBox>;
  }
  return <ShellResultBody view={view} />;
}
