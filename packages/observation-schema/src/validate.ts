import fs from 'node:fs';

import type {
  ObservationSession,
  ValidationIssue,
  ValidationResult,
} from './types.js';

type JsonSchema = Record<string, unknown>;

const observationSchema = JSON.parse(
  fs.readFileSync(new URL('../schema/observation-session.schema.json', import.meta.url), 'utf8'),
) as JsonSchema;

export function validateObservationSession(value: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  validateValue(value, observationSchema, '$', errors, observationSchema);
  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
}

export function assertObservationSession(value: unknown): asserts value is ObservationSession {
  const result = validateObservationSession(value);
  if (!result.valid) {
    throw new TypeError(
      `Invalid ObservationSession: ${result.errors.map(error => `${error.path} ${error.message}`).join('; ')}`,
    );
  }
}

function validateValue(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: ValidationIssue[],
  root: JsonSchema,
): void {
  const resolved = resolveSchema(schema, root);

  if ('const' in resolved && !Object.is(value, resolved.const)) {
    issue(errors, path, `must equal ${String(resolved.const)}`);
  }
  if (Array.isArray(resolved.enum) && !resolved.enum.some(candidate => Object.is(candidate, value))) {
    issue(errors, path, 'is not an allowed value');
  }

  const expectedType = typeof resolved.type === 'string' ? resolved.type : undefined;
  if (expectedType && !matchesType(value, expectedType)) {
    issue(errors, path, `must be ${expectedType}`);
    return;
  }

  if (typeof value === 'string' && typeof resolved.minLength === 'number' && value.length < resolved.minLength) {
    issue(errors, path, `must have length >= ${resolved.minLength}`);
  }
  if (typeof value === 'number' && typeof resolved.minimum === 'number' && value < resolved.minimum) {
    issue(errors, path, `must be >= ${resolved.minimum}`);
  }

  if (Array.isArray(value)) {
    if (isSchema(resolved.items)) {
      value.forEach((item, index) => validateValue(item, resolved.items as JsonSchema, `${path}[${index}]`, errors, root));
    }
    return;
  }

  if (!isRecord(value)) return;
  const properties = isRecord(resolved.properties) ? resolved.properties : {};
  const required = Array.isArray(resolved.required)
    ? resolved.required.filter((key): key is string => typeof key === 'string')
    : [];

  for (const key of required) {
    if (!(key in value)) issue(errors, `${path}.${key}`, 'is required');
  }

  for (const [key, child] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (isSchema(propertySchema)) {
      validateValue(child, propertySchema, `${path}.${key}`, errors, root);
      continue;
    }
    if (resolved.additionalProperties === false) {
      issue(errors, `${path}.${key}`, 'is not allowed');
    } else if (isSchema(resolved.additionalProperties)) {
      validateValue(child, resolved.additionalProperties, `${path}.${key}`, errors, root);
    }
  }
}

function resolveSchema(schema: JsonSchema, root: JsonSchema): JsonSchema {
  if (typeof schema.$ref !== 'string') return schema;
  if (!schema.$ref.startsWith('#/')) throw new TypeError(`Unsupported JSON Schema reference: ${schema.$ref}`);
  let current: unknown = root;
  for (const segment of schema.$ref.slice(2).split('/')) {
    if (!isRecord(current) || !(segment in current)) {
      throw new TypeError(`Unresolved JSON Schema reference: ${schema.$ref}`);
    }
    current = current[segment];
  }
  if (!isSchema(current)) throw new TypeError(`Invalid JSON Schema reference: ${schema.$ref}`);
  return current;
}

function matchesType(value: unknown, expected: string): boolean {
  if (expected === 'object') return isRecord(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'string') return typeof value === 'string';
  if (expected === 'boolean') return typeof value === 'boolean';
  if (expected === 'null') return value === null;
  return true;
}

function issue(errors: ValidationIssue[], path: string, message: string): void {
  errors.push({ path, message });
}

function isSchema(value: unknown): value is JsonSchema {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
