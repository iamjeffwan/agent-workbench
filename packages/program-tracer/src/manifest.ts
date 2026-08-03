/**
 * Trace manifest: the hard contract between host (analyzer) and guest (preload).
 * Host writes it before process start; guest only reads it.
 */

export const TRACE_MANIFEST_VERSION = 1 as const;

/** One concrete boundary method that the guest should instrument. */
export type TraceMethod = {
  /** Stable integer id used on the hot path instead of strings. */
  id: number;
  /** Project-relative path to the source file that defines the method. */
  sourceFile: string;
  /** Project-relative path to the compiled file the guest will load, when known. */
  compiledFile?: string;
  className: string;
  methodName: string;
};

export type TraceManifest = {
  version: typeof TRACE_MANIFEST_VERSION;
  /** Absolute project root used to resolve relative paths in this manifest. */
  projectRoot: string;
  methods: TraceMethod[];
};

export function isTraceManifest(value: unknown): value is TraceManifest {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<TraceManifest>;
  if (
    candidate.version !== TRACE_MANIFEST_VERSION ||
    typeof candidate.projectRoot !== 'string' ||
    !Array.isArray(candidate.methods)
  ) {
    return false;
  }

  return candidate.methods.every(isTraceMethod);
}

function isTraceMethod(value: unknown): value is TraceMethod {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const method = value as Partial<TraceMethod>;
  return (
    typeof method.id === 'number' &&
    Number.isInteger(method.id) &&
    method.id > 0 &&
    typeof method.sourceFile === 'string' &&
    method.sourceFile.length > 0 &&
    typeof method.className === 'string' &&
    method.className.length > 0 &&
    typeof method.methodName === 'string' &&
    method.methodName.length > 0 &&
    (method.compiledFile === undefined || typeof method.compiledFile === 'string')
  );
}
