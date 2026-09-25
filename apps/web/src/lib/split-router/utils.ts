const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Bounded identifier safe to use as an ordinary object key. */
export function isSafeName(value: string): boolean {
  return (
    value.length <= 64 &&
    value !== 'constructor' &&
    value !== 'prototype' &&
    SAFE_NAME.test(value)
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function takeLast<T>(values: readonly T[] | undefined): T | undefined {
  return values?.at(-1);
}

export function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return value instanceof Promise;
}

export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;

  throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

export function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

export function reactiveRecord<T extends object>(read: () => T): T {
  return new Proxy({} as T, {
    get: (_target, key) => read()[key as keyof T],
    has: (_target, key) => key in read(),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor: (_target, key) => {
      if (!(key in read())) return;

      return {
        configurable: true,
        enumerable: true,
        value: read()[key as keyof T],
      };
    },
  });
}
