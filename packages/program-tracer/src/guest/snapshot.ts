import {
  REDACTED_VALUE,
  isCredentialKey,
  redactCredentialText,
} from '../../../agent-workbench-security/index.mjs';

export type SnapshotLimits = {
  maxDepth: number;
  maxProperties: number;
  maxStringLength: number;
  maxBytes: number;
  maxTimeMs: number;
};

export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = {
  maxDepth: 3,
  maxProperties: 40,
  maxStringLength: 400,
  maxBytes: 8_192,
  maxTimeMs: 5,
};

export type SnapshotResult = {
  value: unknown;
  degraded: boolean;
};

export function snapshotValue(
  input: unknown,
  limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS,
  options?: { summaryOnly?: boolean },
): SnapshotResult {
  try {
    return snapshotValueUnsafe(input, limits, options);
  } catch {
    // Snapshot must never break the observed method.
    return {
      value: { $summary: 'snapshot-failed' },
      degraded: true,
    };
  }
}

function snapshotValueUnsafe(
  input: unknown,
  limits: SnapshotLimits,
  options?: { summaryOnly?: boolean },
): SnapshotResult {
  const started = Date.now();
  let degraded = false;
  let bytes = 0;
  const seen = new WeakSet<object>();

  const budget = () => {
    if (Date.now() - started > limits.maxTimeMs) {
      degraded = true;
      return false;
    }
    if (bytes >= limits.maxBytes) {
      degraded = true;
      return false;
    }
    return true;
  };

  const walk = (
    value: unknown,
    depth: number,
    textField?: string,
  ): unknown => {
    if (!budget()) {
      return { $summary: 'snapshot-budget-exceeded' };
    }

    if (value === null || value === undefined) {
      bytes += 4;
      return value;
    }

    const valueType = typeof value;
    if (valueType === 'string') {
      const text = redactCredentialText(value as string, {
        context: 'auto',
        field: textField,
      });
      bytes += Math.min(text.length, limits.maxStringLength);
      if (options?.summaryOnly || text.length > limits.maxStringLength) {
        degraded ||= text.length > limits.maxStringLength || !!options?.summaryOnly;
        return {
          $type: 'string',
          $length: text.length,
          $preview: text.slice(0, Math.min(80, limits.maxStringLength)),
        };
      }
      return text;
    }

    if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
      bytes += 8;
      return valueType === 'bigint' ? `${value}n` : value;
    }

    if (valueType === 'function') {
      degraded = true;
      return { $type: 'function', $name: (value as { name?: string }).name || 'anonymous' };
    }

    if (valueType === 'symbol') {
      bytes += 8;
      return { $type: 'symbol', $description: String(value) };
    }

    if (value instanceof Error) {
      bytes += 32;
      return {
        $type: 'Error',
        name: value.name,
        message: redactCredentialText(String(value.message)).slice(
          0,
          limits.maxStringLength,
        ),
      };
    }

    if (Buffer.isBuffer(value)) {
      degraded = true;
      return { $type: 'Buffer', $length: value.length };
    }

    if (ArrayBuffer.isView(value)) {
      degraded = true;
      return {
        $type: value.constructor?.name || 'TypedArray',
        $length: (value as ArrayBufferView).byteLength,
      };
    }

    if (value instanceof Date) {
      bytes += 24;
      return { $type: 'Date', $iso: value.toISOString() };
    }

    if (valueType === 'object') {
      if (seen.has(value as object)) {
        degraded = true;
        return { $summary: 'circular' };
      }
      seen.add(value as object);
    }

    if (depth >= limits.maxDepth || options?.summaryOnly) {
      degraded = true;
      if (Array.isArray(value)) {
        return { $type: 'Array', $length: value.length };
      }
      return {
        $type: 'Object',
        $class: (value as object).constructor?.name || 'Object',
      };
    }

    if (Array.isArray(value)) {
      const items: unknown[] = [];
      const limit = Math.min(value.length, limits.maxProperties);
      if (value.length > limit) {
        degraded = true;
      }
      for (let i = 0; i < limit; i += 1) {
        if (!budget()) {
          break;
        }
        items.push(walk(value[i], depth + 1, textField));
      }
      bytes += 16;
      return value.length > limit
        ? { $type: 'Array', $length: value.length, $items: items }
        : items;
    }

    if (valueType === 'object') {
      const output: Record<string, unknown> = {};
      const keys = Object.keys(value as Record<string, unknown>);
      const limit = Math.min(keys.length, limits.maxProperties);
      if (keys.length > limit) {
        degraded = true;
      }
      for (let i = 0; i < limit; i += 1) {
        if (!budget()) {
          break;
        }
        const key = keys[i];
        if (isCredentialKey(key)) {
          output[key] = REDACTED_VALUE;
          bytes += key.length + 12;
          continue;
        }
        const nested = (value as Record<string, unknown>)[key];
        output[key] = walk(
          nested,
          depth + 1,
          textField ? `${textField}.${key}` : key,
        );
      }
      bytes += 16;
      return output;
    }

    degraded = true;
    return { $type: valueType };
  };

  return {
    value: walk(input, 0),
    degraded,
  };
}
