const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

const METHOD_LABELS: Record<string, string> = {
  SHELL: 'Shell',
  EDIT: 'Edit',
  DIFF: 'Diff',
  SEARCH: 'Search',
  TEST: 'Test',
  BUILD: 'Build',
  LINT: 'Lint',
  TOOL: 'Tool',
  DELEGATE: 'Delegate',
  INSPECT: 'Inspect',
};

const STATUS_LABELS: Record<string, string> = {
  OK: 'Ok',
  ERROR: 'Error',
  CHANGED: 'Changed',
  RUNNING: 'Running',
  OBSERVED: 'Observed',
  UNKNOWN: 'Unknown',
};

export function formatMethodLabel(method: string): string {
  const upper = method.toUpperCase();
  if (HTTP_METHODS.has(upper)) return upper;

  const mapped = METHOD_LABELS[upper];
  if (mapped) return mapped;

  if (/^[a-z]/.test(method)) return method;

  if (/^[A-Z0-9_]+$/.test(method)) {
    return method.charAt(0) + method.slice(1).toLowerCase();
  }

  return method;
}

export function formatStatusLabel(status: string): string {
  if (/^\d{3}$/.test(status)) return status;
  return STATUS_LABELS[status.toUpperCase()] ?? status;
}

export function formatDisplayPath(path: string, maxLength = 52): string {
  if (path.length <= maxLength) return path;

  const parts = path.split('/');
  const fileName = parts.pop() ?? path;
  const reserve = fileName.length + 4;

  if (reserve >= maxLength) {
    return `…${fileName.slice(-(maxLength - 1))}`;
  }

  let prefixParts = [...parts];
  while (prefixParts.length > 0) {
    const prefix = prefixParts.join('/');
    const candidate = `${prefix}/…/${fileName}`;
    if (candidate.length <= maxLength) return candidate;
    prefixParts.shift();
  }

  return `…/${fileName}`;
}
