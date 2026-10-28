const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const MAX_NAME_LENGTH = 64;

/** Bounded identifier that is safe to use as an ordinary object key. */
export function isSafeName(value: string): boolean {
  const reserved = value === 'constructor' || value === 'prototype';
  const bounded = value.length <= MAX_NAME_LENGTH;

  return bounded && !reserved && SAFE_NAME.test(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  const isObject = value !== null && typeof value === 'object';

  return isObject && !Array.isArray(value);
}

/** For work nothing can call off, such as hover preloads; it never aborts. */
export const UNCANCELLABLE: AbortSignal = new AbortController().signal;

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;

  return error instanceof DOMException && error.name === 'AbortError';
}

let fallbackSequence = 0;

export function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return `${prefix}_${random}`;

  fallbackSequence += 1;
  const time = Date.now().toString(36);
  const sequence = fallbackSequence.toString(36);

  return `${prefix}_${time}${sequence}`;
}

/** A value now, or later; only real promises leave the current tick. */
export type MaybePromise<T> = T | Promise<T>;

export function isPromise<T>(value: MaybePromise<T>): value is Promise<T> {
  return value instanceof Promise;
}

/** Applies `fn` now, or once `value` settles. */
export function mapMaybe<T, R>(
  value: MaybePromise<T>,
  fn: (value: T) => MaybePromise<R>
): MaybePromise<R> {
  if (!isPromise(value)) return fn(value);

  return value.then(fn);
}

/** Runs `run`, turning a synchronous throw or a rejection into `onError`'s result. */
export function settleMaybe<T>(
  run: () => MaybePromise<T>,
  onError: (error: unknown) => T
): MaybePromise<T> {
  let value: MaybePromise<T>;

  try {
    value = run();
  } catch (error) {
    return onError(error);
  }

  if (!isPromise(value)) return value;

  return value.catch(onError);
}

export const CANCELLED: unique symbol = Symbol('split-router.cancelled');

export type Cancelled = typeof CANCELLED;

/** A value, possibly async, or `CANCELLED` when the work was called off. */
export type Outcome<T> = MaybePromise<T | Cancelled>;

/**
 * The next step, skipped once cancelled. Not named `then`: a module
 * exporting `then` is a thenable, which breaks `await import()`.
 */
export function andThen<T, R>(
  value: Outcome<T>,
  step: (value: T) => Outcome<R>
): Outcome<R> {
  return mapMaybe(value, (resolved): Outcome<R> => {
    if (resolved === CANCELLED) return CANCELLED;

    return step(resolved);
  });
}

function unlessCancelled<T>(
  resolved: readonly (T | Cancelled)[]
): T[] | Cancelled {
  if (resolved.includes(CANCELLED)) return CANCELLED;

  return resolved as T[];
}

export function all<T>(values: readonly Outcome<T>[]): Outcome<T[]> {
  const waiting = values.some(isPromise);
  if (!waiting) return unlessCancelled(values as (T | Cancelled)[]);

  return mapMaybe(Promise.all(values), unlessCancelled);
}
