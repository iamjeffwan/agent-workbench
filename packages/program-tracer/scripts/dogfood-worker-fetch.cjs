'use strict';

/**
 * Dogfood: run worker's ReadabilityContentFetcher.fetch under the guest tracer.
 * Assumes tracer + worker are already built, and a manifest exists.
 */

const http = require('node:http');
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
  const bodyPath = path.join(workerRoot, 'dist/article-content/body.js');
  const outPath = path.join(workerRoot, '.agent-workbench', 'trace-records.jsonl');

  if (!fs.existsSync(bodyPath)) {
    throw new Error(
      `Missing ${bodyPath}; set BESIDE_ROOT and build @beside/worker`,
    );
  }

  if (fs.existsSync(outPath)) {
    fs.unlinkSync(outPath);
  }

  const html = `<!doctype html>
<html><head><title>Dogfood Article</title></head>
<body>
  <article>
    <h1>Dogfood Article</h1>
    <p>${'This is enough readable text for Readability. '.repeat(20)}</p>
  </article>
</body></html>`;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/article`;

  try {
    const { ReadabilityContentFetcher } = require(bodyPath);
    const fetcher = new ReadabilityContentFetcher();
    const article = await fetcher.fetch(url);
    console.log(
      JSON.stringify(
        {
          title: article?.title ?? null,
          textLength: article?.text?.length ?? 0,
          outPath,
        },
        null,
        2,
      ),
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  if (!fs.existsSync(outPath)) {
    throw new Error(`Expected trace file missing: ${outPath}`);
  }

  const lines = fs
    .readFileSync(outPath, 'utf8')
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const fetchRecords = lines.filter((line) => line.methodId === 1);
  if (fetchRecords.length === 0) {
    throw new Error(`No fetch records in ${outPath}`);
  }

  console.log(
    JSON.stringify(
      {
        recordCount: fetchRecords.length,
        sample: fetchRecords[0],
      },
      null,
      2,
    ),
  );
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
