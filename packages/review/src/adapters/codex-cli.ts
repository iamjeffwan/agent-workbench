import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  ReviewModelAdapter,
  ReviewModelRequest,
  ReviewModelResponse,
} from '../execution.js';

export type CodexCliCommand = {
  executable: string;
  args: string[];
  cwd: string;
  input: string;
  stdoutPath: string;
  stderrPath: string;
};

export type CodexCliCommandRunner = (command: CodexCliCommand) => Promise<void>;

export type CodexCliReviewModelAdapterOptions = {
  artifactDirectory: string;
  workingDirectory: string;
  model?: string;
  modelVersion?: string;
  executable?: string;
  serviceTier?: 'fast' | 'flex';
  runCommand?: CodexCliCommandRunner;
};

export function createCodexCliReviewModelAdapter(
  options: CodexCliReviewModelAdapterOptions,
): ReviewModelAdapter {
  const model = options.model ?? 'gpt-5.6-sol';
  const executable = options.executable ?? defaultCodexExecutable();
  const runCommand = options.runCommand ?? runCodexCommand;
  return {
    descriptor: {
      provider: 'openai',
      model,
      ...(options.modelVersion ? { modelVersion: options.modelVersion } : {}),
      transport: 'codex-cli',
    },
    async review(request): Promise<ReviewModelResponse> {
      const runDirectory = path.join(options.artifactDirectory, request.runId);
      const schemaPath = path.join(runDirectory, 'output-schema.json');
      const requestPath = path.join(runDirectory, 'request.json');
      const outputPath = path.join(runDirectory, 'last-message.json');
      const stdoutPath = path.join(runDirectory, 'stdout.log');
      const stderrPath = path.join(runDirectory, 'stderr.log');
      await mkdir(runDirectory, { recursive: true });
      await writeFile(schemaPath, `${JSON.stringify(request.outputSchema, null, 2)}\n`, 'utf8');
      await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
      await runCommand({
        executable,
        args: [
          'exec',
          ...(options.serviceTier ? ['--config', `service_tier="${options.serviceTier}"`] : []),
          '--model', model,
          '--sandbox', 'read-only',
          '--cd', runDirectory,
          '--skip-git-repo-check',
          '--output-schema', schemaPath,
          '--output-last-message', outputPath,
          '--color', 'never',
          '--ephemeral',
        ],
        cwd: options.workingDirectory,
        input: buildPrompt(request),
        stdoutPath,
        stderrPath,
      });
      const output = JSON.parse(await readFile(outputPath, 'utf8')) as unknown;
      return { output };
    },
  };
}

function buildPrompt(request: ReviewModelRequest): string {
  return `${request.systemPrompt}\n\nReview case:\n${JSON.stringify(request.reviewCase)}\n\nEvidence package:\n${JSON.stringify(request.evidencePackage)}`;
}

function runCodexCommand(command: CodexCliCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const powershellScript = process.platform === 'win32' && command.executable.toLowerCase().endsWith('.ps1');
    const child = execFileCallback(
      powershellScript ? 'powershell.exe' : command.executable,
      powershellScript
        ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', command.executable, ...command.args]
        : command.args,
      {
        cwd: command.cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        Promise.all([
          writeFile(command.stdoutPath, stdout, 'utf8'),
          writeFile(command.stderrPath, stderr, 'utf8'),
        ]).then(() => {
          if (error) reject(new Error(`Codex CLI exited with code ${error.code ?? 'unknown'}.`));
          else resolve();
        }, reject);
      },
    );
    child.stdin?.end(command.input);
  });
}

function defaultCodexExecutable(): string {
  if (process.platform !== 'win32') return 'codex';
  const candidates = [
    process.env.PNPM_HOME && path.join(process.env.PNPM_HOME, 'codex.ps1'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'pnpm', 'codex.ps1'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'codex.ps1'),
  ].filter((value): value is string => Boolean(value));
  return candidates.find(candidate => existsSync(candidate)) ?? 'codex.ps1';
}
