import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

import { redactCredentialText } from '../../../agent-workbench-security/index.mjs';
import {
  ENV_PROCESS_ORIGIN_ID,
  ENV_TRACE_MANIFEST_PATH,
  ENV_TRACE_OUT_PATH,
} from '../env.js';
import { isTraceManifest, type TraceManifest, type TraceMethod } from '../manifest.js';
import { createRecorderRuntime, installRuntime } from './runtime.js';
import { instrumentSource } from './transform.js';

type MethodsByFile = Map<string, TraceMethod[]>;

export function installGuest(): void {
  const manifestPath = process.env[ENV_TRACE_MANIFEST_PATH];
  if (!manifestPath) {
    console.error(
      `[program-tracer] skip: missing env ${ENV_TRACE_MANIFEST_PATH}`,
    );
    return;
  }

  const manifest = readManifest(manifestPath);
  const byFile = indexMethodsByFile(manifest);
  const originId = process.env[ENV_PROCESS_ORIGIN_ID] ?? '';
  const outPath =
    process.env[ENV_TRACE_OUT_PATH] ??
    path.join(manifest.projectRoot, '.agent-workbench', 'trace-records.jsonl');

  installRuntime(
    createRecorderRuntime({
      processOriginId: originId,
      outPath,
    }),
  );

  registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (!url.startsWith('file:')) {
        return loaded;
      }

      let filePath: string;
      try {
        filePath = fileURLToPath(url);
      } catch {
        return loaded;
      }

      const methods = byFile.get(normalizePath(filePath));
      if (!methods || methods.length === 0) {
        return loaded;
      }

      if (loaded.source === undefined || loaded.source === null) {
        return loaded;
      }

      const sourceText =
        typeof loaded.source === 'string'
          ? loaded.source
          : Buffer.from(loaded.source as Uint8Array).toString('utf8');

      const instrumented = instrumentSource(sourceText, filePath, methods);
      if (!instrumented) {
        return loaded;
      }

      return {
        ...loaded,
        source: instrumented,
      };
    },
  });

  console.error(
    redactCredentialText(
      `[program-tracer] guest ready; origin=${originId || '(none)'} methods=${manifest.methods.length} out=${outPath}`,
    ),
  );
}

function readManifest(manifestPath: string): TraceManifest {
  const absManifestPath = path.resolve(manifestPath);
  const raw: unknown = JSON.parse(fs.readFileSync(absManifestPath, 'utf8'));
  if (!isTraceManifest(raw)) {
    throw new Error(`[program-tracer] invalid manifest: ${absManifestPath}`);
  }

  if (!path.isAbsolute(raw.projectRoot)) {
    return {
      ...raw,
      projectRoot: path.resolve(path.dirname(absManifestPath), raw.projectRoot),
    };
  }

  return raw;
}

function indexMethodsByFile(manifest: TraceManifest): MethodsByFile {
  const map: MethodsByFile = new Map();

  for (const method of manifest.methods) {
    const rels = [method.compiledFile, method.sourceFile].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );

    for (const rel of rels) {
      const abs = normalizePath(path.resolve(manifest.projectRoot, rel));
      const list = map.get(abs) ?? [];
      if (!list.some((item) => item.id === method.id)) {
        list.push(method);
      }
      map.set(abs, list);
    }
  }

  return map;
}

function normalizePath(filePath: string): string {
  return path.normalize(path.resolve(filePath));
}
