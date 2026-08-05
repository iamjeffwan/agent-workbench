/*
 * Monaco body viewer adapted from HTTP Toolkit UI at
 * 66488157be993c88152bf0b5964cfa1c63e0fbf5, AGPL-3.0-or-later.
 */
import * as React from 'react';
import MonacoEditor from 'react-monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import { styled } from './theme';

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

const EditorCardContent = styled.div<{ $expanded: boolean }>`
  margin: 0 -20px -20px;
  border: solid 1px ${p => p.theme.containerBorder};
  padding-right: 1px;
  border-radius: 0 0 3px 3px;
  background-color: ${p => p.theme.highlightBackground};
  color: ${p => p.theme.highlightColor};
  position: relative;
  flex-grow: 1;
  min-height: 0;
  height: ${p => p.$expanded ? 'calc(100vh - 82px)' : 'auto'};

  .monaco-editor-overlaymessage { display: none; }
`;

export function CodeViewer({ value, language, expanded }: {
  value: string;
  language: 'css' | 'json' | 'javascript' | 'typescript' | 'markdown';
  expanded: boolean;
}) {
  const lineCount = value.split('\n').length;
  const height = expanded ? '100%' : `${Math.min(560, Math.max(190, lineCount * 23 + 18))}px`;

  return (
    <EditorCardContent $expanded={expanded}>
      <MonacoEditor
        width="100%"
        height={height}
        language={language}
        theme="vs"
        value={value}
        options={{
          readOnly: true,
          showFoldingControls: 'always',
          scrollbar: { alwaysConsumeMouseWheel: false },
          quickSuggestions: false,
          parameterHints: { enabled: false },
          codeLens: true,
          minimap: { enabled: false },
          contextmenu: false,
          scrollBeyondLastLine: false,
          colorDecorators: false,
          renderValidationDecorations: 'on',
          fixedOverflowWidgets: true,
          fontSize: 16,
          fontFamily: '"DM Mono", monospace',
          wordWrap: 'on',
          automaticLayout: true,
          folding: true,
          lineNumbersMinChars: 3,
          renderLineHighlight: 'line',
          padding: { top: 4, bottom: 8 },
        }}
      />
    </EditorCardContent>
  );
}
