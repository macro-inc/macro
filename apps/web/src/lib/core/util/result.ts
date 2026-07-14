import { err, ok, type Result } from 'neverthrow';

export interface Error {
  description?: string;
  fatal?: true;
  arg?: string;
}

export interface ResultError<Code extends string = string> extends Error {
  code: Code;
  message: string;
}

export type ObjectLike = Record<string, any>;

export type ResultType<T extends Result<any, any>> =
  T extends Result<infer Value, any> ? Value : never;

/** Error class that preserves result errors when thrown at query/UI boundaries. */
export class ThrownResultError<E extends string = string> extends Error {
  constructor(public readonly errors: ResultError<E>[]) {
    super(errors.map((e) => e.message).join(', '));
    this.name = 'ThrownResultError';
  }
}

/** Wraps a result-returning async function to throw on error. */
export async function throwOnErr<E extends string, T>(
  fn: () => Promise<Result<T, ResultError<E>[]>>
): Promise<T> {
  const result = await fn();
  if (result.isErr()) {
    throw new ThrownResultError(result.error);
  }
  return result.value;
}

/** Wraps an async throwable function to return a result instead. */
export async function catchToResult<T>(
  throwable: () => Promise<T>
): Promise<Result<T, ResultError<string>[]>> {
  try {
    return ok(await throwable());
  } catch (error) {
    if (error instanceof ThrownResultError) {
      return err(error.errors);
    }
    return err([
      {
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
      },
    ]);
  }
}
