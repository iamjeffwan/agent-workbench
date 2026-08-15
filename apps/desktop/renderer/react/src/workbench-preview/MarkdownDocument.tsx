import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { styled } from '../upstream/theme';

const Document = styled.article`
  min-height: 100%;
  padding: 20px 20px 32px;
  border: 1px solid ${p => p.theme.containerBorder};
  border-radius: 3px;
  background: ${p => p.theme.mainBackground};
  color: ${p => p.theme.mainColor};
  font-size: 14px;
  line-height: 1.55;
  overflow-wrap: anywhere;

  h1,
  h2,
  h3 {
    color: ${p => p.theme.mainColor};
    font-family: ${p => p.theme.titleTextFamily};
    font-weight: 600;
    line-height: 1.25;
  }

  h1 {
    margin: 0 0 20px;
    font-size: 24px;
  }

  h2 {
    margin: 26px 0 11px;
    padding-bottom: 6px;
    border-bottom: 1px solid ${p => p.theme.containerBorder};
    font-size: 18px;
  }

  h3 {
    margin: 20px 0 8px;
    font-size: 15px;
  }

  p {
    margin: 0 0 11px;
  }

  ul,
  ol {
    margin: 0 0 13px;
    padding-left: 24px;
  }

  li + li {
    margin-top: 4px;
  }

  blockquote {
    margin: 9px 0 13px;
    padding: 9px 12px;
    border-left: 4px solid ${p => p.theme.popColor};
    background: ${p => p.theme.mainLowlightBackground};
    color: ${p => p.theme.mainLowlightColor};
  }

  blockquote > :last-child {
    margin-bottom: 0;
  }

  table {
    width: 100%;
    margin: 8px 0 17px;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: 7px 9px;
    border: 1px solid ${p => p.theme.containerBorder};
    text-align: left;
    vertical-align: top;
  }

  th {
    background: ${p => p.theme.mainLowlightBackground};
    font-family: ${p => p.theme.titleTextFamily};
    font-weight: 600;
  }

  code {
    padding: 1px 4px;
    border-radius: 2px;
    background: ${p => p.theme.mainLowlightBackground};
    font-family: ${p => p.theme.monoFontFamily};
    font-size: 0.9em;
  }

  pre {
    max-width: 100%;
    margin: 9px 0 14px;
    padding: 11px 12px;
    overflow: auto;
    border: 1px solid ${p => p.theme.containerBorder};
    background: ${p => p.theme.editorBackground};
    font-family: ${p => p.theme.monoFontFamily};
    font-size: 12px;
    line-height: 1.55;
    white-space: pre;
  }

  pre code {
    padding: 0;
    background: transparent;
    font-size: inherit;
  }

  a {
    color: ${p => p.theme.linkColor};
  }

  hr {
    margin: 22px 0;
    border: 0;
    border-top: 1px solid ${p => p.theme.containerBorder};
  }

  > :last-child {
    margin-bottom: 0;
  }
`;

export function MarkdownDocument({ markdown }: { markdown: string }) {
  return (
    <Document>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {markdown}
      </ReactMarkdown>
    </Document>
  );
}
