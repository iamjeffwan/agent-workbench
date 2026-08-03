/**
 * Guest preload entry.
 * Launch with: node --import @agent-workbench/program-tracer/preload app.js
 * (or the same flag via NODE_OPTIONS)
 *
 * Hooks are registered before application code loads.
 * Avoid static imports of the observed app from this graph.
 */

import { redactCredentialText } from '../../../agent-workbench-security/index.mjs';
import { installGuest } from './install.js';

try {
  installGuest();
} catch (error) {
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(
    `[program-tracer] guest unavailable: ${redactCredentialText(detail)}`,
  );
}
