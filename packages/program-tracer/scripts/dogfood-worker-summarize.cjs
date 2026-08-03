'use strict';

/**
 * Dogfood: run worker's DeepSeekSummarizer.summarize under the guest tracer.
 */

const path = require('node:path');
const fs = require('node:fs');

function resolveBesideRoot() {
  if (process.env.BESIDE_ROOT) {
    return path.resolve(process.env.BESIDE_ROOT);
  }
  return path.resolve(__dirname, '../../../../Beside');
}

async function main() {
  const besideRoot = resolveBesideRoot();
  const workerRoot = path.join(besideRoot, 'apps/worker');
  const bodyPath = path.join(workerRoot, 'dist/quick-summary/body.js');
  const outPath =
    process.env.AGENT_WORKBENCH_TRACE_OUT ||
    path.join(workerRoot, '.agent-workbench', 'trace-records.jsonl');
  const envPath = path.join(workerRoot, '.env');

  if (!fs.existsSync(bodyPath)) {
    throw new Error(
      `Missing ${bodyPath}; set BESIDE_ROOT and build @beside/worker`,
    );
  }

  loadEnvFile(envPath);

  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    throw new Error('DEEPSEEK_API_KEY is not set in apps/worker/.env');
  }

  if (fs.existsSync(outPath)) {
    fs.unlinkSync(outPath);
  }

  const { DeepSeekSummarizer } = require(bodyPath);
  const summarizer = new DeepSeekSummarizer();
  const input = {
    title: '追踪器验收用短文',
    content:
      '旁路观察的目标是在不修改业务源码的前提下，记录边界方法的参数、返回值和耗时。首版只追踪接口实现方法，不进入第三方库内部。长文本应被快照截断成摘要，凭据字段需要隐藏。',
  };

  const summary = await summarizer.summarize(input);
  console.log(
    JSON.stringify(
      {
        summary,
        outPath,
      },
      null,
      2,
    ),
  );

  if (!fs.existsSync(outPath)) {
    throw new Error(`Expected trace file missing: ${outPath}`);
  }

  const lines = fs
    .readFileSync(outPath, 'utf8')
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const summarizeRecords = lines.filter((line) => line.methodId === 2);
  if (summarizeRecords.length === 0) {
    throw new Error(`No summarize records in ${outPath}`);
  }

  console.log(
    JSON.stringify(
      {
        recordCount: summarizeRecords.length,
        sample: summarizeRecords[0],
      },
      null,
      2,
    ),
  );
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

main().catch(async (error) => {
  const { redactCredentialText } = await import(
    '../../agent-workbench-security/index.mjs'
  );
  const detail =
    error instanceof Error ? error.stack || error.message : String(error);
  console.error(redactCredentialText(detail));
  process.exit(1);
});
