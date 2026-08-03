#!/usr/bin/env node
/**
 * Seed multi-turn mock agent + program data for verify-viewer demos.
 * Overwrites .agent-workbench/agent-steps.jsonl and trace-records.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function parseOutDir(argv) {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out-dir' || args[i] === '-o') {
      return path.resolve(args[i + 1] || '');
    }
  }
  return path.join(repoRoot, '.agent-workbench');
}

const outDir = parseOutDir(process.argv);

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
}

function agentTool(partial) {
  return {
    kind: 'agent_tool',
    status: 'completed',
    provider: 'cursor',
    source: 'mock',
    sessionFile: 'mock-session',
    startedAt: partial.startedAt,
    endedAt: partial.endedAt || partial.startedAt,
    ...partial,
  };
}

function main() {
  const t1 = '2026-08-01T08:00:00.000Z';
  const t2 = '2026-08-01T08:05:00.000Z';

  const exploreTurn1 = [
    ['Read', { path: 'apps/worker/src/quick-summary/head.ts' }],
    ['Read', { path: 'apps/worker/src/quick-summary/body.ts' }],
    ['Grep', { pattern: 'summarize', glob: '*.ts' }],
    ['Glob', { glob_pattern: '**/article-content/*' }],
    ['Read', { path: 'apps/worker/src/article-content/body.ts' }],
    ['Grep', { pattern: 'ContentFetcher', glob: '*.ts' }],
    ['Glob', { glob_pattern: 'docs/agent-workbench/**/*.md' }],
    ['Read', { path: 'docs/agent-workbench/CONTEXT.md' }],
  ].map(([name, args], index) =>
    agentTool({
      id: `toolu_explore_t1_${index + 1}`,
      name,
      arguments: args,
      output: { ok: true },
      generationId: 'gen-turn-1',
      conversationId: 'conv-mock',
      startedAt: new Date(Date.parse(t1) + index * 1000).toISOString(),
      launchesProcess: false,
    }),
  );

  const writeTurn1 = agentTool({
    id: 'toolu_write_t1',
    name: 'Write',
    arguments: {
      path: 'apps/worker/src/quick-summary/body.ts',
      contents: '// mock edit',
    },
    output: { ok: true },
    generationId: 'gen-turn-1',
    conversationId: 'conv-mock',
    startedAt: '2026-08-01T08:00:20.000Z',
    launchesProcess: false,
  });

  const shellTurn1 = agentTool({
    id: 'toolu_shell_t1',
    name: 'Shell',
    arguments: {
      command: 'node apps/worker/dist/jobs/run-keep-pipeline.js',
    },
    output: { exitCode: 0, stdout: 'pipeline ok' },
    generationId: 'gen-turn-1',
    conversationId: 'conv-mock',
    startedAt: '2026-08-01T08:00:30.000Z',
    endedAt: '2026-08-01T08:00:35.000Z',
    durationMs: 5000,
    launchesProcess: true,
  });

  const exploreTurn2 = [
    ['Read', { path: 'apps/worker/src/jobs/ai.processor.ts' }],
    ['Grep', { pattern: 'quick_summary', glob: '*.ts' }],
    ['Glob', { glob_pattern: 'apps/worker/src/jobs/*' }],
  ].map(([name, args], index) =>
    agentTool({
      id: `toolu_explore_t2_${index + 1}`,
      name,
      arguments: args,
      output: { ok: true },
      generationId: 'gen-turn-2',
      conversationId: 'conv-mock',
      startedAt: new Date(Date.parse(t2) + index * 1000).toISOString(),
      launchesProcess: false,
    }),
  );

  const shellTurn2 = agentTool({
    id: 'toolu_shell_t2',
    name: 'Shell',
    arguments: {
      command: 'node packages/program-tracer/scripts/dogfood-worker-summarize.cjs',
    },
    output: { exitCode: 0, stdout: 'summary ok' },
    generationId: 'gen-turn-2',
    conversationId: 'conv-mock',
    startedAt: '2026-08-01T08:05:10.000Z',
    endedAt: '2026-08-01T08:05:12.000Z',
    durationMs: 2000,
    launchesProcess: true,
  });

  const agentSteps = [
    ...exploreTurn1,
    writeTurn1,
    shellTurn1,
    ...exploreTurn2,
    shellTurn2,
  ];

  // Program calls under shell turn 1: fetch then summarize (parent/child)
  const programRecords = [
    {
      callId: 1,
      methodId: 1,
      parentCallId: null,
      processOriginId: 'toolu_shell_t1',
      activityId: 'activity-keep-1',
      startedAt: Date.parse('2026-08-01T08:00:31.000Z'),
      endedAt: Date.parse('2026-08-01T08:00:32.200Z'),
      durationMs: 1200,
      args: ['https://example.com/a'],
      result: {
        title: '示例文章 A',
        text: { $type: 'string', $length: 1200, $preview: '正文预览…' },
      },
      snapshotDegraded: true,
    },
    {
      callId: 2,
      methodId: 2,
      parentCallId: 1,
      processOriginId: 'toolu_shell_t1',
      activityId: 'activity-keep-1',
      startedAt: Date.parse('2026-08-01T08:00:32.200Z'),
      endedAt: Date.parse('2026-08-01T08:00:33.800Z'),
      durationMs: 1600,
      args: [{ title: '示例文章 A', content: '正文…' }],
      result: '示例文章提出了旁路观察应记录边界方法而非全部内部细节。',
    },
    {
      callId: 3,
      methodId: 1,
      parentCallId: null,
      processOriginId: 'toolu_shell_t1',
      activityId: 'activity-keep-2',
      startedAt: Date.parse('2026-08-01T08:00:33.900Z'),
      endedAt: Date.parse('2026-08-01T08:00:34.400Z'),
      durationMs: 500,
      args: ['https://example.com/b'],
      result: null,
      error: { name: 'Error', message: 'Article request failed (404)' },
    },
    {
      callId: 4,
      methodId: 2,
      parentCallId: null,
      processOriginId: 'toolu_shell_t2',
      activityId: null,
      startedAt: Date.parse('2026-08-01T08:05:10.500Z'),
      endedAt: Date.parse('2026-08-01T08:05:11.800Z'),
      durationMs: 1300,
      args: [{ title: '追踪器验收用短文', content: '旁路观察…' }],
      result: '旁路观察记录边界方法参数、返回值与耗时。',
    },
  ];

  // Ensure manifest exists for labels.
  const manifestPath = path.join(outDir, 'trace-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const fallbackManifest = path.join(
      repoRoot,
      'packages/program-tracer/fixtures/sample-app/trace-manifest.json',
    );
    const besideWorkerManifest = process.env.BESIDE_ROOT
      ? path.join(
          process.env.BESIDE_ROOT,
          'apps/worker/.agent-workbench/trace-manifest.json',
        )
      : '';
    if (besideWorkerManifest && fs.existsSync(besideWorkerManifest)) {
      fs.copyFileSync(besideWorkerManifest, manifestPath);
    } else if (fs.existsSync(fallbackManifest)) {
      fs.writeFileSync(
        manifestPath,
        `${JSON.stringify(
          {
            version: 1,
            projectRoot: '.',
            methods: [
              {
                id: 1,
                sourceFile: 'article-content/body.ts',
                compiledFile: 'article-content/body.js',
                className: 'ContentFetcher',
                methodName: 'fetch',
              },
              {
                id: 2,
                sourceFile: 'quick-summary/body.ts',
                compiledFile: 'quick-summary/body.js',
                className: 'QuickSummarizer',
                methodName: 'summarize',
              },
            ],
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    }
  }

  writeJsonl(path.join(outDir, 'agent-steps.jsonl'), agentSteps);
  writeJsonl(path.join(outDir, 'trace-records.jsonl'), programRecords);

  console.log(
    JSON.stringify(
      {
        outDir,
        agentSteps: agentSteps.length,
        programRecords: programRecords.length,
        turns: 2,
        note: 'Open viewer to see collapsed explores + nested program calls',
      },
      null,
      2,
    ),
  );
}

main();
