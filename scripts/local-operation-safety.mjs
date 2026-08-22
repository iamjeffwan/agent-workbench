import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

export function createRunOwnership({ startedAt = Date.now() } = {}) {
  const records = new Map();
  return {
    startedAt,
    registerCreatedPath(target, { createdAt = Date.now() } = {}) {
      const resolved = normalizePath(target);
      if (createdAt < startedAt) {
        return { status: 'rejected', reason: 'created-before-run' };
      }
      records.set(resolved, { createdAt });
      return { status: 'registered', path: resolved };
    },
    isOwned(target) {
      return records.has(normalizePath(target));
    },
    records() {
      return [...records.entries()].map(([target, value]) => ({ target, ...value }));
    },
  };
}

export async function trashOwnedPath({ target, ownership, trashItem, exists = fs.existsSync }) {
  if (!ownership?.isOwned(target)) {
    return { status: 'skipped', reason: 'path-not-owned-by-run', path: normalizePath(target) };
  }
  if (typeof trashItem !== 'function') {
    return { status: 'error', reason: 'recycle-bin-unavailable', path: normalizePath(target) };
  }
  try {
    await trashItem(path.resolve(target));
  } catch (error) {
    return {
      status: 'error',
      reason: 'trash-failed',
      path: normalizePath(target),
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (exists(target)) {
    return { status: 'error', reason: 'path-still-exists', path: normalizePath(target) };
  }
  return { status: 'trashed', path: normalizePath(target) };
}

export function inspectProcessIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { status: 'unavailable', reason: 'invalid-pid' };
  }
  try {
    if (process.platform === 'win32') {
      const script = [
        `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"`,
        'if ($null -eq $p) { exit 3 }',
        '[pscustomobject]@{ pid = $p.ProcessId; parentPid = $p.ParentProcessId; name = $p.Name; commandLine = $p.CommandLine } | ConvertTo-Json -Compress',
      ].join('; ');
      const output = execFileSync('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
      ], { encoding: 'utf8', windowsHide: true }).trim();
      const parsed = JSON.parse(output);
      return {
        status: 'ready',
        pid: Number(parsed.pid),
        parentPid: Number(parsed.parentPid),
        name: String(parsed.name ?? ''),
        commandLine: String(parsed.commandLine ?? ''),
      };
    }
    const output = execFileSync('ps', ['-o', 'pid=,ppid=,comm=,args=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
    if (!output) return { status: 'unavailable', reason: 'process-not-found' };
    const match = output.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) return { status: 'unavailable', reason: 'unexpected-process-output' };
    return {
      status: 'ready',
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      name: match[3],
      commandLine: match[4],
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function matchesProcessIdentity(actual, expected = {}) {
  if (!actual || actual.status !== 'ready') return false;
  if (expected.parentPid !== undefined && actual.parentPid !== expected.parentPid) return false;
  const fragments = expected.commandLineIncludes ?? [];
  const commandLine = actual.commandLine.toLowerCase();
  return fragments.every(fragment => commandLine.includes(String(fragment).toLowerCase()));
}

export function stopProcessTree(
  child,
  {
    expected,
    inspect = inspectProcessIdentity,
    terminate = terminateProcessTree,
    allowDirectSignal = false,
  } = {},
) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    return { status: 'skipped', reason: 'process-already-exited' };
  }
  const identity = inspect(child.pid);
  if (identity.status !== 'ready') {
    if (allowDirectSignal && typeof child.kill === 'function') {
      child.kill('SIGTERM');
      return { status: 'signaled', reason: 'identity-unavailable-direct-child' };
    }
    return { status: 'skipped', reason: 'identity-unavailable' };
  }
  if (!matchesProcessIdentity(identity, expected)) {
    return { status: 'skipped', reason: 'identity-mismatch', identity };
  }
  terminate(child);
  return { status: 'terminated', identity };
}

export function terminateProcessTree(child) {
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (result.status !== 0) throw new Error(`taskkill failed with code ${result.status ?? 'unknown'}.`);
    return;
  }
  child.kill('SIGTERM');
}

function normalizePath(target) {
  const resolved = path.resolve(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
