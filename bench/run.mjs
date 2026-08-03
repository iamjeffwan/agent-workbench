#!/usr/bin/env node
/**
 * Agent Workbench closed-loop bench runner.
 *
 * Writes a stable JSON report under bench/results/<stamp>/report.json
 * Exit 0 only when every selected scenario passes.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, readJson, readJsonl, writeJson } from './lib/io.mjs';
import { scoreArtifacts, scoreOverhead } from './lib/score.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const scenariosDir = path.join(__dirname, 'scenarios');
const resultsRoot = path.join(__dirname, 'results');
const REPORT_SCHEMA = 1;

function parseArgs(argv) {
  const args = argv.slice(2);
  const selected = [];
  let label = '';
  let outDir = '';
  let keepGoing = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--scenario' || arg === '-s') {
      selected.push(args[++i]);
      continue;
    }
    if (arg === '--label' || arg === '-l') {
      label = args[++i] || '';
      continue;
    }
    if (arg === '--out-dir') {
      outDir = path.resolve(args[++i] || '');
      continue;
    }
    if (arg === '--keep-going') {
      keepGoing = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  return { selected, label, outDir, keepGoing };
}

function printHelp() {
  console.log(`Usage:
  node bench/run.mjs [--scenario <id>]... [--label <name>] [--out-dir <path>] [--keep-going]

Examples:
  node bench/run.mjs --label before
  node bench/run.mjs -s A_mock_multi_call -s B_local_shell_link --label after
`);
}

function listScenarios(selected) {
  const files = fs
    .readdirSync(scenariosDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const scenarios = files.map((name) =>
    readJson(path.join(scenariosDir, name)),
  );
  if (!selected.length) {
    return scenarios;
  }
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  return selected.map((id) => {
    const hit = byId.get(id);
    if (!hit) {
      throw new Error(`Unknown scenario: ${id}`);
    }
    return hit;
  });
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
    ].join('') +
    '-' +
    [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join('')
  );
}

function runNode(scriptPath, args, options = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
  });
  return result;
}

function runCommand(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: options.shell ?? false,
  });
  return {
    ...result,
    durationMs: Date.now() - started,
  };
}

function ensureTracerBuilt() {
  const preload = path.join(
    repoRoot,
    'packages/program-tracer/dist/guest/preload.js',
  );
  if (fs.existsSync(preload)) {
    return { built: false, preload };
  }
  console.error('[bench] program-tracer preload missing; building…');
  const build = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['--filter', '@agent-workbench/program-tracer', 'build'],
    { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' },
  );
  if (build.status !== 0 || !fs.existsSync(preload)) {
    throw new Error(
      `Failed to build program-tracer:\n${build.stdout || ''}\n${build.stderr || ''}`,
    );
  }
  return { built: true, preload };
}

async function runSeedMock(scenario, workDir) {
  const seedScript = path.join(
    repoRoot,
    'packages/program-tracer/scripts/seed-mock-timeline.mjs',
  );
  const result = runNode(seedScript, ['--out-dir', workDir]);
  if (result.status !== 0) {
    return {
      pass: false,
      scores: {},
      failures: [
        {
          type: 'seed_failed',
          status: result.status,
          stderr: (result.stderr || '').slice(0, 1000),
        },
      ],
      artifacts: {},
    };
  }

  const agentSteps = readJsonl(path.join(workDir, 'agent-steps.jsonl'));
  const programRecords = readJsonl(path.join(workDir, 'trace-records.jsonl'));
  const scored = scoreArtifacts({
    agentSteps,
    programRecords,
    expect: scenario.expect || {},
  });

  return {
    ...scored,
    artifacts: {
      agentSteps: path.join(workDir, 'agent-steps.jsonl'),
      programRecords: path.join(workDir, 'trace-records.jsonl'),
    },
  };
}

async function runLocalInject(scenario, workDir) {
  ensureTracerBuilt();
  const sampleApp = path.join(
    repoRoot,
    'packages/program-tracer/fixtures/sample-app',
  );
  const origin = 'bench_shell_link_1';
  const manifest = path.join(sampleApp, 'trace-manifest.json');
  const outPath = path.join(workDir, 'trace-records.jsonl');
  const agentPath = path.join(workDir, 'agent-steps.jsonl');
  const observe = path.join(
    repoRoot,
    'packages/program-tracer/scripts/observe-run.mjs',
  );
  const mainJs = path.join(sampleApp, 'main.cjs');

  fs.writeFileSync(
    agentPath,
    `${JSON.stringify({
      kind: 'agent_tool',
      id: origin,
      name: 'Shell',
      status: 'completed',
      provider: 'bench',
      source: 'bench',
      arguments: { command: `node ${mainJs}` },
      output: { exitCode: 0 },
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      launchesProcess: true,
      generationId: 'bench-local-inject',
    })}\n`,
    'utf8',
  );

  if (fs.existsSync(outPath)) {
    fs.unlinkSync(outPath);
  }

  const result = runNode(observe, [
    '--origin',
    origin,
    '--manifest',
    manifest,
    '--out',
    outPath,
    '--',
    process.execPath,
    mainJs,
  ]);

  if (result.status !== 0) {
    return {
      pass: false,
      scores: {},
      failures: [
        {
          type: 'inject_command_failed',
          status: result.status,
          stderr: (result.stderr || '').slice(0, 1500),
          stdout: (result.stdout || '').slice(0, 500),
        },
      ],
      artifacts: { agentSteps: agentPath, programRecords: outPath },
    };
  }

  // Give async file flush a brief settle on Windows.
  await sleep(50);
  const agentSteps = readJsonl(agentPath);
  const programRecords = readJsonl(outPath);
  const scored = scoreArtifacts({
    agentSteps,
    programRecords,
    expect: scenario.expect || {},
  });

  return {
    ...scored,
    artifacts: {
      agentSteps: agentPath,
      programRecords: outPath,
    },
    command: {
      status: result.status,
      stderrTail: (result.stderr || '').slice(-400),
    },
  };
}

async function runOverhead(scenario, workDir) {
  ensureTracerBuilt();
  const sampleApp = path.join(
    repoRoot,
    'packages/program-tracer/fixtures/sample-app',
  );
  const mainJs = path.join(sampleApp, 'main.cjs');
  const manifest = path.join(sampleApp, 'trace-manifest.json');
  const observe = path.join(
    repoRoot,
    'packages/program-tracer/scripts/observe-run.mjs',
  );
  const repeat = Math.max(1, Number(scenario.repeat) || 5);
  const warmup = Math.max(0, Number(scenario.warmup) || 0);
  const baselineMs = [];
  const tracedMs = [];
  const recordCounts = [];

  for (let i = 0; i < warmup; i += 1) {
    runCommand(process.execPath, [mainJs], { cwd: sampleApp });
  }

  for (let i = 0; i < repeat; i += 1) {
    const baseline = runCommand(process.execPath, [mainJs], {
      cwd: sampleApp,
    });
    if (baseline.status !== 0) {
      return {
        pass: false,
        scores: {},
        failures: [{ type: 'baseline_run_failed', status: baseline.status }],
        artifacts: {},
      };
    }
    baselineMs.push(baseline.durationMs);
  }

  for (let i = 0; i < repeat; i += 1) {
    const outPath = path.join(workDir, `trace-records-${i}.jsonl`);
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    const started = Date.now();
    const child = spawnSync(
      process.execPath,
      [
        observe,
        '--origin',
        `bench_overhead_${i}`,
        '--manifest',
        manifest,
        '--out',
        outPath,
        '--',
        process.execPath,
        mainJs,
      ],
      { cwd: repoRoot, encoding: 'utf8', shell: false },
    );
    const durationMs = Date.now() - started;
    if (child.status !== 0) {
      return {
        pass: false,
        scores: {},
        failures: [
          {
            type: 'traced_run_failed',
            index: i,
            status: child.status,
            stderr: (child.stderr || '').slice(0, 1000),
          },
        ],
        artifacts: {},
      };
    }
    await sleep(40);
    const records = readJsonl(outPath).filter((r) => !r.parseError);
    recordCounts.push(records.length);
    tracedMs.push(durationMs);
  }

  const overheadScored = scoreOverhead({
    baselineMs,
    tracedMs,
    expect: scenario.expect || {},
  });

  const zeroRecords = recordCounts.filter((n) => n < 1).length;
  if (zeroRecords > 0) {
    overheadScored.pass = false;
    overheadScored.failures.push({
      type: 'traced_missing_records',
      zeroRecords,
      recordCounts,
    });
    overheadScored.scores.silent_drop = true;
  }

  return {
    ...overheadScored,
    artifacts: {
      workDir,
      recordCounts,
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runScenario(scenario, runDir) {
  const workDir = path.join(runDir, 'scenarios', scenario.id);
  ensureDir(workDir);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  let result;
  try {
    if (scenario.type === 'seed_mock') {
      result = await runSeedMock(scenario, workDir);
    } else if (scenario.type === 'local_inject') {
      result = await runLocalInject(scenario, workDir);
    } else if (scenario.type === 'overhead') {
      result = await runOverhead(scenario, workDir);
    } else {
      result = {
        pass: false,
        scores: {},
        failures: [{ type: 'unknown_scenario_type', value: scenario.type }],
        artifacts: {},
      };
    }
  } catch (error) {
    result = {
      pass: false,
      scores: {},
      failures: [
        {
          type: 'scenario_exception',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      artifacts: {},
    };
  }

  return {
    id: scenario.id,
    description: scenario.description || '',
    type: scenario.type,
    pass: Boolean(result.pass),
    scores: result.scores || {},
    failures: result.failures || [],
    artifacts: result.artifacts || {},
    durationMs: Date.now() - startedMs,
    startedAt,
    endedAt: new Date().toISOString(),
  };
}

async function main() {
  const { selected, label, outDir, keepGoing } = parseArgs(process.argv);
  const scenarios = listScenarios(selected);
  const runDir =
    outDir ||
    path.join(
      resultsRoot,
      `${stamp()}${label ? `-${sanitize(label)}` : ''}`,
    );
  ensureDir(runDir);

  const report = {
    schemaVersion: REPORT_SCHEMA,
    label: label || null,
    createdAt: new Date().toISOString(),
    repoRoot,
    runDir,
    node: process.version,
    platform: process.platform,
    scenarios: [],
    summary: {
      total: scenarios.length,
      passed: 0,
      failed: 0,
      pass: false,
    },
  };

  for (const scenario of scenarios) {
    console.error(`[bench] running ${scenario.id}…`);
    const item = await runScenario(scenario, runDir);
    report.scenarios.push(item);
    console.error(
      `[bench] ${scenario.id}: ${item.pass ? 'PASS' : 'FAIL'} (${item.durationMs}ms)`,
    );
    if (!item.pass && !keepGoing) {
      break;
    }
  }

  report.summary.passed = report.scenarios.filter((s) => s.pass).length;
  report.summary.failed = report.scenarios.filter((s) => !s.pass).length;
  report.summary.pass =
    report.summary.failed === 0 &&
    report.summary.passed === report.summary.total;

  const reportPath = path.join(runDir, 'report.json');
  writeJson(reportPath, report);
  writeJson(path.join(resultsRoot, 'latest.json'), {
    runDir,
    reportPath,
    label: report.label,
    createdAt: report.createdAt,
    pass: report.summary.pass,
  });

  console.log(
    JSON.stringify(
      {
        reportPath,
        runDir,
        pass: report.summary.pass,
        passed: report.summary.passed,
        failed: report.summary.failed,
        total: report.summary.total,
        scenarios: report.scenarios.map((s) => ({
          id: s.id,
          pass: s.pass,
          scores: s.scores,
          failures: s.failures,
        })),
      },
      null,
      2,
    ),
  );

  process.exit(report.summary.pass ? 0 : 1);
}

function sanitize(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
