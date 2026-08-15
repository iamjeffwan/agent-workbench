import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(root, '../renderer/react/src/workbench-preview/tool-content-format.ts');
const source = readFileSync(sourcePath, 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
});
const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}`;
const {
  extractCommand,
  formatCommandDisplay,
  formatToolResult,
} = await import(moduleUrl);

test('formats shell result with stdout and search hits', () => {
  const text = [
    'Exit code: 0',
    'Wall time: 1.6 seconds',
    'Output:',
    'const a = 8',
    'const b = 13',
    'console.log(a)',
    '',
    '.\\docs\\RSS与多媒体内容来源取舍.md:70:第一批用于演示摘要的来源',
    '.\\docs\\development-notes.md:19:- Replace development-only worker endpoints',
  ].join('\n');

  const view = formatToolResult(text);
  assert.equal(view?.kind, 'shell_result');
  assert.equal(view?.meta.exitCode, '0');
  assert.equal(view?.hits.length, 2);
});

test('extracts command and breaks compound shell lines', () => {
  const args = {
    command:
      "Get-Content -Encoding utf8 src/a.ts; Get-Content -Encoding utf8 src/b.ts; rg -n 'discover' apps",
    workdir: 'F:\\Beside\\apps\\api',
    timeout_ms: 120000,
  };

  assert.equal(extractCommand(args), args.command);
  const display = formatCommandDisplay(args.command);
  assert.equal(
    display,
    [
      'Get-Content -Encoding utf8 src/a.ts;',
      'Get-Content -Encoding utf8 src/b.ts;',
      "rg -n 'discover' apps",
    ].join('\n'),
  );
});

test('returns null command for non-shell arguments', () => {
  assert.equal(extractCommand({ path: 'src/app.ts', offset: 10 }), null);
});
