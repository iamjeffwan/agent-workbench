import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

import { redactCredentialText } from '../../../agent-workbench-security/index.mjs';
import {
  DEFAULT_SNAPSHOT_LIMITS,
  snapshotValue,
  type SnapshotLimits,
} from './snapshot.js';

export type TraceCallRecord = {
  callId: number;
  methodId: number;
  parentCallId: number | null;
  processOriginId: string;
  activityId: string | null;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  args: unknown;
  result?: unknown;
  error?: { name: string; message: string };
  incomplete?: boolean;
  snapshotDegraded?: boolean;
};

export type RecorderOptions = {
  processOriginId: string;
  outPath: string;
  /** Mark current activity when available; null for first vertical slice. */
  activityId?: string | null;
  bufferCapacity?: number;
  flushSize?: number;
  snapshotLimits?: SnapshotLimits;
};

type Store = {
  callId: number;
};

export class TraceRecorder {
  private readonly als = new AsyncLocalStorage<Store>();
  private readonly processOriginId: string;
  private readonly outPath: string;
  private readonly activityId: string | null;
  private readonly bufferCapacity: number;
  private readonly flushSize: number;
  private readonly degradeAt: number;
  private readonly snapshotLimits: SnapshotLimits;
  private readonly buffer: TraceCallRecord[] = [];
  private nextCallId = 1;
  private summaryOnly = false;
  private incomplete = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(options: RecorderOptions) {
    this.processOriginId = redactCredentialText(options.processOriginId);
    this.outPath = path.resolve(options.outPath);
    this.activityId = options.activityId
      ? redactCredentialText(options.activityId)
      : null;
    this.bufferCapacity = options.bufferCapacity ?? 256;
    // First vertical slice flushes quickly so short-lived processes keep records.
    this.flushSize = options.flushSize ?? 1;
    this.degradeAt = Math.max(1, Math.floor(this.bufferCapacity / 2));
    this.snapshotLimits = options.snapshotLimits ?? DEFAULT_SNAPSHOT_LIMITS;

    fs.mkdirSync(path.dirname(this.outPath), { recursive: true });
    this.flushTimer = setInterval(() => this.safeFlush('interval'), 200);
    this.flushTimer.unref?.();

    process.once('beforeExit', () => this.safeFlush('beforeExit'));
    process.once('exit', () => this.safeFlush('exit'));
  }

  wrap(methodId: number, args: unknown[], fn: () => unknown): unknown {
    const parentCallId = this.als.getStore()?.callId ?? null;
    const callId = this.nextCallId;
    this.nextCallId += 1;
    const startedAt = Date.now();

    const argsSnap = snapshotValue(args, this.snapshotLimits, {
      summaryOnly: this.summaryOnly,
    });

    const finish = (
      result: unknown,
      error: unknown | undefined,
    ): TraceCallRecord => {
      const endedAt = Date.now();
      let snapshotDegraded = argsSnap.degraded;
      let resultValue: unknown;
      let errorValue: TraceCallRecord['error'];
      let hasResult = false;

      if (error !== undefined) {
        const err =
          error instanceof Error
            ? error
            : new Error(typeof error === 'string' ? error : String(error));
        errorValue = {
          name: err.name,
          message: redactCredentialText(err.message).slice(
            0,
            this.snapshotLimits.maxStringLength,
          ),
        };
      } else {
        const resultSnap = snapshotValue(result, this.snapshotLimits, {
          summaryOnly: this.summaryOnly,
        });
        resultValue = resultSnap.value;
        snapshotDegraded ||= resultSnap.degraded;
        hasResult = true;
      }

      return {
        callId,
        methodId,
        parentCallId,
        processOriginId: this.processOriginId,
        activityId: this.activityId,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        args: argsSnap.value,
        ...(hasResult ? { result: resultValue } : {}),
        ...(errorValue ? { error: errorValue } : {}),
        ...(this.incomplete ? { incomplete: true } : {}),
        ...(snapshotDegraded ? { snapshotDegraded: true } : {}),
      };
    };

    const run = (): unknown => {
      try {
        const result = fn();
        if (isPromiseLike(result)) {
          return result.then(
            (value) => {
              this.enqueue(finish(value, undefined));
              return value;
            },
            (error: unknown) => {
              this.enqueue(finish(undefined, error));
              throw error;
            },
          );
        }

        this.enqueue(finish(result, undefined));
        return result;
      } catch (error) {
        this.enqueue(finish(undefined, error));
        throw error;
      }
    };

    return this.als.run({ callId }, run);
  }

  flush(): void {
    if (this.buffer.length === 0) {
      return;
    }

    const batch = this.buffer.splice(0, this.buffer.length);
    const lines = `${batch.map((record) => JSON.stringify(record)).join('\n')}\n`;

    try {
      fs.appendFileSync(this.outPath, lines, 'utf8');
    } catch (error) {
      // Never silently drop: restore buffer, mark incomplete, and surface the failure.
      this.buffer.unshift(...batch);
      this.summaryOnly = true;
      this.incomplete = true;
      throw error;
    }
  }

  private safeFlush(reason: string): void {
    try {
      this.flush();
    } catch (error) {
      const detail =
        error instanceof Error ? error.stack || error.message : String(error);
      console.error(
        `[program-tracer] flush failed (${reason}); records retained in memory: ${redactCredentialText(detail)}`,
      );
    }
  }

  private enqueue(record: TraceCallRecord): void {
    if (this.buffer.length >= this.degradeAt) {
      // Pressure step 1: lower snapshot precision before the buffer hard-caps.
      this.summaryOnly = true;
    }

    this.buffer.push(record);

    if (this.buffer.length >= this.bufferCapacity) {
      // Pressure step 2: block on synchronous flush; mark incompleteness.
      this.incomplete = true;
      record.incomplete = true;
      record.snapshotDegraded = true;
      this.flush();
      return;
    }

    if (this.buffer.length >= this.flushSize) {
      this.flush();
    }
  }
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
