import fs from 'node:fs';

import type {
  ReviewCaseRecord,
  ValidationIssue,
  ValidationResult,
} from './types.js';

type JsonSchema = Record<string, unknown>;

const reviewSchema = JSON.parse(
  fs.readFileSync(new URL('../schema/review-case-record.schema.json', import.meta.url), 'utf8'),
) as JsonSchema;

export function validateReviewCaseRecord(value: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  validateValue(value, reviewSchema, '$', errors, reviewSchema);
  if (errors.length === 0) validateRelationships(value as ReviewCaseRecord, errors);
  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
}

export function assertReviewCaseRecord(value: unknown): asserts value is ReviewCaseRecord {
  const result = validateReviewCaseRecord(value);
  if (!result.valid) {
    throw new TypeError(
      `Invalid ReviewCaseRecord: ${result.errors.map(error => `${error.path} ${error.message}`).join('; ')}`,
    );
  }
}

function validateRelationships(record: ReviewCaseRecord, errors: ValidationIssue[]): void {
  const runIds = uniqueIds(record.runs.map(run => run.runId), '$.runs', errors);
  const judgementIds = uniqueIds(record.judgements.map(item => item.judgementId), '$.judgements', errors);
  uniqueIds(record.evidence.map(item => item.evidenceId), '$.evidence', errors);
  uniqueIds(record.annotations.map(item => item.annotationId), '$.annotations', errors);

  record.runs.forEach((run, index) => {
    if (run.caseId !== record.reviewCase.caseId) {
      issue(errors, `$.runs[${index}].caseId`, 'must reference the containing review case');
    }
    const terminal = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
    if (terminal && !run.completedAt) {
      issue(errors, `$.runs[${index}].completedAt`, 'is required for a terminal run');
    }
    if (run.status === 'failed' && !run.failureReason) {
      issue(errors, `$.runs[${index}].failureReason`, 'is required for a failed run');
    }
  });

  record.judgements.forEach((judgement, index) => {
    if (!runIds.has(judgement.runId)) {
      issue(errors, `$.judgements[${index}].runId`, 'must reference an existing run');
      return;
    }
    const run = record.runs.find(candidate => candidate.runId === judgement.runId);
    if (run?.status !== 'completed') {
      issue(errors, `$.judgements[${index}].runId`, 'must reference a completed run');
    }
    if (!record.evidence.some(item => item.judgementId === judgement.judgementId)) {
      issue(errors, `$.judgements[${index}]`, 'must have at least one evidence item');
    }
  });

  record.evidence.forEach((evidence, index) => {
    if (!judgementIds.has(evidence.judgementId)) {
      issue(errors, `$.evidence[${index}].judgementId`, 'must reference an existing judgement');
    }
  });

  record.annotations.forEach((annotation, index) => {
    if (!judgementIds.has(annotation.judgementId)) {
      issue(errors, `$.annotations[${index}].judgementId`, 'must reference an existing judgement');
    }
  });
}

function uniqueIds(values: string[], path: string, errors: ValidationIssue[]): Set<string> {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    if (ids.has(value)) issue(errors, `${path}[${index}]`, `duplicates id ${value}`);
    ids.add(value);
  });
  return ids;
}

function validateValue(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: ValidationIssue[],
  root: JsonSchema,
): void {
  const resolved = resolveSchema(schema, root);
  if ('const' in resolved && !Object.is(value, resolved.const)) issue(errors, path, `must equal ${String(resolved.const)}`);
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
  if (typeof value === 'number') {
    if (typeof resolved.minimum === 'number' && value < resolved.minimum) issue(errors, path, `must be >= ${resolved.minimum}`);
    if (typeof resolved.maximum === 'number' && value > resolved.maximum) issue(errors, path, `must be <= ${resolved.maximum}`);
  }

  if (Array.isArray(value)) {
    if (typeof resolved.minItems === 'number' && value.length < resolved.minItems) {
      issue(errors, path, `must contain at least ${resolved.minItems} items`);
    }
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
    } else if (resolved.additionalProperties === false) {
      issue(errors, `${path}.${key}`, 'is not allowed');
    }
  }
}

function resolveSchema(schema: JsonSchema, root: JsonSchema): JsonSchema {
  if (typeof schema.$ref !== 'string') return schema;
  if (!schema.$ref.startsWith('#/')) throw new TypeError(`Unsupported JSON Schema reference: ${schema.$ref}`);
  let current: unknown = root;
  for (const segment of schema.$ref.slice(2).split('/')) {
    if (!isRecord(current) || !(segment in current)) throw new TypeError(`Unresolved JSON Schema reference: ${schema.$ref}`);
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
