#!/usr/bin/env node
/**
 * Compare two bench reports (before / after).
 *
 * Usage:
 *   node bench/diff.mjs --before <report.json> --after <report.json>
 *   node bench/diff.mjs --before <runDir> --after <runDir>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './lib/io.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = argv.slice(2);
  let before;
  let after;
  let out;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--before' || arg === '-b') {
      before = args[++i];
      continue;
    }
    if (arg === '--after' || arg === '-a') {
      after = args[++i];
      continue;
    }
    if (arg === '--out' || arg === '-o') {
      out = args[++i];
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!before || !after) {
    throw new Error('Need --before and --after report paths (or run dirs)');
  }

  return {
    before: path.resolve(before),
    after: path.resolve(after),
    out: out ? path.resolve(out) : null,
  };
}

function printHelp() {
  console.log(`Usage:
  node bench/diff.mjs --before <report|dir> --after <report|dir> [--out diff.json]
`);
}

function resolveReport(inputPath) {
  if (fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory()) {
    const nested = path.join(inputPath, 'report.json');
    if (!fs.existsSync(nested)) {
      throw new Error(`No report.json in ${inputPath}`);
    }
    return nested;
  }
  return inputPath;
}

const HIGHER_IS_BETTER = new Set([
  'link_rate',
  'parent_child_accuracy',
  'agent_tool_count',
  'program_record_count',
]);

const LOWER_IS_BETTER = new Set([
  'explore_noise_ratio',
  'incomplete_rate',
  'latency_overhead_p50',
  'latency_baseline_ms_p50',
  'latency_traced_ms_p50',
]);

function deltaScore(name, beforeValue, afterValue) {
  if (typeof beforeValue === 'boolean' || typeof afterValue === 'boolean') {
    const improved =
      beforeValue === true && afterValue === false
        ? true
        : beforeValue === false && afterValue === true
          ? false
          : null;
    return {
      before: beforeValue,
      after: afterValue,
      delta: beforeValue === afterValue ? 0 : afterValue ? 1 : -1,
      improved,
    };
  }

  if (typeof beforeValue !== 'number' || typeof afterValue !== 'number') {
    return {
      before: beforeValue,
      after: afterValue,
      delta: null,
      improved: null,
    };
  }

  const delta = round4(afterValue - beforeValue);
  let improved = null;
  if (HIGHER_IS_BETTER.has(name)) {
    improved = delta > 0 ? true : delta < 0 ? false : null;
  } else if (LOWER_IS_BETTER.has(name)) {
    improved = delta < 0 ? true : delta > 0 ? false : null;
  }

  return { before: beforeValue, after: afterValue, delta, improved };
}

function compareReports(before, after) {
  const beforeMap = new Map(before.scenarios.map((s) => [s.id, s]));
  const afterMap = new Map(after.scenarios.map((s) => [s.id, s]));
  const ids = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();

  const scenarios = ids.map((id) => {
    const b = beforeMap.get(id);
    const a = afterMap.get(id);
    if (!b || !a) {
      return {
        id,
        status: 'missing',
        beforePresent: Boolean(b),
        afterPresent: Boolean(a),
      };
    }

    const scoreNames = [
      ...new Set([
        ...Object.keys(b.scores || {}),
        ...Object.keys(a.scores || {}),
      ]),
    ].sort();

    const scores = {};
    for (const name of scoreNames) {
      scores[name] = deltaScore(name, b.scores?.[name], a.scores?.[name]);
    }

    return {
      id,
      beforePass: b.pass,
      afterPass: a.pass,
      passChanged:
        b.pass === a.pass ? 'same' : a.pass ? 'regressed_to_pass' : 'regressed_to_fail',
      // clearer labels:
      outcome:
        b.pass === a.pass
          ? a.pass
            ? 'still_pass'
            : 'still_fail'
          : a.pass
            ? 'fixed'
            : 'regressed',
      scores,
      beforeFailures: b.failures || [],
      afterFailures: a.failures || [],
    };
  });

  const fixed = scenarios.filter((s) => s.outcome === 'fixed').map((s) => s.id);
  const regressed = scenarios
    .filter((s) => s.outcome === 'regressed')
    .map((s) => s.id);
  const stillFail = scenarios
    .filter((s) => s.outcome === 'still_fail')
    .map((s) => s.id);

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    before: {
      path: before._path,
      label: before.label,
      createdAt: before.createdAt,
      pass: before.summary?.pass,
    },
    after: {
      path: after._path,
      label: after.label,
      createdAt: after.createdAt,
      pass: after.summary?.pass,
    },
    summary: {
      fixed,
      regressed,
      still_fail: stillFail,
      improved:
        fixed.length > 0 && regressed.length === 0 && stillFail.length === 0,
      safe_improve: fixed.length > 0 && regressed.length === 0,
    },
    scenarios,
  };
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function main() {
  const { before, after, out } = parseArgs(process.argv);
  const beforePath = resolveReport(before);
  const afterPath = resolveReport(after);
  const beforeReport = readJson(beforePath);
  const afterReport = readJson(afterPath);
  beforeReport._path = beforePath;
  afterReport._path = afterPath;

  const diff = compareReports(beforeReport, afterReport);
  const outPath =
    out ||
    path.join(
      path.dirname(afterPath),
      `diff-vs-${path.basename(path.dirname(beforePath))}.json`,
    );
  writeJson(outPath, diff);

  console.log(
    JSON.stringify(
      {
        outPath,
        summary: diff.summary,
        scenarios: diff.scenarios.map((s) => ({
          id: s.id,
          outcome: s.outcome || s.status,
          scores: s.scores,
        })),
      },
      null,
      2,
    ),
  );

  if (diff.summary.regressed.length > 0) {
    process.exit(2);
  }
  process.exit(0);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
