/**
 * Environment keys injected by the host when launching an observed process.
 * Guest reads these; observed app code should not depend on them.
 */

/** Process origin id: which agent tool started this process. */
export const ENV_PROCESS_ORIGIN_ID = 'AGENT_WORKBENCH_PROCESS_ORIGIN_ID';

/** Absolute path to the trace manifest JSON file. */
export const ENV_TRACE_MANIFEST_PATH = 'AGENT_WORKBENCH_TRACE_MANIFEST';

/** Absolute path to the JSONL file where guest records are appended. */
export const ENV_TRACE_OUT_PATH = 'AGENT_WORKBENCH_TRACE_OUT';
