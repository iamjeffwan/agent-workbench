import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REDACTED_VALUE,
  isCredentialKey,
  redactCredentials,
  redactCredentialText,
} from '../index.mjs';

test('credential field names include common provider prefixes and camel case', () => {
  assert.equal(isCredentialKey('password'), true);
  assert.equal(isCredentialKey('DEEPSEEK_API_KEY'), true);
  assert.equal(isCredentialKey('accessToken'), true);
  assert.equal(isCredentialKey('clientSecret'), true);
  assert.equal(isCredentialKey('Authorization'), true);
  assert.equal(isCredentialKey('set-cookie'), true);
  assert.equal(isCredentialKey('sessionId'), true);
  assert.equal(isCredentialKey('authorizationHeader'), true);
  assert.equal(isCredentialKey('passwordHash'), true);
  assert.equal(isCredentialKey('apiKeyBackup'), true);
  assert.equal(isCredentialKey('AWS_ACCESS_KEY_ID'), true);
});

test('ordinary key and counter names are not treated as credentials', () => {
  assert.equal(isCredentialKey('cacheKey'), false);
  assert.equal(isCredentialKey('tokenCount'), false);
  assert.equal(isCredentialKey('content'), false);
});

test('structured credentials are hidden without mutating the input', () => {
  const input = {
    password: 'hunter2',
    headers: { Authorization: 'Bearer header-secret' },
    account: { accessToken: 'access-secret', displayName: 'Ada' },
    AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    content: 'A token budget is ordinary product text.',
  };

  assert.deepEqual(redactCredentials(input), {
    password: REDACTED_VALUE,
    headers: { Authorization: REDACTED_VALUE },
    account: { accessToken: REDACTED_VALUE, displayName: 'Ada' },
    AWS_ACCESS_KEY_ID: REDACTED_VALUE,
    content: 'A token budget is ordinary product text.',
  });
  assert.equal(input.password, 'hunter2');
  assert.equal(input.account.accessToken, 'access-secret');
});

test('structured command and error fields use strict text redaction', () => {
  assert.deepEqual(
    redactCredentials({
      command: "token='abc123';",
      error_message: "password='hunter2';",
      error: { message: "token='abc123';" },
      content: 'token="ordinary";',
    }),
    {
      command: `token='${REDACTED_VALUE}';`,
      error_message: `password='${REDACTED_VALUE}';`,
      error: { message: `token='${REDACTED_VALUE}';` },
      content: 'token="ordinary";',
    },
  );
});

test('credential assignments in command text are hidden', () => {
  assert.equal(
    redactCredentialText('DEEPSEEK_API_KEY=sk-test-1234567890abcdef node app.js'),
    `DEEPSEEK_API_KEY=${REDACTED_VALUE} node app.js`,
  );
  assert.equal(
    redactCredentialText('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE node app.js'),
    `AWS_ACCESS_KEY_ID=${REDACTED_VALUE} node app.js`,
  );
});

test('quoted credential assignments keep their surrounding quotes', () => {
  assert.equal(
    redactCredentialText('node app.js "DEEPSEEK_API_KEY=sk-test-1234567890abcdef"'),
    `node app.js "DEEPSEEK_API_KEY=${REDACTED_VALUE}"`,
  );
});

test('credentials passed as separate command arguments are hidden', () => {
  assert.equal(
    redactCredentialText('node app.js --password hunter2 --mode safe'),
    `node app.js --password ${REDACTED_VALUE} --mode safe`,
  );
  assert.equal(
    redactCredentialText('node app.js --deepseek-api-key "sk-test-1234567890abcdef"'),
    `node app.js --deepseek-api-key "${REDACTED_VALUE}"`,
  );
  assert.equal(
    redactCredentialText('node app.js --session-id session-secret'),
    `node app.js --session-id ${REDACTED_VALUE}`,
  );
});

test('session credential assignments are hidden', () => {
  assert.equal(
    redactCredentialText('SESSION_ID=session-secret node app.js'),
    `SESSION_ID=${REDACTED_VALUE} node app.js`,
  );
  assert.equal(
    redactCredentialText('$env:SESSION_ID = "session-secret"'),
    `$env:SESSION_ID = "${REDACTED_VALUE}"`,
  );
  assert.equal(
    redactCredentialText("$password = 'hunter2';"),
    `$password = '${REDACTED_VALUE}';`,
  );
  assert.equal(
    redactCredentialText("$token = 'session-secret';"),
    `$token = '${REDACTED_VALUE}';`,
  );
  assert.equal(
    redactCredentialText("token='secret';"),
    `token='${REDACTED_VALUE}';`,
  );
  assert.equal(
    redactCredentialText("token='abc123';", { context: 'command' }),
    `token='${REDACTED_VALUE}';`,
  );
  assert.equal(
    redactCredentialText("password='hunter2';", { context: 'command' }),
    `password='${REDACTED_VALUE}';`,
  );
});

test('credential-looking JSON and error fields are hidden', () => {
  assert.equal(
    redactCredentialText('{"password": "hunter2"}'),
    `{"password": "${REDACTED_VALUE}"}`,
  );
  assert.equal(
    redactCredentialText('password: hunter2'),
    `password: ${REDACTED_VALUE}`,
  );
  assert.equal(
    redactCredentialText('authorization_header: bearer-secret'),
    `authorization_header: ${REDACTED_VALUE}`,
  );
  assert.equal(
    redactCredentialText("{ password: 'hunter2' }"),
    `{ password: '${REDACTED_VALUE}' }`,
  );
  assert.equal(
    redactCredentialText("result={ session_id: 'session-secret' }"),
    `result={ session_id: '${REDACTED_VALUE}' }`,
  );
  assert.equal(
    redactCredentialText("credentials { apiKey: 'secret-value' }"),
    `credentials { apiKey: '${REDACTED_VALUE}' }`,
  );
});

test('authorization headers and high-confidence tokens are hidden', () => {
  assert.equal(
    redactCredentialText('Authorization: Bearer abc.def.ghi'),
    `Authorization: ${REDACTED_VALUE}`,
  );
  assert.equal(
    redactCredentialText('token=ghp_1234567890abcdefghijklmnopqrstuvwxyz'),
    `token=${REDACTED_VALUE}`,
  );
});

test('passwords in URLs are hidden while the URL remains useful', () => {
  assert.equal(
    redactCredentialText('postgresql://alice:swordfish@example.com/beside'),
    `postgresql://alice:${REDACTED_VALUE}@example.com/beside`,
  );
});

test('private key blocks are hidden', () => {
  const text = 'before\n-----BEGIN PRIVATE KEY-----\nfake-key-data\n-----END PRIVATE KEY-----\nafter';
  assert.equal(redactCredentialText(text), `before\n${REDACTED_VALUE}\nafter`);
});

test('ordinary source and business text are unchanged', () => {
  const source = [
    'const tokenCount = 3;',
    'const token = await getToken();',
    'const token="ordinary";',
    'token="ordinary";',
    'function f(token="ordinary") {}',
    'password = config.password;',
    'const options = { token: "ordinary" };',
    'this.password = options.password;',
    '// explain the request body',
  ].join('\n');
  assert.equal(redactCredentialText(source, { context: 'source' }), source);
});
