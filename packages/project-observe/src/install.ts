import fs from 'node:fs';
import path from 'node:path';

const MANAGED_MARKER = '.agent-workbench/cursor-hooks/';
const LEGACY_HOOK_MARKER = '.cursor/hooks/';
const HOOK_FILES = [
  'record-agent-tool.mjs',
  'inject-shell-trace.mjs',
  'run-with-trace.mjs',
  'record-code-state.mjs',
] as const;

export type InstallObservationOptions = {
  projectRoot: string;
  workbenchHome: string;
  /** Canonical hook implementations live here (usually workbenchHome/.cursor/hooks). */
  sourceHooksDir?: string;
};

export type InstallObservationResult = {
  projectRoot: string;
  workbenchHome: string;
  hooksDir: string;
  hooksConfigPath: string;
  observationPath: string;
  managedCommands: string[];
  warnings: string[];
};

type HookEntry = {
  command?: string;
  matcher?: string;
  timeout?: number;
  [key: string]: unknown;
};

type HooksConfig = {
  version?: number;
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
};

export function isWorkbenchManagedHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  if (command.includes(MANAGED_MARKER)) return true;
  return command.includes(LEGACY_HOOK_MARKER) && HOOK_FILES.some(
    (fileName) => command.includes(`${LEGACY_HOOK_MARKER}${fileName}`),
  );
}

export function mergeCursorHooksConfig(
  existing: HooksConfig | null | undefined,
): HooksConfig {
  const next: HooksConfig = {
    ...(existing ?? {}),
    version: existing?.version ?? 1,
    hooks: {},
  };

  const sourceHooks = existing?.hooks && typeof existing.hooks === 'object'
    ? existing.hooks
    : {};

  for (const [eventName, entries] of Object.entries(sourceHooks)) {
    if (!Array.isArray(entries)) continue;
    next.hooks![eventName] = entries.filter(
      (entry) => !isWorkbenchManagedHookCommand(entry?.command),
    );
  }

  const hooks = next.hooks!;
  hooks.preToolUse = [
    ...(hooks.preToolUse || []),
    {
      command: `node ${MANAGED_MARKER}inject-shell-trace.mjs`,
      matcher: 'Shell',
      timeout: 15,
    },
  ];
  hooks.postToolUse = [
    ...(hooks.postToolUse || []),
    {
      command: `node ${MANAGED_MARKER}record-agent-tool.mjs`,
      timeout: 10,
    },
  ];
  hooks.postToolUseFailure = [
    ...(hooks.postToolUseFailure || []),
    {
      command: `node ${MANAGED_MARKER}record-agent-tool.mjs`,
      timeout: 10,
    },
  ];
  hooks.beforeSubmitPrompt = [
    ...(hooks.beforeSubmitPrompt || []),
    {
      command: `node ${MANAGED_MARKER}record-code-state.mjs start`,
      timeout: 15,
    },
  ];
  hooks.stop = [
    ...(hooks.stop || []),
    {
      command: `node ${MANAGED_MARKER}record-code-state.mjs end`,
      timeout: 15,
    },
  ];

  return next;
}

export function installProjectObservation(
  options: InstallObservationOptions,
): InstallObservationResult {
  const projectRoot = path.resolve(options.projectRoot);
  const workbenchHome = path.resolve(options.workbenchHome);
  const sourceHooksDir = path.resolve(
    options.sourceHooksDir || path.join(workbenchHome, '.cursor', 'hooks'),
  );
  const warnings: string[] = [];

  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root is not a directory: ${projectRoot}`);
  }
  if (!fs.existsSync(workbenchHome)) {
    throw new Error(`Workbench home not found: ${workbenchHome}`);
  }

  const awDir = path.join(projectRoot, '.agent-workbench');
  const hooksDir = path.join(awDir, 'cursor-hooks');
  const cursorDir = path.join(projectRoot, '.cursor');
  const hooksConfigPath = path.join(cursorDir, 'hooks.json');
  const observationPath = path.join(awDir, 'observation.json');

  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(cursorDir, { recursive: true });

  for (const fileName of HOOK_FILES) {
    const sourcePath = path.join(sourceHooksDir, fileName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing workbench hook source: ${sourcePath}`);
    }
    const targetPath = path.join(hooksDir, fileName);
    const source = fs.readFileSync(sourcePath, 'utf8');
    fs.writeFileSync(
      targetPath,
      buildManagedHookWrapper(workbenchHome, source),
      'utf8',
    );
  }

  let existing: HooksConfig | null = null;
  if (fs.existsSync(hooksConfigPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf8')) as HooksConfig;
    } catch {
      const backup = `${hooksConfigPath}.bak-${Date.now()}`;
      fs.copyFileSync(hooksConfigPath, backup);
      warnings.push(`Existing hooks.json was invalid JSON; backed up to ${backup}`);
      existing = null;
    }
  }

  const merged = mergeCursorHooksConfig(existing);
  fs.writeFileSync(
    hooksConfigPath,
    `${JSON.stringify(merged, null, 2)}\n`,
    'utf8',
  );

  const observation = {
    version: 1,
    provider: 'cursor',
    workbenchHome,
    installedAt: new Date().toISOString(),
    hooksDir: path.relative(projectRoot, hooksDir).replaceAll('\\', '/'),
    notes:
      'Managed by Agent Workbench. Re-opening the project in the desktop app refreshes these hooks.',
  };
  fs.writeFileSync(
    observationPath,
    `${JSON.stringify(observation, null, 2)}\n`,
    'utf8',
  );

  // Ensure the records directory exists so the desktop watcher has a target.
  fs.mkdirSync(awDir, { recursive: true });
  for (const name of [
    'agent-steps.jsonl',
    'trace-records.jsonl',
    'code-changes.jsonl',
  ]) {
    const filePath = path.join(awDir, name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  }

  return {
    projectRoot,
    workbenchHome,
    hooksDir,
    hooksConfigPath,
    observationPath,
    managedCommands: [
      `node ${MANAGED_MARKER}inject-shell-trace.mjs`,
      `node ${MANAGED_MARKER}record-agent-tool.mjs`,
      `node ${MANAGED_MARKER}record-code-state.mjs start`,
      `node ${MANAGED_MARKER}record-code-state.mjs end`,
    ],
    warnings,
  };
}

function buildManagedHookWrapper(
  workbenchHome: string,
  source: string,
): string {
  const homeLiteral = JSON.stringify(workbenchHome);
  const body = source
    .replace(/^\uFEFF/, '')
    .replace(/^#![^\r\n]*(?:\r?\n|$)/, '');

  return `#!/usr/bin/env node
/**
 * Managed by Agent Workbench. Do not edit by hand.
 * Re-open the project in the desktop app to refresh.
 */
process.env.AGENT_WORKBENCH_HOME = ${homeLiteral};
${body}
`;
}
