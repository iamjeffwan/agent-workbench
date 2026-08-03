import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ENV_PROCESS_ORIGIN_ID,
  ENV_TRACE_MANIFEST_PATH,
  ENV_TRACE_OUT_PATH,
} from '../env.js';

export type LaunchEnvOptions = {
  processOriginId: string;
  manifestPath: string;
  /** Absolute path to guest preload.js */
  preloadPath: string;
  outPath?: string;
  /** Existing env to extend; defaults to process.env */
  baseEnv?: NodeJS.ProcessEnv;
};

/**
 * Build env vars for launching an observed Node process.
 * Sets process origin id and ensures --import preload is present in NODE_OPTIONS.
 */
export function buildLaunchEnv(options: LaunchEnvOptions): NodeJS.ProcessEnv {
  const env = { ...(options.baseEnv ?? process.env) };
  const manifestPath = path.resolve(options.manifestPath);
  const preloadPath = path.resolve(options.preloadPath);
  const preloadImport = pathToFileURL(preloadPath).href;

  env[ENV_PROCESS_ORIGIN_ID] = options.processOriginId;
  env[ENV_TRACE_MANIFEST_PATH] = manifestPath;
  if (options.outPath) {
    env[ENV_TRACE_OUT_PATH] = path.resolve(options.outPath);
  }

  const marker = preloadImport;
  const current = env.NODE_OPTIONS ?? '';
  if (!current.includes(marker) && !current.includes(preloadPath)) {
    const flag = `--import ${preloadImport}`;
    env.NODE_OPTIONS = current.trim() ? `${current.trim()} ${flag}` : flag;
  }

  return env;
}
