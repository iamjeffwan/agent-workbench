#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { stopProcessTree } from './local-operation-safety.mjs';

export function buildInstallCommand({ updateLockfile = false, offline = false } = {}) {
  const args = ['install'];
  if (!updateLockfile) args.push('--frozen-lockfile');
  if (offline) args.push('--offline');
  if (process.platform === 'win32') {
    const runner = resolveWindowsPnpmRunner();
    if (runner) return { executable: process.execPath, args: [runner, ...args] };
    return {
      executable: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm', ...args],
    };
  }
  return { executable: 'pnpm', args };
}

function resolveWindowsPnpmRunner() {
  const candidates = [];
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
  }
  if (process.env.LOCALAPPDATA) {
    const toolsRoot = path.join(process.env.LOCALAPPDATA, 'pnpm', '.tools', 'pnpm');
    try {
      for (const version of fs.readdirSync(toolsRoot).sort().reverse()) {
        candidates.push(path.join(toolsRoot, version, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'));
      }
    } catch {
      // Fall back to the command shell when the package manager location is unavailable.
    }
  }
  return candidates.find(candidate => fs.existsSync(candidate));
}

export function describeInstallFailure({ code, signal, timedOut, stderr = '' }) {
  if (timedOut) return '依赖安装超过超时限制，已停止等待。请检查网络、锁文件和本地缓存后重试。';
  if (/ERR_PNPM_OUTDATED_LOCKFILE|frozen-lockfile/i.test(stderr)) {
    return 'pnpm-lock.yaml 与 package.json 不一致。确认依赖变更后使用 --update-lockfile 重新生成锁文件。';
  }
  if (/OFFLINE|NO_OFFLINE_META|ENOTFOUND|ECONN|network/i.test(stderr)) {
    return '依赖缓存或网络不可用。联网环境请重试；离线环境请先准备完整缓存。';
  }
  return `依赖安装失败（退出码 ${code ?? 'unknown'}，信号 ${signal ?? 'none'}）。请查看上方安装输出。`;
}

export async function installDependencies({
  cwd = process.cwd(),
  updateLockfile = false,
  offline = false,
  timeoutMs = 10 * 60 * 1000,
  spawnProcess = spawn,
  onOutput = chunk => process.stderr.write(chunk),
} = {}) {
  const root = path.resolve(cwd);
  if (!fs.existsSync(path.join(root, 'package.json'))) {
    throw new Error(`未找到 package.json：${root}`);
  }
  if (!fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) {
    throw new Error('未找到 pnpm-lock.yaml；请在仓库根目录执行此入口。');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive.');

  const command = buildInstallCommand({ updateLockfile, offline });
  const child = spawnProcess(command.executable, command.args, {
    cwd: root,
    env: {
      ...process.env,
      CI: '1',
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      npm_config_loglevel: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stdout?.on('data', chunk => onOutput(String(chunk)));
  child.stderr?.on('data', chunk => {
    stderr += String(chunk);
    onOutput(String(chunk));
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      stopProcessTree(child, {
        expected: { parentPid: process.pid, commandLineIncludes: ['pnpm'] },
        allowDirectSignal: true,
      });
      finish({ status: 'error', timedOut: true, message: describeInstallFailure({ timedOut: true }) });
    }, timeoutMs);
    child.once('error', error => finish({
      status: 'error',
      timedOut: false,
      message: error instanceof Error ? error.message : String(error),
    }));
    child.once('exit', (code, signal) => finish({
      status: code === 0 ? 'ready' : 'error',
      code,
      signal,
      timedOut: false,
      ...(code === 0 ? {} : { message: describeInstallFailure({ code, signal, stderr }) }),
    }));
  });
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs(process.argv.slice(2));
  const result = await installDependencies({
    cwd: options.cwd ?? process.cwd(),
    updateLockfile: options.updateLockfile === true,
    offline: options.offline === true,
    timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
  });
  if (result.status !== 'ready') {
    console.error(result.message);
    process.exitCode = 1;
  }
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--update-lockfile') result.updateLockfile = true;
    else if (argument === '--offline') result.offline = true;
    else if (argument === '--cwd') result.cwd = args[++index];
    else if (argument === '--timeout-ms') result.timeoutMs = Number(args[++index]);
    else throw new Error(`未知参数：${argument}`);
  }
  return result;
}
