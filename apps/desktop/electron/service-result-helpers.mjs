import path from 'node:path';

export function createServiceResultHelpers(source) {
  return {
    ready(data) {
      return { status: 'ready', source, data, error: null };
    },
    failed(data, error) {
      return { status: 'error', source, data, error };
    },
  };
}

export function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function errorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const normalize = value => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}
