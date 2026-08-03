import assert from 'node:assert/strict';
import test from 'node:test';

import { snapshotValue } from '../dist/guest/snapshot.js';

test('snapshot preserves special value summaries while hiding strict fields', () => {
  assert.deepEqual(snapshotValue(new Date('2026-08-03T00:00:00.000Z')).value, {
    $type: 'Date',
    $iso: '2026-08-03T00:00:00.000Z',
  });
  assert.deepEqual(snapshotValue(Buffer.from('secret bytes')).value, {
    $type: 'Buffer',
    $length: 12,
  });
  assert.deepEqual(snapshotValue(new Error("token='abc123';")).value, {
    $type: 'Error',
    name: 'Error',
    message: "token='[REDACTED]';",
  });
  assert.deepEqual(
    snapshotValue({
      command: "token='abc123';",
      error: { message: "password='hunter2';" },
      content: 'token="ordinary";',
    }).value,
    {
      command: "token='[REDACTED]';",
      error: { message: "password='[REDACTED]';" },
      content: 'token="ordinary";',
    },
  );
});

test('snapshot property limits apply before traversing a large array', () => {
  let reads = 0;
  const values = new Proxy(new Array(200_000).fill('ordinary'), {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) {
        reads += 1;
      }
      return Reflect.get(target, property, receiver);
    },
  });

  const result = snapshotValue(values, {
    maxDepth: 3,
    maxProperties: 1,
    maxStringLength: 100,
    maxBytes: 1_000,
    maxTimeMs: 1_000,
  });

  assert.equal(reads, 1);
  assert.deepEqual(result.value, {
    $type: 'Array',
    $length: 200_000,
    $items: ['ordinary'],
  });
});

test('snapshot reads only selected object properties', () => {
  let reads = 0;
  const source = Object.fromEntries(
    Array.from({ length: 5_000 }, (_value, index) => [`field${index}`, index]),
  );
  const value = new Proxy(source, {
    get(target, property, receiver) {
      if (typeof property === 'string' && property.startsWith('field')) {
        reads += 1;
      }
      return Reflect.get(target, property, receiver);
    },
  });

  const result = snapshotValue(value, {
    maxDepth: 3,
    maxProperties: 1,
    maxStringLength: 100,
    maxBytes: 1_000,
    maxTimeMs: 1_000,
  });

  assert.equal(reads, 1);
  assert.deepEqual(result.value, { field0: 0 });
  assert.equal(result.degraded, true);
});
