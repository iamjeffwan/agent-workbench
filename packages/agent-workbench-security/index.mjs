export const REDACTED_VALUE = '[REDACTED]';

const PRIVATE_KEY_BLOCK =
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g;
const AUTHORIZATION_VALUE =
  /(\b(?:proxy[-_ ]?)?authorization\s*[:=]\s*)(?:["']?)(?:basic|bearer)\s+[^\s"'`,;]+(?:["']?)/gi;
const CREDENTIAL_KEY_SOURCE =
  '(?:[a-z0-9]+[_-])*(?:password|passwd|pwd|secret|token|authorization|cookie|api[_-]?key|access[_-]?key(?:[_-]?id)?|private[_-]?key|client[_-]?secret|session[_-]?id)(?:[_-](?:header|hash|backup|value|credential|credentials|raw))*';
const QUOTED_CREDENTIAL_ASSIGNMENT = new RegExp(
  `(\\b${CREDENTIAL_KEY_SOURCE}\\b[:=])(["'])([^\\r\\n]*?)\\2`,
  'gi',
);
const CREDENTIAL_ASSIGNMENT = new RegExp(
  `(\\b${CREDENTIAL_KEY_SOURCE}\\b[:=])([^\\s,;|&"']+)`,
  'gi',
);
const FLEXIBLE_QUOTED_CREDENTIAL_ASSIGNMENT = new RegExp(
  `((?:["']?)\\b${CREDENTIAL_KEY_SOURCE}\\b(?:["']?)\\s*[:=]\\s*)(["'])([^\\r\\n]*?)\\2`,
  'gi',
);
const FLEXIBLE_CREDENTIAL_ASSIGNMENT = new RegExp(
  `((?:["']?)\\b${CREDENTIAL_KEY_SOURCE}\\b(?:["']?)\\s*[:=]\\s*)([^\\s,;|&"']+)`,
  'gi',
);
const QUOTED_CREDENTIAL_ARGUMENT = new RegExp(
  `((?:^|\\s)--${CREDENTIAL_KEY_SOURCE}\\b\\s+)(["'])([^\\r\\n]*?)\\2`,
  'gi',
);
const CREDENTIAL_ARGUMENT = new RegExp(
  `((?:^|\\s)--${CREDENTIAL_KEY_SOURCE}\\b\\s+)[^\\s"']+`,
  'gi',
);
const URL_PASSWORD =
  /(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi;
const HIGH_CONFIDENCE_TOKEN =
  /\b(?:sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,})\b/gi;

const EXACT_CREDENTIAL_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'authorization',
  'proxy_authorization',
  'cookie',
  'set_cookie',
  'api_key',
  'access_key',
  'access_key_id',
  'private_key',
  'client_secret',
  'session_id',
]);

const CREDENTIAL_KEY_SUFFIXES = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'api_key',
  'access_key',
  'access_key_id',
  'private_key',
  'client_secret',
  'session_id',
];
const CREDENTIAL_KEY_WITH_QUALIFIER =
  /(?:^|_)(?:password|passwd|pwd|secret|token|authorization|cookie|api_key|access_key|private_key|client_secret|session_id)(?:_(?:header|hash|backup|value|credential|credentials|raw))+$/;

export function isCredentialKey(key) {
  const normalized = normalizeKey(key);
  if (EXACT_CREDENTIAL_KEYS.has(normalized)) {
    return true;
  }
  return (
    CREDENTIAL_KEY_SUFFIXES.some((suffix) => normalized.endsWith(`_${suffix}`)) ||
    CREDENTIAL_KEY_WITH_QUALIFIER.test(normalized)
  );
}

export function redactCredentialText(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return text;
  }

  return text
    .replace(PRIVATE_KEY_BLOCK, REDACTED_VALUE)
    .replace(AUTHORIZATION_VALUE, (_match, prefix) => `${prefix}${REDACTED_VALUE}`)
    .replace(QUOTED_CREDENTIAL_ASSIGNMENT, redactQuotedAssignment)
    .replace(CREDENTIAL_ASSIGNMENT, redactUnquotedAssignment)
    .replace(FLEXIBLE_QUOTED_CREDENTIAL_ASSIGNMENT, redactQuotedAssignment)
    .replace(FLEXIBLE_CREDENTIAL_ASSIGNMENT, redactUnquotedAssignment)
    .replace(
      QUOTED_CREDENTIAL_ARGUMENT,
      (_match, prefix, quote) => `${prefix}${quote}${REDACTED_VALUE}${quote}`,
    )
    .replace(CREDENTIAL_ARGUMENT, (_match, prefix) => `${prefix}${REDACTED_VALUE}`)
    .replace(URL_PASSWORD, (_match, prefix, _password, suffix) =>
      `${prefix}${REDACTED_VALUE}${suffix}`,
    )
    .replace(HIGH_CONFIDENCE_TOKEN, REDACTED_VALUE);
}

export function redactCredentials(value) {
  return redactValue(value, new WeakSet());
}

function redactValue(value, seen) {
  if (typeof value === 'string') {
    return redactCredentialText(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return { $summary: 'circular' };
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = isCredentialKey(key)
      ? REDACTED_VALUE
      : redactValue(nested, seen);
  }
  return output;
}

function normalizeKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function redactQuotedAssignment(match, prefix, quote, value, offset, input) {
  return looksLikeSourceAssignment(match, prefix, value, offset, input)
    ? match
    : `${prefix}${quote}${REDACTED_VALUE}${quote}`;
}

function redactUnquotedAssignment(match, prefix, value, offset, input) {
  return looksLikeSourceAssignment(match, prefix, value, offset, input)
    ? match
    : `${prefix}${REDACTED_VALUE}`;
}

function looksLikeSourceAssignment(match, prefix, value, offset, input) {
  const lineStart = input.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const before = input.slice(lineStart, offset);
  const after = input.slice(offset + match.length);
  const afterLine = after.split(/\r?\n/, 1)[0];
  const sourceValue = String(value).trim();
  const separator = prefix.match(/([:=])\s*$/)?.[1] ?? '';
  const key = prefix
    .slice(0, Math.max(prefix.lastIndexOf('='), prefix.lastIndexOf(':')))
    .replace(/["'\s]/g, '');

  if (/\b(?:const|let|var)\b[^\r\n]*$/i.test(before)) {
    return true;
  }
  if (/\b(?:readonly|public|private|protected|static)\s+$/i.test(before)) {
    return true;
  }
  if (/\.\s*$/.test(before)) {
    return true;
  }
  if (
    separator === '=' &&
    key === key.toLowerCase() &&
    !/\$\s*$/.test(before) &&
    !looksLikeCredentialLiteral(sourceValue) &&
    /^\s*;\s*(?:\/\/.*)?$/.test(afterLine)
  ) {
    return true;
  }
  if (
    separator === '=' &&
    /\([^)]*$/.test(before) &&
    /^\s*[,)]/.test(after)
  ) {
    return true;
  }
  if (/^(?:await|yield|new|typeof|void)\b/i.test(sourceValue)) {
    return true;
  }
  if (/^(?:[a-z_$][\w$]*\.)+[a-z_$][\w$]*(?:\s*\([^)]*\))?$/i.test(sourceValue)) {
    return true;
  }
  return /^[a-z_$][\w$]*\s*\([^)]*\)$/i.test(sourceValue);
}

function looksLikeCredentialLiteral(value) {
  return /(?:^|[^a-z0-9])(?:secret|token|password|passwd|pwd|session|bearer|private[-_ ]?key)(?:$|[^a-z0-9])/i.test(
    value,
  );
}
