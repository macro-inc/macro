import { CombinedError } from '@urql/core';
import type { UrqlQueryStatus } from './types';

/** Normalizes observer and selector failures to urql's public error type. */
export function toCombinedError(cause: unknown): CombinedError {
  if (cause instanceof CombinedError) return cause;

  return new CombinedError({
    networkError: cause instanceof Error ? cause : new Error(String(cause)),
  });
}

/** Derives the shared high-level query status. */
export function getQueryStatus(
  error: CombinedError | null,
  fetched: boolean
): UrqlQueryStatus {
  if (error) return 'error';
  return fetched ? 'success' : 'pending';
}

/** Owns listener delivery and the stable Solid result used by actions. */
export class ObserverResult<Result extends object> {
  private readonly listeners = new Set<(result: Result) => void>();
  private reference: Result | undefined;

  constructor(private readonly getCurrentResult: () => Result) {}

  setReference(result: Result): void {
    this.reference = result;
  }

  subscribe(listener: (result: Result) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getActionResult(): Result {
    return this.reference ?? this.getCurrentResult();
  }

  notify(): void {
    if (this.listeners.size === 0) return;

    const result = this.getCurrentResult();

    for (const listener of this.listeners) listener(result);
  }

  clear(): void {
    this.listeners.clear();
  }
}
