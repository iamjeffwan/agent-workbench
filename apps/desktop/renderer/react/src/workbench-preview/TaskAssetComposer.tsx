import * as React from 'react';
import { Check, SpinnerGap } from '@phosphor-icons/react';

import { styled } from '../upstream/theme';
import type {
  CreateProjectAssetDraftInput,
  ProjectAssetDocument,
  ProjectAssetDraft,
  ProjectAssetIndex,
  ProjectAssetResult,
  TaskRecord,
  WriteProjectAssetDraftInput,
} from './workbench-data';

const Panel = styled.section`
  margin: 16px 0 4px;
  padding: 16px;
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 3px;
  background: ${p => p.theme.mainBackground};
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  h2 { margin: 0; font-size: 18px; font-family: ${p => p.theme.titleTextFamily}; }
`;

const Button = styled.button`
  min-height: 31px;
  padding: 5px 11px;
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 3px;
  background: ${p => p.theme.mainLowlightBackground};
  color: inherit;
  font: inherit;
  cursor: pointer;
  &:hover:not(:disabled) { filter: brightness(0.97); }
  &:disabled { opacity: 0.55; cursor: default; }
`;

const Form = styled.div`
  display: grid;
  gap: 13px;
  margin-top: 15px;
`;

const Field = styled.label`
  display: grid;
  gap: 5px;
  color: ${p => p.theme.mainLowlightColor};
  font-size: 12px;
  font-weight: 600;
  textarea, select, input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid ${p => p.theme.containerBorder};
    border-radius: 3px;
    background: ${p => p.theme.inputBackground};
    color: ${p => p.theme.inputColor};
    font: 14px ${p => p.theme.fontFamily};
  }
  textarea { min-height: 96px; resize: vertical; padding: 8px; line-height: 1.45; }
  select, input { height: 34px; padding: 5px 8px; }
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
`;

const ErrorText = styled.p`
  margin: 0;
  color: ${p => p.theme.popColor};
  font-size: 13px;
`;

const Diff = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  max-height: 430px;
  overflow: hidden;
  border: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.containerBorder};
`;

const DiffColumn = styled.section`
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: ${p => p.theme.mainBackground};
  h3 { margin: 0; padding: 8px 10px; border-bottom: 1px solid ${p => p.theme.containerBorder}; font-size: 13px; }
  pre { min-height: 0; margin: 0; padding: 11px; overflow: auto; white-space: pre-wrap; font: 12px/1.5 ${p => p.theme.monoFontFamily}; }
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
`;

const Saved = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #128952;
  font-weight: 600;
`;

export interface TaskAssetComposerProps {
  task: TaskRecord;
  listAssets(projectRoot?: string | null): Promise<ProjectAssetResult<ProjectAssetIndex | null>>;
  createDraft(input: CreateProjectAssetDraftInput): Promise<ProjectAssetResult<ProjectAssetDraft | null>>;
  writeDraft(input: WriteProjectAssetDraftInput): Promise<ProjectAssetResult<ProjectAssetDocument | null>>;
}

export function TaskAssetComposer({ task, listAssets, createDraft, writeDraft }: TaskAssetComposerProps) {
  const [open, setOpen] = React.useState(false);
  const [index, setIndex] = React.useState<ProjectAssetIndex | null>(null);
  const [experience, setExperience] = React.useState('');
  const [category, setCategory] = React.useState<CreateProjectAssetDraftInput['category']>('project-overview');
  const [targetMode, setTargetMode] = React.useState('__new__');
  const [relativePath, setRelativePath] = React.useState('');
  const [draft, setDraft] = React.useState<ProjectAssetDraft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedPath, setSavedPath] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    void listAssets(task.projectRoot).then(result => {
      setIndex(result.data);
      if (result.status !== 'ready') setError(result.error);
    });
  }, [listAssets, open, task.projectRoot]);

  const activeCategory = index?.categories.find(item => item.id === category);
  React.useEffect(() => {
    setTargetMode('__new__');
    setRelativePath(recommendedPath(category, task.title, activeCategory?.basePath));
    setDraft(null);
    setSavedPath(null);
  }, [category, task.title, activeCategory?.basePath]);

  const generate = async () => {
    setBusy(true); setError(null); setSavedPath(null);
    const target = category === 'agent-instructions'
      ? 'AGENTS.md'
      : targetMode === '__new__' ? relativePath : targetMode;
    const result = await createDraft({ projectRoot: task.projectRoot, taskId: task.id, experience, category, relativePath: target });
    setBusy(false);
    setDraft(result.data);
    if (result.status !== 'ready') setError(result.error);
  };

  const write = async () => {
    if (!draft) return;
    setBusy(true); setError(null);
    const result = await writeDraft({
      projectRoot: draft.projectRoot,
      category: draft.category,
      relativePath: draft.relativePath,
      beforeHash: draft.beforeHash,
      markdown: draft.after,
    });
    setBusy(false);
    if (result.status !== 'ready' || !result.data) { setError(result.error); return; }
    setSavedPath(result.data.relativePath);
    setDraft(null);
  };

  return <Panel>
    <PanelHeader>
      <h2>Drafts</h2>
      <Button type="button" onClick={() => setOpen(value => !value)}>{open ? 'Close' : 'Organize a draft'}</Button>
    </PanelHeader>
    {open ? <Form>
      <Field>
        Experience worth keeping
        <textarea value={experience} onChange={event => setExperience(event.target.value)} placeholder="Write the lesson you have confirmed. The model will organize this text, not discover new lessons." />
      </Field>
      <Grid>
        <Field>
          Category
          <select value={category} onChange={event => setCategory(event.target.value as CreateProjectAssetDraftInput['category'])}>
            {index?.categories.filter(item => item.writable).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </Field>
        <Field>
          Target document
          <select value={targetMode} disabled={category === 'agent-instructions'} onChange={event => { setTargetMode(event.target.value); setDraft(null); }}>
            <option value="__new__">Create a new document</option>
            {activeCategory?.files.map(file => <option key={file.relativePath} value={file.relativePath}>{file.relativePath}</option>)}
          </select>
        </Field>
      </Grid>
      {targetMode === '__new__' && category !== 'agent-instructions' ? <Field>
        Recommended project-relative path
        <input value={relativePath} onChange={event => { setRelativePath(event.target.value); setDraft(null); }} />
      </Field> : null}
      <Actions>
        {savedPath ? <Saved><Check size={16} weight="bold" /> Saved to {savedPath}</Saved> : null}
        <Button type="button" disabled={busy || !experience.trim()} onClick={() => { void generate(); }}>
          {busy && !draft ? <><SpinnerGap size={15} /> Generating…</> : 'Generate draft'}
        </Button>
      </Actions>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {draft ? <>
        <Diff>
          <DiffColumn><h3>Before</h3><pre>{draft.before || '(new document)'}</pre></DiffColumn>
          <DiffColumn><h3>After</h3><pre>{draft.after}</pre></DiffColumn>
        </Diff>
        <Actions>
          <Button type="button" onClick={() => setDraft(null)}>Discard</Button>
          <Button type="button" disabled={busy} onClick={() => { void write(); }}>{busy ? 'Writing…' : 'Confirm and write'}</Button>
        </Actions>
      </> : null}
    </Form> : null}
  </Panel>;
}

function recommendedPath(category: string, title: string, basePath?: string) {
  if (category === 'agent-instructions') return 'AGENTS.md';
  const slug = title.normalize('NFKC').toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'project-note';
  return `${basePath ?? `docs/${category}`}/${slug}.md`;
}
