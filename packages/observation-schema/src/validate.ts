import type {
  ObservationEvent,
  ObservationSession,
  ObservationTurn,
  ValidationIssue,
  ValidationResult,
} from './types.js';

const eventTypes = new Set([
  'message',
  'reasoning_summary',
  'tool_call',
  'tool_result',
  'file_change',
  'error',
  'lifecycle',
]);
const provenances = new Set(['direct', 'derived', 'supplemented']);
const fidelities = new Set(['full', 'partial']);

export function validateObservationSession(value: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  if (!isRecord(value)) return invalid(errors, '$', 'must be an object');
  requiredString(value, 'schemaVersion', '$', errors);
  if (value.schemaVersion !== '1.0-draft') issue(errors, '$.schemaVersion', 'must equal 1.0-draft');

  if (!isRecord(value.session)) issue(errors, '$.session', 'must be an object');
  else validateSession(value.session, errors);

  if (!Array.isArray(value.turns)) issue(errors, '$.turns', 'must be an array');
  else value.turns.forEach((turn, index) => validateTurn(turn, index, errors));

  if (!isRecord(value.capabilityManifest)) issue(errors, '$.capabilityManifest', 'must be an object');
  else {
    requiredString(value.capabilityManifest, 'agent', '$.capabilityManifest', errors);
    if (!isRecord(value.capabilityManifest.capabilities)) {
      issue(errors, '$.capabilityManifest.capabilities', 'must be an object');
    }
  }

  if (!isRecord(value.diagnostics)) issue(errors, '$.diagnostics', 'must be an object');
  else {
    for (const key of ['unknownSourceEventCount', 'parseErrorCount', 'lossyEventCount', 'unsupportedFieldCount']) {
      requiredNonNegativeInteger(value.diagnostics, key, '$.diagnostics', errors);
    }
    if (!Array.isArray(value.diagnostics.entries)) issue(errors, '$.diagnostics.entries', 'must be an array');
  }

  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
}

export function assertObservationSession(value: unknown): asserts value is ObservationSession {
  const result = validateObservationSession(value);
  if (!result.valid) {
    throw new TypeError(`Invalid ObservationSession: ${result.errors.map(error => `${error.path} ${error.message}`).join('; ')}`);
  }
}

function validateSession(value: Record<string, unknown>, errors: ValidationIssue[]): void {
  for (const key of ['sessionId', 'sourceAgent', 'sourceVersion', 'adapterVersion']) {
    requiredString(value, key, '$.session', errors);
  }
  validateRawRef(value.rawRef, '$.session.rawRef', errors);
}

function validateTurn(value: unknown, index: number, errors: ValidationIssue[]): void {
  const base = `$.turns[${index}]`;
  if (!isRecord(value)) return issue(errors, base, 'must be an object');
  requiredString(value, 'turnId', base, errors);
  requiredNonNegativeInteger(value, 'sequence', base, errors);
  validateRawRef(value.sourceRef, `${base}.sourceRef`, errors);
  if (!Array.isArray(value.events)) return issue(errors, `${base}.events`, 'must be an array');
  value.events.forEach((event, eventIndex) => validateEvent(event, value as unknown as ObservationTurn, index, eventIndex, errors));
}

function validateEvent(
  value: unknown,
  turn: ObservationTurn,
  turnIndex: number,
  eventIndex: number,
  errors: ValidationIssue[],
): void {
  const base = `$.turns[${turnIndex}].events[${eventIndex}]`;
  if (!isRecord(value)) return issue(errors, base, 'must be an object');
  for (const key of ['eventId', 'turnId', 'type', 'sourceAgent', 'sourceVersion', 'sourceEventType', 'adapterVersion']) {
    requiredString(value, key, base, errors);
  }
  requiredNonNegativeInteger(value, 'sequence', base, errors);
  if (value.turnId !== turn.turnId) issue(errors, `${base}.turnId`, 'must match its containing turn');
  if (!eventTypes.has(value.type as ObservationEvent['type'])) issue(errors, `${base}.type`, 'is not a supported event type');
  if (!provenances.has(value.provenance as string)) issue(errors, `${base}.provenance`, 'is not a supported provenance');
  if (!fidelities.has(value.fidelity as string)) issue(errors, `${base}.fidelity`, 'is not a supported fidelity');
  validateRawRef(value.rawRef, `${base}.rawRef`, errors);
}

function validateRawRef(value: unknown, path: string, errors: ValidationIssue[]): void {
  if (!isRecord(value)) return issue(errors, path, 'must be an object');
  requiredString(value, 'sourceFile', path, errors);
  requiredString(value, 'sourceType', path, errors);
  requiredNonNegativeInteger(value, 'line', path, errors, 1);
}

function requiredString(value: Record<string, unknown>, key: string, base: string, errors: ValidationIssue[]): void {
  if (typeof value[key] !== 'string' || value[key] === '') issue(errors, `${base}.${key}`, 'must be a non-empty string');
}

function requiredNonNegativeInteger(
  value: Record<string, unknown>,
  key: string,
  base: string,
  errors: ValidationIssue[],
  minimum = 0,
): void {
  const candidate = value[key];
  if (!Number.isInteger(candidate) || (candidate as number) < minimum) issue(errors, `${base}.${key}`, `must be an integer >= ${minimum}`);
}

function issue(errors: ValidationIssue[], path: string, message: string): void {
  errors.push({ path, message });
}

function invalid(errors: ValidationIssue[], path: string, message: string): ValidationResult {
  issue(errors, path, message);
  return { valid: false, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
