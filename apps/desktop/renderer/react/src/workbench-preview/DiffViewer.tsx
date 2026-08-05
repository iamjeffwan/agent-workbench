import * as React from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import { styled } from '../upstream/theme';
import type { ChangedFile } from './types';
import type { DiffLayout } from './view-model';

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker(moduleId: string, label: string): Worker;
    };
  }
}

window.MonacoEnvironment = {
  getWorker: (_moduleId, label) => {
    if (label === 'json') return new JsonWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

const Host = styled.div<{ $layout: DiffLayout }>`
  width: 100%;
  height: ${p => p.$layout === 'split' ? '420px' : '330px'};
  border: 1px solid ${p => p.theme.containerBorder};
  background: ${p => p.theme.editorBackground};
  overflow: hidden;
`;

export function DiffViewer({ file, layout }: { file: ChangedFile; layout: DiffLayout }) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<monaco.editor.IStandaloneDiffEditor>();

  React.useEffect(() => {
    if (!hostRef.current) return;
    const original = monaco.editor.createModel(file.before, file.language);
    const modified = monaco.editor.createModel(file.after, file.language);
    const editor = monaco.editor.createDiffEditor(hostRef.current, {
      readOnly: true,
      renderSideBySide: layout === 'split',
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: '"DM Mono", monospace',
      fontSize: 14,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      wordWrap: layout === 'split' ? 'off' : 'on',
      renderOverviewRuler: false,
      overviewRulerLanes: 0,
      contextmenu: false,
      folding: true,
      renderIndicators: true,
      originalEditable: false,
    });
    editor.setModel({ original, modified });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      original.dispose();
      modified.dispose();
      editorRef.current = undefined;
    };
  }, [file]);

  React.useEffect(() => {
    editorRef.current?.updateOptions({
      renderSideBySide: layout === 'split',
      wordWrap: layout === 'split' ? 'off' : 'on',
    });
  }, [layout]);

  return <Host ref={hostRef} $layout={layout} aria-label={`${layout} diff for ${file.path}`} />;
}
