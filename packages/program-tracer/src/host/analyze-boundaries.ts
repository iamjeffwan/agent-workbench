import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import {
  TRACE_MANIFEST_VERSION,
  type TraceManifest,
  type TraceMethod,
} from '../manifest.js';

export type AnalyzeBoundariesOptions = {
  projectRoot: string;
  /** Default: head.ts */
  headFileName?: string;
  /** Default: body.ts */
  bodyFileName?: string;
  /**
   * Map a project-relative source file to the compiled file the guest will load.
   * Default: src/.../*.ts → dist/.../*.js
   */
  toCompiledFile?: (sourceFile: string) => string | undefined;
};

type AbstractClassInfo = {
  className: string;
  methods: string[];
  sourceFile: string;
};

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '.turbo',
]);

export function analyzeBoundaries(
  options: AnalyzeBoundariesOptions,
): TraceManifest {
  const projectRoot = path.resolve(options.projectRoot);
  const headFileName = options.headFileName ?? 'head.ts';
  const bodyFileName = options.bodyFileName ?? 'body.ts';
  const toCompiledFile = options.toCompiledFile ?? defaultToCompiledFile;

  const methods: TraceMethod[] = [];

  for (const headAbs of listFilesNamed(projectRoot, headFileName)) {
    const headRel = toPosix(path.relative(projectRoot, headAbs));
    const abstracts = readAbstractClasses(headAbs, headRel);
    if (abstracts.length === 0) {
      continue;
    }

    const bodyAbs = path.join(path.dirname(headAbs), bodyFileName);
    if (!fs.existsSync(bodyAbs)) {
      continue;
    }

    const bodyRel = toPosix(path.relative(projectRoot, bodyAbs));
    const compiledFile = toCompiledFile(bodyRel);
    const abstractByName = new Map(
      abstracts.map((item) => [item.className, item]),
    );

    for (const impl of readImplementations(bodyAbs, abstractByName)) {
      for (const methodName of impl.methodNames) {
        methods.push({
          id: 0, // replaced after stable sort
          sourceFile: bodyRel,
          ...(compiledFile ? { compiledFile } : {}),
          className: impl.className,
          methodName,
        });
      }
    }
  }

  methods.sort((a, b) => {
    const left = `${a.sourceFile}\0${a.className}\0${a.methodName}`;
    const right = `${b.sourceFile}\0${b.className}\0${b.methodName}`;
    return left.localeCompare(right);
  });

  // Re-assign stable ids after sort so the same project yields the same ids.
  methods.forEach((method, index) => {
    method.id = index + 1;
  });

  return {
    version: TRACE_MANIFEST_VERSION,
    projectRoot,
    methods,
  };
}

function defaultToCompiledFile(sourceFile: string): string | undefined {
  if (!sourceFile.endsWith('.ts') || sourceFile.endsWith('.d.ts')) {
    return undefined;
  }

  if (sourceFile === 'src' || sourceFile.startsWith('src/')) {
    return `dist/${sourceFile.slice('src/'.length).replace(/\.ts$/, '.js')}`;
  }

  const replaced = sourceFile.replace(/(^|\/)src\//, '$1dist/');
  if (replaced === sourceFile) {
    return undefined;
  }

  return replaced.replace(/\.ts$/, '.js');
}

function listFilesNamed(root: string, fileName: string): string[] {
  const found: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        walk(abs);
        continue;
      }

      if (entry.isFile() && entry.name === fileName) {
        found.push(abs);
      }
    }
  }

  walk(root);
  return found.sort((a, b) => a.localeCompare(b));
}

function readAbstractClasses(
  fileAbs: string,
  sourceFile: string,
): AbstractClassInfo[] {
  const source = createSource(fileAbs);
  const result: AbstractClassInfo[] = [];

  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || !statement.name) {
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.AbstractKeyword)) {
      continue;
    }

    const className = statement.name.text;
    const methods: string[] = [];

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member) || !member.name) {
        continue;
      }
      if (!hasModifier(member, ts.SyntaxKind.AbstractKeyword)) {
        continue;
      }
      if (!ts.isIdentifier(member.name)) {
        continue;
      }
      methods.push(member.name.text);
    }

    if (methods.length > 0) {
      result.push({ className, methods, sourceFile });
    }
  }

  return result;
}

function readImplementations(
  fileAbs: string,
  abstractByName: Map<string, AbstractClassInfo>,
): Array<{ className: string; methodNames: string[] }> {
  const source = createSource(fileAbs);
  const result: Array<{ className: string; methodNames: string[] }> = [];

  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || !statement.name) {
      continue;
    }

    const className = statement.name.text;
    const parentName = getExtendsName(statement);
    if (!parentName) {
      continue;
    }

    const parent = abstractByName.get(parentName);
    if (!parent) {
      continue;
    }

    const declared = new Set<string>();
    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member) || !member.name) {
        continue;
      }
      if (!ts.isIdentifier(member.name)) {
        continue;
      }
      declared.add(member.name.text);
    }

    const methodNames = parent.methods.filter((name) => declared.has(name));
    if (methodNames.length > 0) {
      result.push({ className, methodNames });
    }
  }

  return result;
}

function getExtendsName(node: ts.ClassDeclaration): string | undefined {
  const heritage = node.heritageClauses?.find(
    (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
  );
  const expression = heritage?.types[0]?.expression;
  if (!expression) {
    return undefined;
  }

  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  // supports `extends ns.Foo` lightly
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    return expression.name.text;
  }

  return undefined;
}

function hasModifier(
  node: ts.HasModifiers,
  kind: ts.SyntaxKind,
): boolean {
  return !!ts.getModifiers(node)?.some((modifier) => modifier.kind === kind);
}

function createSource(fileAbs: string): ts.SourceFile {
  const text = fs.readFileSync(fileAbs, 'utf8');
  return ts.createSourceFile(
    fileAbs,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}
