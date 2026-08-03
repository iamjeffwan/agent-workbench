/**
 * Host entry: used by the workbench (or a local CLI) before/at process launch.
 */

export {
  TRACE_MANIFEST_VERSION,
  isTraceManifest,
  type TraceManifest,
  type TraceMethod,
} from '../manifest.js';

export {
  ENV_PROCESS_ORIGIN_ID,
  ENV_TRACE_MANIFEST_PATH,
  ENV_TRACE_OUT_PATH,
} from '../env.js';

export {
  analyzeBoundaries,
  type AnalyzeBoundariesOptions,
} from './analyze-boundaries.js';

export { readTraceManifest, writeTraceManifest } from './manifest-io.js';

export { buildLaunchEnv, type LaunchEnvOptions } from './launch-env.js';
