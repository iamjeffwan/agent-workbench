import { styled } from '../upstream/theme';
import { MarkdownDocument } from './MarkdownDocument';
import type { ProjectAssetDocument, SyncTaskRecord } from './workbench-data';

const Pane = styled.aside`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  box-sizing: border-box;
  background: ${p => p.theme.containerBackground};
`;

const Header = styled.header`
  margin-bottom: 12px;
  padding: 14px 16px;
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 3px;
  background: ${p => p.theme.mainBackground};

  h1 {
    margin: 0;
    font: 600 18px ${p => p.theme.titleTextFamily};
    overflow-wrap: anywhere;
  }

  p {
    margin: 7px 0 0;
    color: ${p => p.theme.mainLowlightColor};
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
`;

const Section = styled.section`
  margin-top: 12px;
  padding: 14px 16px;
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 3px;
  background: ${p => p.theme.mainBackground};

  h2 {
    margin: 0 0 10px;
    font: 600 14px ${p => p.theme.titleTextFamily};
  }
`;

const Evidence = styled.div`
  & + & { margin-top: 10px; padding-top: 10px; border-top: 1px solid ${p => p.theme.containerBorder}; }
  strong, span { display: block; }
  span { margin-top: 3px; color: ${p => p.theme.mainLowlightColor}; font-size: 11px; }
  pre { margin: 7px 0 0; max-height: 150px; overflow: auto; white-space: pre-wrap; font: 12px/1.45 ${p => p.theme.monoFontFamily}; }
`;

const Notice = styled.div`
  padding: 28px 16px;
  color: ${p => p.theme.mainLowlightColor};
  text-align: center;
`;

export function SyncTaskInspector({
  task,
  document,
  loading,
  error,
}: {
  task: SyncTaskRecord;
  document: ProjectAssetDocument | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <Pane aria-label="Selected synchronized task">
      <Header>
        <h1>{task.title}</h1>
        <p>
          Session {task.source.sessionId} · {task.turns.length} turns · {task.eventCount} events
          <br />
          Document: {task.projectFile}
        </p>
      </Header>
      {loading ? <Notice>Loading the synchronized flow document…</Notice>
        : error ? <Notice>{error}</Notice>
          : document ? <MarkdownDocument markdown={document.markdown} />
            : <Notice>The synchronized flow document is unavailable.</Notice>}
      <Section>
        <h2>Evidence</h2>
        {task.evidence.length === 0 ? <Notice>No synchronized evidence was recorded.</Notice> : task.evidence.map(record => (
          <Evidence key={`${record.turnId}-${record.sequence}`}>
            <strong>{record.event.name || record.event.kind}</strong>
            <span>{record.event.kind} · {record.event.timestamp ?? 'Unknown time'}</span>
            {record.event.detail ? <pre>{record.event.detail}</pre> : null}
          </Evidence>
        ))}
      </Section>
    </Pane>
  );
}
