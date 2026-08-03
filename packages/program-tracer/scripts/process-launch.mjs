import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { redactCredentialText } from '../../agent-workbench-security/index.mjs';

export function spawnDirect(command, args, options) {
  const resolved = resolveExecutable(command, options.env);
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(resolved)) {
    throw new Error(
      `Windows command script requires explicit shell mode: ${resolved}`,
    );
  }

  return spawn(resolved, args, {
    ...options,
    shell: false,
  });
}

export function spawnShellCommand(command, options) {
  if (process.platform === 'win32') {
    const shell = options.env?.ComSpec || process.env.ComSpec || 'cmd.exe';
    return spawn(shell, ['/d', '/s', '/c', `"${command}"`], {
      ...options,
      shell: false,
      windowsVerbatimArguments: true,
    });
  }

  return spawn('/bin/sh', ['-c', command], {
    ...options,
    shell: false,
  });
}

export function mirrorChildExit(child, label) {
  let failedToStart = false;

  child.once('error', (error) => {
    failedToStart = true;
    console.error(
      `[${label}] failed to start: ${redactCredentialText(error.message)}`,
    );
    process.exitCode = 1;
  });

  child.once('exit', (code, signal) => {
    if (failedToStart) {
      return;
    }
    if (signal) {
      try {
        process.kill(process.pid, signal);
      } catch {
        process.exitCode = 1;
      }
      return;
    }
    process.exitCode = code ?? 1;
  });
}

function resolveExecutable(command, env) {
  if (process.platform !== 'win32' || path.extname(command)) {
    return command;
  }
  if (command.includes('/') || command.includes('\\')) {
    return command;
  }

  const searchPath = env?.PATH || env?.Path || process.env.PATH || '';
  const pathExt = env?.PATHEXT || process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  const extensions = pathExt.split(';').filter(Boolean);

  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return command;
}
