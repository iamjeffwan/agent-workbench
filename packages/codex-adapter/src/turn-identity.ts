import { createHash } from 'node:crypto';

/** Read Codex's native turn identity when the source record provides one. */
export function nativeTurnIdFromPayload(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const explicit = stringValue(value.turn_id);
  if (explicit) return explicit;
  const metadata = value.internal_chat_message_metadata_passthrough;
  if (!isRecord(metadata)) return undefined;
  return stringValue(metadata.turn_id);
}

/**
 * Produce a repeatable fallback only for source formats without a native turn
 * identifier. The session and raw line together are stable when a rollout is
 * read again.
 */
export function derivedTurnId(sessionId: string, line: number): string {
  const digest = createHash('sha256')
    .update(`${sessionId}:${line}`)
    .digest('hex')
    .slice(0, 16);
  return `derived-${digest}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
