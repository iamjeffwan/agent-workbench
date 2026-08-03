export declare const REDACTED_VALUE: '[REDACTED]';

export declare function isCredentialKey(key: string): boolean;

export type CredentialTextContext = 'auto' | 'command' | 'source';

export declare function redactCredentialText(
  text: string,
  options?: { context?: CredentialTextContext; field?: string },
): string;

export declare function redactCredentials(value: unknown): unknown;
