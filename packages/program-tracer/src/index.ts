/**
 * Package root exports shared contracts only.
 * Prefer importing `./host` or `./preload` for side-specific entry points.
 */

export {
  TRACE_MANIFEST_VERSION,
  isTraceManifest,
  type TraceManifest,
  type TraceMethod,
} from './manifest.js';

export {
  ENV_PROCESS_ORIGIN_ID,
  ENV_TRACE_MANIFEST_PATH,
  ENV_TRACE_OUT_PATH,
} from './env.js';
