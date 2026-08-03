import { createHash } from 'node:crypto';
import ts from 'typescript';

import type { TraceMethod } from '../manifest.js';

const transformCache = new Map<string, string>();
const TRANSFORM_CACHE_LIMIT = 128;

/**
 * Rewrite matching class methods to:
 *   return __awTrace.wrap(id, [args], async? () => { ...original body });
 * Returns undefined when no method in this file needs instrumentation.
 */
export function instrumentSource(
  sourceText: string,
  fileName: string,
  methods: TraceMethod[],
): string | undefined {
  if (methods.length === 0) {
    return undefined;
  }

  const cacheKey = `${fileName}\0${hashText(sourceText)}\0${methods
    .map((method) => `${method.id}:${method.className}.${method.methodName}`)
    .join(',')}`;
  const cached = transformCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const targets = new Map<string, Map<string, number>>();
  for (const method of methods) {
    let byMethod = targets.get(method.className);
    if (!byMethod) {
      byMethod = new Map();
      targets.set(method.className, byMethod);
    }
    byMethod.set(method.methodName, method.id);
  }

  const scriptKind = fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  let changed = false;

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const className = node.name?.text;
        if (!className) {
          return ts.visitEachChild(node, visit, context);
        }

        const methodIds = targets.get(className);
        if (!methodIds) {
          return ts.visitEachChild(node, visit, context);
        }

        const members = node.members.map((member) => {
          if (!ts.isMethodDeclaration(member) || !member.body) {
            return member;
          }
          if (!ts.isIdentifier(member.name)) {
            return member;
          }

          const methodId = methodIds.get(member.name.text);
          if (methodId === undefined) {
            return member;
          }

          changed = true;
          return wrapMethod(member, methodId, context.factory);
        });

        if (ts.isClassDeclaration(node)) {
          return context.factory.updateClassDeclaration(
            node,
            node.modifiers,
            node.name,
            node.typeParameters,
            node.heritageClauses,
            members,
          );
        }

        return context.factory.updateClassExpression(
          node,
          node.modifiers,
          node.name,
          node.typeParameters,
          node.heritageClauses,
          members,
        );
      }

      return ts.visitEachChild(node, visit, context);
    };

    return (file) => ts.visitNode(file, visit) as ts.SourceFile;
  };

  const transformed = ts.transform(sourceFile, [transformer]);
  try {
    if (!changed) {
      return undefined;
    }

    const printer = ts.createPrinter({
      newLine: ts.NewLineKind.LineFeed,
      removeComments: false,
    });
    const output = printer.printFile(transformed.transformed[0]);
    if (transformCache.size >= TRANSFORM_CACHE_LIMIT) {
      transformCache.clear();
    }
    transformCache.set(cacheKey, output);
    return output;
  } finally {
    transformed.dispose();
  }
}

function wrapMethod(
  method: ts.MethodDeclaration,
  methodId: number,
  factory: ts.NodeFactory,
): ts.MethodDeclaration {
  const isAsync = !!method.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
  );
  const bodyStatements = method.body?.statements ?? [];
  const argsExpression = buildArgsExpression(method.parameters, factory);

  const inner = factory.createArrowFunction(
    isAsync
      ? [factory.createModifier(ts.SyntaxKind.AsyncKeyword)]
      : undefined,
    undefined,
    [],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    factory.createBlock(bodyStatements, true),
  );

  const wrapCall = factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier('__awTrace'),
      factory.createIdentifier('wrap'),
    ),
    undefined,
    [factory.createNumericLiteral(methodId), argsExpression, inner],
  );

  return factory.updateMethodDeclaration(
    method,
    method.modifiers,
    method.asteriskToken,
    method.name,
    method.questionToken,
    method.typeParameters,
    method.parameters,
    method.type,
    factory.createBlock([factory.createReturnStatement(wrapCall)], true),
  );
}

function buildArgsExpression(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  factory: ts.NodeFactory,
): ts.Expression {
  const names: ts.Identifier[] = [];
  for (const parameter of parameters) {
    if (!ts.isIdentifier(parameter.name)) {
      return factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier('Array'),
          factory.createIdentifier('from'),
        ),
        undefined,
        [factory.createIdentifier('arguments')],
      );
    }
    names.push(parameter.name);
  }
  return factory.createArrayLiteralExpression(names, false);
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
