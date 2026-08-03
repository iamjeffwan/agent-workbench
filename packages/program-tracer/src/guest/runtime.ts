/**
 * Guest runtime installed on globalThis before instrumented modules load.
 */

import { TraceRecorder, type RecorderOptions } from './recorder.js';

export type TraceRuntime = {
  wrap: (
    methodId: number,
    args: unknown[],
    fn: () => unknown,
  ) => unknown;
};

type GlobalWithTrace = typeof globalThis & {
  __awTrace?: TraceRuntime;
};

export function createRecorderRuntime(options: RecorderOptions): TraceRuntime {
  const recorder = new TraceRecorder(options);
  return {
    wrap(methodId, args, fn) {
      if (typeof methodId !== 'number' || !Array.isArray(args) || typeof fn !== 'function') {
        return fn();
      }
      return recorder.wrap(methodId, args, fn);
    },
  };
}

export function installRuntime(runtime: TraceRuntime): void {
  (globalThis as GlobalWithTrace).__awTrace = runtime;
}
