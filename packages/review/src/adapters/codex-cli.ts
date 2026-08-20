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
  requiredEnvironmentVariable?: string;
};

export type CodexCliCommandRunner = (command: CodexCliCommand) => Promise<void>;

export type CodexCliReviewModelAdapterOptions = {
  artifactDirectory: string;
  workingDirectory: string;
  model?: string;
  modelVersion?: string;
  executable?: string;
  serviceTier?: 'fast' | 'flex';
  customProvider?: CodexCliCustomProvider;
  runCommand?: CodexCliCommandRunner;
};

export type CodexCliCustomProvider = {
  id: string;
  name?: string;
  baseUrl: string;
  apiKeyEnv: string;
  supportsWebSockets?: boolean;
};

export function createCodexCliReviewModelAdapter(
  options: CodexCliReviewModelAdapterOptions,
): ReviewModelAdapter {
  const model = options.model ?? 'gpt-5.6-sol';
  const executable = options.executable ?? defaultCodexExecutable();
  const runCommand = options.runCommand ?? runCodexCommand;
  const customProvider = options.customProvider
    ? validateCustomProvider(options.customProvider)
    : undefined;
  return {
    descriptor: {
      provider: customProvider?.id ?? 'openai',
      model,
      ...(options.modelVersion ? { modelVersion: options.modelVersion } : {}),
      transport: 'codex-cli',
    },
    async review(request): Promise<ReviewModelResponse> {
      const runDirectory = artifactRunDirectory(options.artifactDirectory, request.runId);
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
          ...(customProvider ? customProviderArguments(customProvider) : []),
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
        ...(customProvider ? { requiredEnvironmentVariable: customProvider.apiKeyEnv } : {}),
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
    if (command.requiredEnvironmentVariable && !process.env[command.requiredEnvironmentVariable]) {
      reject(new Error(`Required API key environment variable is not set: ${command.requiredEnvironmentVariable}`));
      return;
    }
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

function customProviderArguments(provider: CodexCliCustomProvider): string[] {
  const prefix = `model_providers.${provider.id}`;
  return [
    '--config', `model_provider=${tomlString(provider.id)}`,
    '--config', `${prefix}.name=${tomlString(provider.name ?? provider.id)}`,
    '--config', `${prefix}.base_url=${tomlString(provider.baseUrl)}`,
    '--config', `${prefix}.env_key=${tomlString(provider.apiKeyEnv)}`,
    '--config', `${prefix}.wire_api="responses"`,
    '--config', `${prefix}.requires_openai_auth=false`,
    '--config', `${prefix}.supports_websockets=${provider.supportsWebSockets ?? false}`,
  ];
}

function validateCustomProvider(provider: CodexCliCustomProvider): CodexCliCustomProvider {
  const id = provider.id.trim();
  const apiKeyEnv = provider.apiKeyEnv.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new TypeError('Custom provider id may contain only letters, numbers, underscores, and hyphens.');
  }
  if (['openai', 'ollama', 'lmstudio'].includes(id.toLowerCase())) {
    throw new TypeError(`Custom provider id is reserved: ${id}`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) {
    throw new TypeError('Custom provider API key environment variable name is invalid.');
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(provider.baseUrl);
  } catch {
    throw new TypeError('Custom provider base URL is invalid.');
  }
  const localHttp = baseUrl.protocol === 'http:'
    && ['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname);
  if (baseUrl.protocol !== 'https:' && !localHttp) {
    throw new TypeError('Custom provider base URL must use HTTPS, except for localhost.');
  }
  if (baseUrl.username || baseUrl.password) {
    throw new TypeError('Custom provider base URL must not contain credentials.');
  }
  return {
    id,
    ...(provider.name?.trim() ? { name: provider.name.trim() } : {}),
    baseUrl: baseUrl.toString().replace(/\/$/, ''),
    apiKeyEnv,
    ...(provider.supportsWebSockets !== undefined
      ? { supportsWebSockets: provider.supportsWebSockets }
      : {}),
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function artifactRunDirectory(artifactDirectory: string, runId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId)) {
    throw new TypeError('Review run identifier may contain only letters, numbers, underscores, and hyphens.');
  }
  const root = path.resolve(artifactDirectory);
  const runDirectory = path.resolve(root, runId);
  if (path.dirname(runDirectory) !== root) {
    throw new TypeError('Review run identifier must resolve inside the artifact directory.');
  }
  return runDirectory;
}

function defaultCodexExecutable(): string {
  if (process.platform !== 'win32') return 'codex';
  const candidates = [
    process.env.CODEX_CLI_PATH,
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'codex.ps1'),
    process.env.PNPM_HOME && path.join(process.env.PNPM_HOME, 'codex.ps1'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'pnpm', 'codex.ps1'),
  ].filter((value): value is string => Boolean(value));
  return candidates.find(candidate => existsSync(candidate)) ?? 'codex.ps1';
}
