#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { redactCredentialText } from '../../agent-workbench-security/index.mjs';
import {
  defaultCodexSessionsDir,
  findCodexSessions,
  latestCodexSession,
} from './find-sessions.js';
import { parseCodexRollout } from './parse-rollout.js';

function printHelp(): void {
  console.error(`Usage:
  node dist/cli.js [--session <rollout.jsonl>] [--out <agent-steps.jsonl>] [--list]

Reads Codex CLI rollout files and writes normalized agent tool steps.
`);
}

function main(argv: string[]): void {
  const args = argv.slice(2);
  let sessionArg: string | undefined;
  let outPath: string | undefined;
  let listOnly = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--list') {
      listOnly = true;
      continue;
    }
    if (arg === '--session' || arg === '-s') {
      sessionArg = args[++i];
      continue;
    }
    if (arg === '--out' || arg === '-o') {
      outPath = args[++i];
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (listOnly) {
    const sessions = findCodexSessions();
    console.log(
      JSON.stringify(
        {
          sessionsDir: defaultCodexSessionsDir(),
          count: sessions.length,
          sessions: sessions.slice(0, 20),
        },
        null,
        2,
      ),
    );
    return;
  }

  const resolvedSession = path.resolve(
    sessionArg ?? latestCodexSession() ?? '',
  );
  if (!resolvedSession || !fs.existsSync(resolvedSession)) {
    throw new Error(
      sessionArg
        ? `Codex session not found: ${resolvedSession}`
        : `No Codex sessions under ${defaultCodexSessionsDir()}. Pass --session <file>.`,
    );
  }

  const steps = parseCodexRollout(resolvedSession);
  const resolvedOut = path.resolve(
    outPath ?? path.join(process.cwd(), '.agent-workbench', 'agent-steps.jsonl'),
  );

  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(
    resolvedOut,
    `${steps.map((step) => JSON.stringify(step)).join('\n')}${steps.length ? '\n' : ''}`,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        session: resolvedSession,
        out: resolvedOut,
        toolCount: steps.length,
        tools: steps.map((step) => ({
          id: step.id,
          name: step.name,
          status: step.status,
        })),
      },
      null,
      2,
    ),
  );
}

try {
  main(process.argv);
} catch (error) {
  console.error(
    redactCredentialText(error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
}
