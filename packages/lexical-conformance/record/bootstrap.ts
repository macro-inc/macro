import { afterAll } from 'vitest';
import { isOracleFrame } from './attribution';
import { Entropy } from './entropy';
import type { Op } from './schema';

/** Loaded before upstream setup/imports: module values have their own deterministic tape. */
export const moduleReads: Op[] = [];
export const moduleEntropy = new Entropy(
  (op) => moduleReads.push({ ...op, source: op.src, src: 'module-init' }),
  undefined,
  isOracleFrame
);
moduleEntropy.install();

const nativeQueueMicrotask = globalThis.queueMicrotask;
globalThis.queueMicrotask = (callback) => {
  if (!isOracleFrame()) return nativeQueueMicrotask(callback);
  nativeQueueMicrotask(() => {
    const hook = (
      globalThis as typeof globalThis & {
        __lexRec?: {
          enter(cause: string): (() => void) | undefined;
          tick(reason: string): void;
        };
      }
    ).__lexRec;
    const exit = hook?.enter('microtask');
    try {
      hook?.tick('microtask');
      callback();
    } finally {
      exit?.();
    }
  });
};
afterAll(() => {
  moduleEntropy.dispose();
  globalThis.queueMicrotask = nativeQueueMicrotask;
});
