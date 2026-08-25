import * as React from 'react';
import { styled } from '../upstream/theme';
import type { ReviewResult, TemporaryPrompt } from './workbench-data';

const Page = styled.main`
  height: 100vh; overflow: auto; padding: 34px 42px; box-sizing: border-box;
  background: ${p => p.theme.containerBackground}; color: ${p => p.theme.mainColor};
`;
const Card = styled.article`
  max-width: 820px; margin: 0 auto 16px; padding: 18px 20px; border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 8px; background: ${p => p.theme.mainBackground};
`;
const Header = styled.div`display:flex; justify-content:space-between; gap:12px; align-items:flex-start;`;
const Button = styled.button`border:1px solid ${p => p.theme.containerBorder}; border-radius:4px; background:transparent; padding:7px 11px; cursor:pointer; color:inherit;`;
const Prompt = styled.pre`white-space:pre-wrap; font: inherit; line-height:1.55; margin:14px 0; padding:14px; border-radius:5px; background:${p => p.theme.containerBackground};`;

export function TemporaryPromptsPage({
  projectRoot, listPrompts, hidePrompt,
}: {
  projectRoot: string | null;
  listPrompts(root?: string | null): Promise<ReviewResult<TemporaryPrompt[]>>;
  hidePrompt(root: string | null, promptId: string): Promise<ReviewResult<TemporaryPrompt | null>>;
}) {
  const [prompts, setPrompts] = React.useState<TemporaryPrompt[]>([]);
  const [message, setMessage] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const refresh = React.useCallback(async () => {
    const result = await listPrompts(projectRoot);
    if (result.status === 'ready') { setPrompts(result.data); setMessage(null); }
    else setMessage(result.error ?? 'Unable to load temporary prompts.');
  }, [listPrompts, projectRoot]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const copy = async (prompt: TemporaryPrompt) => {
    try { await navigator.clipboard.writeText(prompt.content); setCopied(prompt.promptId); setTimeout(() => setCopied(null), 1500); }
    catch { setMessage('Copy failed.'); }
  };
  const hide = async (prompt: TemporaryPrompt) => {
    const result = await hidePrompt(projectRoot, prompt.promptId);
    if (result.status === 'ready') setPrompts(current => current.filter(item => item.promptId !== prompt.promptId));
    else setMessage(result.error ?? 'Unable to hide temporary prompt.');
  };
  return <Page><h1>Temporary prompts</h1><p>Prompts created from confirmed review findings. Copy them into any conversation when useful.</p>
    {message ? <p role="alert">{message}</p> : null}
    {prompts.length === 0 ? <Card><p>No temporary prompts yet.</p></Card> : prompts.map(prompt => <Card key={prompt.promptId}>
      <Header><div><h2>{prompt.title}</h2><small>{prompt.projectName} · source review {prompt.caseId} · {new Date(prompt.createdAt).toLocaleString()}</small></div><Button type="button" onClick={() => void hide(prompt)}>Hide</Button></Header>
      <Prompt>{prompt.content}</Prompt><Button type="button" onClick={() => void copy(prompt)}>{copied === prompt.promptId ? 'Copied' : 'Copy prompt'}</Button>
    </Card>)}
  </Page>;
}
