'use strict';

const { Probe } = require('./body.cjs');

async function main() {
  const mode = process.argv[2] || 'success';
  const input = {
    DEEPSEEK_API_KEY: 'sk-test-1234567890abcdef',
    accessToken: 'access-secret',
    command: 'TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz node app.js',
    content: 'A token budget is ordinary product text.',
    fail: mode === 'error',
  };
  const probe = new Probe();
  const echoed = probe.echo(input);
  const result = await probe.outer(echoed);
  console.log(`RESULT:${JSON.stringify(result)}`);
}

main().catch(() => {
  process.exitCode = 2;
});
