#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { redactCredentialText } from '../../agent-workbench-security/index.mjs';
import {
  defaultCursorProjectsDir,
  findCursorTranscripts,
  findCursorTranscriptsForWorkspace,
  latestCursorTranscript,
} from './find-transcripts.js';
import { parseCursorTranscript } from './parse-transcript.js';

function printHelp(): void {
  console.error(`Usage:
  node dist/cli.js [--session <transcript.jsonl>] [--workspace <dir>] [--out <agent-steps.jsonl>] [--list]

Reads Cursor agent-transcripts and writes normalized agent tool steps.
`);
}

function main(argv: string[]): void {
  const args = argv.slice(2);
  let sessionArg: string | undefined;
  let workspace: string | undefined;
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
    if (arg === '--workspace' || arg === '-w') {
      workspace = args[++i];
      continue;
    }
    if (arg === '--out' || arg === '-o') {
      outPath = args[++i];
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (listOnly) {
    const sessions = workspace
      ? findCursorTranscriptsForWorkspace(workspace)
      : findCursorTranscripts();
    console.log(
      JSON.stringify(
        {
          projectsDir: defaultCursorProjectsDir(),
          count: sessions.length,
          sessions: sessions.slice(0, 20),
        },
        null,
        2,
      ),
    );
    return;
  }

  let resolvedSession: string | undefined;
  if (sessionArg) {
    resolvedSession = path.resolve(sessionArg);
  } else if (workspace) {
    resolvedSession = findCursorTranscriptsForWorkspace(workspace)[0];
  } else {
    resolvedSession = latestCursorTranscript() ?? undefined;
  }

  if (!resolvedSession || !fs.existsSync(resolvedSession)) {
    throw new Error(
      sessionArg
        ? `Cursor transcript not found: ${resolvedSession}`
        : `No Cursor transcripts under ${defaultCursorProjectsDir()}. Pass --session <file>.`,
    );
  }

  const steps = parseCursorTranscript(resolvedSession);
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
        tools: steps.slice(0, 30).map((step) => ({
          id: step.id,
          name: step.name,
          provider: step.provider,
        })),
        truncated: steps.length > 30,
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
