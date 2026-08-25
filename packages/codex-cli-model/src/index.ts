import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type CodexCliProvider = {
  id: string;
  name?: string;
  baseUrl: string;
  apiKeyEnv: string;
  supportsWebSockets?: boolean;
};

export type CodexCliModelConfig = {
  schemaVersion: 'codex-cli-model-config-1';
  model: string;
  modelVersion?: string;
  serviceTier?: 'fast' | 'flex';
  provider?: CodexCliProvider;
};

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

export type StructuredModelArtifact = {
  kind: 'request' | 'output_schema' | 'model_output' | 'stdout' | 'stderr';
  path: string;
  contentHash: string;
  byteLength: number;
};

export type CodexCliStructuredModelOptions = {
  artifactDirectory: string;
  workingDirectory: string;
  model?: string;
  modelVersion?: string;
  executable?: string;
  serviceTier?: 'fast' | 'flex';
  provider?: CodexCliProvider;
  runCommand?: CodexCliCommandRunner;
};

export type StructuredModelRequest = {
  invocationId: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
};

export type StructuredModelResponse = {
  output: unknown;
  artifacts: StructuredModelArtifact[];
};

export type CodexCliStructuredModel = {
  descriptor: {
    provider: string;
    model: string;
    modelVersion?: string;
    transport: 'codex-cli';
  };
  invoke(request: StructuredModelRequest): Promise<StructuredModelResponse>;
};

export class CodexCliInvocationError extends Error {
  readonly artifacts: StructuredModelArtifact[];

  constructor(message: string, artifacts: StructuredModelArtifact[]) {
    super(message);
    this.name = 'CodexCliInvocationError';
    this.artifacts = structuredClone(artifacts);
  }
}

export async function readCodexCliModelConfig(filePath: string): Promise<CodexCliModelConfig> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    throw new TypeError(`Unable to read model configuration ${path.resolve(filePath)}: ${reason}`);
  }
  return validateModelConfig(value);
}

export function createCodexCliStructuredModel(
  options: CodexCliStructuredModelOptions,
): CodexCliStructuredModel {
  const model = options.model ?? 'gpt-5.6-sol';
  const executable = options.executable ?? defaultCodexExecutable();
  const runCommand = options.runCommand ?? runCodexCommand;
  const provider = options.provider ? validateProvider(options.provider) : undefined;

  return {
    descriptor: {
      provider: provider?.id ?? 'openai',
      model,
      ...(options.modelVersion ? { modelVersion: options.modelVersion } : {}),
      transport: 'codex-cli',
    },
    async invoke(request) {
      const runDirectory = invocationDirectory(options.artifactDirectory, request.invocationId);
      const schemaPath = path.join(runDirectory, 'output-schema.json');
      const requestPath = path.join(runDirectory, 'request.json');
      const outputPath = path.join(runDirectory, 'last-message.json');
      const stdoutPath = path.join(runDirectory, 'stdout.log');
      const stderrPath = path.join(runDirectory, 'stderr.log');
      const candidates: ArtifactCandidate[] = [
        ['request', requestPath],
        ['output_schema', schemaPath],
        ['model_output', outputPath],
        ['stdout', stdoutPath],
        ['stderr', stderrPath],
      ];

      await mkdir(runDirectory, { recursive: true });
      await writeFile(schemaPath, `${JSON.stringify(request.outputSchema, null, 2)}\n`, 'utf8');
      await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');

      try {
        await runCommand({
          executable,
          args: [
            'exec',
            ...(provider ? providerArguments(provider) : []),
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
          input: request.prompt,
          stdoutPath,
          stderrPath,
          ...(provider ? { requiredEnvironmentVariable: provider.apiKeyEnv } : {}),
        });
        const output = JSON.parse(await readFile(outputPath, 'utf8')) as unknown;
        return { output, artifacts: await collectArtifacts(candidates) };
      } catch (error) {
        throw new CodexCliInvocationError(
          error instanceof Error ? error.message : 'Codex CLI invocation failed.',
          await collectArtifacts(candidates),
        );
      }
    },
  };
}

type ArtifactCandidate = [kind: StructuredModelArtifact['kind'], file: string];

async function collectArtifacts(candidates: ArtifactCandidate[]): Promise<StructuredModelArtifact[]> {
  const artifacts: StructuredModelArtifact[] = [];
  for (const [kind, file] of candidates) {
    if (!existsSync(file)) continue;
    const [content, metadata] = await Promise.all([readFile(file), stat(file)]);
    artifacts.push({
      kind,
      path: path.resolve(file),
      contentHash: createHash('sha256').update(content).digest('hex'),
      byteLength: metadata.size,
    });
  }
  return artifacts;
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

function providerArguments(provider: CodexCliProvider): string[] {
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

function validateProvider(provider: CodexCliProvider): CodexCliProvider {
  assertOnlyKeys(
    provider as unknown as Record<string, unknown>,
    ['id', 'name', 'baseUrl', 'apiKeyEnv', 'supportsWebSockets'],
    'Model provider configuration',
  );
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

function validateModelConfig(value: unknown): CodexCliModelConfig {
  if (!isRecord(value)) throw new TypeError('Model configuration must be an object.');
  assertOnlyKeys(value, ['schemaVersion', 'model', 'modelVersion', 'serviceTier', 'provider'], 'Model configuration');
  if (value.schemaVersion !== 'codex-cli-model-config-1') {
    throw new TypeError('Model configuration schemaVersion must be codex-cli-model-config-1.');
  }
  if (typeof value.model !== 'string' || !value.model.trim()) {
    throw new TypeError('Model configuration model must be a non-empty string.');
  }
  if (value.modelVersion !== undefined && (typeof value.modelVersion !== 'string' || !value.modelVersion.trim())) {
    throw new TypeError('Model configuration modelVersion must be a non-empty string when present.');
  }
  if (value.serviceTier !== undefined && value.serviceTier !== 'fast' && value.serviceTier !== 'flex') {
    throw new TypeError('Model configuration serviceTier must be fast or flex when present.');
  }
  if (value.provider !== undefined && !isRecord(value.provider)) {
    throw new TypeError('Model configuration provider must be an object when present.');
  }
  return {
    schemaVersion: 'codex-cli-model-config-1',
    model: value.model.trim(),
    ...(value.modelVersion ? { modelVersion: value.modelVersion.trim() } : {}),
    ...(value.serviceTier ? { serviceTier: value.serviceTier } : {}),
    ...(value.provider ? { provider: validateProvider(value.provider as CodexCliProvider) } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[], subject: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`${subject} contains unsupported field(s): ${unknown.join(', ')}.`);
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function invocationDirectory(artifactDirectory: string, invocationId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(invocationId)) {
    throw new TypeError('Invocation or run identifier may contain only letters, numbers, underscores, and hyphens.');
  }
  const root = path.resolve(artifactDirectory);
  const directory = path.resolve(root, invocationId);
  if (path.dirname(directory) !== root) {
    throw new TypeError('Invocation or run identifier must resolve inside the artifact directory.');
  }
  return directory;
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
