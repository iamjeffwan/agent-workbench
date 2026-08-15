import fs from 'node:fs';
import path from 'node:path';
import { createModelCallStore } from './model-call-store.mjs';

const PROVIDER = 'deepseek';
const MODEL = 'deepseek-v4-flash';
const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const CREDENTIAL_FILE = 'model-credentials.json';

export function createDeepSeekModelService({
  getUserDataPath,
  isEncryptionAvailable,
  encryptString,
  decryptString,
  env = process.env,
  fetchImpl = globalThis.fetch,
  endpoint = ENDPOINT,
  timeoutMs = 60_000,
}) {
  if (typeof getUserDataPath !== 'function') {
    throw new TypeError('getUserDataPath is required.');
  }
  const calls = createModelCallStore({ getUserDataPath });

  function credentialPath() {
    return path.join(getUserDataPath(), CREDENTIAL_FILE);
  }

  function resolveCredential() {
    const saved = readSavedApiKey();
    if (saved.status === 'ready') return saved;
    if (saved.status === 'error') return saved;

    const environmentKey = typeof env.DEEPSEEK_API_KEY === 'string'
      ? env.DEEPSEEK_API_KEY.trim()
      : '';
    if (environmentKey) {
      return { status: 'ready', apiKey: environmentKey, source: 'environment', error: null };
    }
    return { status: 'unavailable', apiKey: null, source: null, error: null };
  }

  function readSavedApiKey() {
    const file = credentialPath();
    if (!fs.existsSync(file)) {
      return { status: 'unavailable', apiKey: null, source: null, error: null };
    }
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!stored.encryptedApiKey) {
        return { status: 'unavailable', apiKey: null, source: null, error: null };
      }
      if (!isEncryptionAvailable()) {
        return {
          status: 'error',
          apiKey: null,
          source: null,
          error: 'Secure credential storage is unavailable on this computer.',
        };
      }
      const encrypted = Buffer.from(stored.encryptedApiKey, 'base64');
      const apiKey = decryptString(encrypted).trim();
      if (!apiKey) throw new Error('The saved API key is empty.');
      return { status: 'ready', apiKey, source: 'saved', error: null };
    } catch (error) {
      return {
        status: 'error',
        apiKey: null,
        source: null,
        error: error instanceof Error ? error.message : 'Unable to read the saved API key.',
      };
    }
  }

  function getStatus() {
    const credential = resolveCredential();
    return {
      status: credential.status,
      source: PROVIDER,
      data: {
        provider: PROVIDER,
        model: MODEL,
        configured: credential.status === 'ready',
        credentialSource: credential.source,
      },
      error: credential.error,
    };
  }

  function saveApiKey(value) {
    const apiKey = typeof value === 'string' ? value.trim() : '';
    if (!apiKey) return modelError('Enter a DeepSeek API key before saving it.');
    if (!isEncryptionAvailable()) {
      return modelError('Secure credential storage is unavailable on this computer.');
    }
    try {
      const encryptedApiKey = Buffer.from(encryptString(apiKey)).toString('base64');
      writeCredentialFile({ version: 1, encryptedApiKey });
      return getStatus();
    } catch (error) {
      return modelError(error instanceof Error ? error.message : 'Unable to save the API key.');
    }
  }

  function clearApiKey() {
    try {
      writeCredentialFile({ version: 1, encryptedApiKey: null });
      return getStatus();
    } catch (error) {
      return modelError(error instanceof Error ? error.message : 'Unable to clear the saved API key.');
    }
  }

  function writeCredentialFile(value) {
    const file = credentialPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporaryFile = `${file}.tmp`;
    fs.writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporaryFile, file);
  }

  async function complete(input, context = {}) {
    const credential = resolveCredential();
    if (credential.status !== 'ready' || !credential.apiKey) {
      return modelError(credential.error || 'Configure a DeepSeek API key before calling the model.');
    }

    let request;
    try {
      request = normalizeRequest(input);
    } catch (error) {
      return modelError(error instanceof Error ? error.message : 'The model request is invalid.');
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credential.apiKey}`,
    };
    const requestBody = JSON.stringify(request);
    const callId = calls.start({
      purpose: context.purpose,
      projectRoot: context.projectRoot,
      taskId: context.taskId,
      model: MODEL,
      request: {
        url: endpoint,
        method: 'POST',
        headers,
        body: requestBody,
      },
    });
    const controller = new AbortController();
    const startedAt = Date.now();
    const requestTimeoutMs = normalizeTimeout(context.timeoutMs, timeoutMs);
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: requestBody,
        signal: controller.signal,
      });
      const responseBody = await response.text();
      const responseRecord = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
      };
      const payload = parseResponse(responseBody);
      const usage = normalizeUsage(payload.usage);
      const summary = {
        durationMs: Math.max(0, Date.now() - startedAt),
        ...usage,
      };
      if (!response.ok) {
        const error = apiErrorMessage(response.status, payload);
        calls.fail(callId, {
          response: responseRecord,
          error: { name: 'DeepSeekApiError', message: error },
          summary,
        });
        return modelError(error);
      }
      const message = payload?.choices?.[0]?.message;
      if (!message || typeof message.content !== 'string') {
        const error = 'DeepSeek returned a response without assistant content.';
        calls.fail(callId, {
          response: responseRecord,
          error: { name: 'InvalidDeepSeekResponse', message: error },
          summary,
        });
        return modelError(error);
      }
      calls.complete(callId, { response: responseRecord, summary });
      return {
        status: 'ready',
        source: PROVIDER,
        data: {
          callId,
          id: typeof payload.id === 'string' ? payload.id : null,
          model: typeof payload.model === 'string' ? payload.model : MODEL,
          content: message.content,
          reasoningContent: typeof message.reasoning_content === 'string'
            ? message.reasoning_content
            : null,
          finishReason: typeof payload.choices[0].finish_reason === 'string'
            ? payload.choices[0].finish_reason
            : null,
          usage,
        },
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'The DeepSeek request timed out.'
        : error instanceof Error ? error.message : 'Unable to call DeepSeek.';
      calls.fail(callId, {
        error: serializeError(error, message),
        summary: {
          durationMs: Math.max(0, Date.now() - startedAt),
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      });
      if (error instanceof Error && error.name === 'AbortError') {
        return modelError(message);
      }
      return modelError(message);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function testConnection(context = {}) {
    const startedAt = Date.now();
    const result = await complete({
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      maxTokens: 8,
    }, { ...context, purpose: 'connection-test' });
    if (result.status !== 'ready') return result;
    return {
      ...result,
      data: {
        ...result.data,
        latencyMs: Math.max(0, Date.now() - startedAt),
      },
    };
  }

  return {
    getStatus,
    saveApiKey,
    clearApiKey,
    complete,
    testConnection,
    listCalls: () => ({
      status: 'ready',
      source: PROVIDER,
      data: calls.list(),
      error: null,
    }),
    readCall: (callId) => {
      const data = typeof callId === 'string' ? calls.read(callId) : null;
      return data
        ? { status: 'ready', source: PROVIDER, data, error: null }
        : modelError('The model call record was not found.');
    },
  };
}

function normalizeTimeout(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, 10 * 60_000)
    : fallback;
}

function normalizeRequest(input) {
  const messages = input?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new TypeError('At least one model message is required.');
  }
  const normalizedMessages = messages.map((message) => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role)) {
      throw new TypeError('Each model message needs a supported role.');
    }
    if (typeof message.content !== 'string' || !message.content.trim()) {
      throw new TypeError('Each model message needs text content.');
    }
    return { role: message.role, content: message.content };
  });
  const request = {
    model: MODEL,
    messages: normalizedMessages,
    stream: false,
    thinking: { type: input?.thinking === true ? 'enabled' : 'disabled' },
  };
  if (input?.thinking === true && input?.reasoningEffort) {
    if (!['high', 'max'].includes(input.reasoningEffort)) {
      throw new TypeError('Reasoning effort must be high or max.');
    }
    request.reasoning_effort = input.reasoningEffort;
  }
  if (input?.maxTokens !== undefined) {
    if (!Number.isInteger(input.maxTokens) || input.maxTokens < 1) {
      throw new TypeError('maxTokens must be a positive integer.');
    }
    request.max_tokens = input.maxTokens;
  }
  return request;
}

function parseResponse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 500) } };
  }
}

function serializeError(error, fallbackMessage) {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: fallbackMessage, value: error };
  }
  return {
    name: error.name,
    message: error.message || fallbackMessage,
    stack: error.stack || null,
    cause: error.cause ?? null,
  };
}

function apiErrorMessage(status, payload) {
  const message = payload?.error?.message;
  return typeof message === 'string' && message.trim()
    ? `DeepSeek request failed (${status}): ${message.slice(0, 500)}`
    : `DeepSeek request failed with HTTP ${status}.`;
}

function normalizeUsage(value) {
  return {
    inputTokens: numberOrZero(value?.prompt_tokens),
    outputTokens: numberOrZero(value?.completion_tokens),
    totalTokens: numberOrZero(value?.total_tokens),
  };
}

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function modelError(error) {
  return {
    status: 'error',
    source: PROVIDER,
    data: null,
    error,
  };
}
