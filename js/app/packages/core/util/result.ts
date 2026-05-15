import {
  err as neverthrowErr,
  ok as neverthrowOk,
  type Result,
} from 'neverthrow';

export interface Error {
  description?: string;
  fatal?: true;
  arg?: string;
}

export interface ResultError<Code extends string = string> extends Error {
  code: Code;
  message: string;
}

export type ResultErrors<ErrorCode extends string = string> =
  ResultError<ErrorCode>[];

export type ObjectLike = Record<string, any>;
// switched from Record<string, unknown> to unknown to avoid type inference issues
// when using the result in a function signature, the type can use NonNullable<T>
// to ensure that the result is not null and thus a result type
type UnknownObjectLike = unknown;

type AppOk<T> = readonly [null, T] & {
  readonly value: T;
  readonly error?: never;
  isOk(): this is AppOk<T>;
  isErr(): this is never;
  unwrapOr<U>(fallback: U): T | U;
  match<U, V = U>(ok: (value: T) => U, err: (errors: never) => V): U | V;
};

type AppErr<ErrorCode extends string> = readonly [
  ResultErrors<ErrorCode>,
  null,
] & {
  readonly value?: never;
  readonly error: ResultErrors<ErrorCode>;
  isOk(): this is never;
  isErr(): this is AppErr<ErrorCode>;
  unwrapOr<U>(fallback: U): U;
  match<U, V = U>(
    ok: (value: never) => U,
    err: (errors: ResultErrors<ErrorCode>) => V
  ): U | V;
};

/**
 * Application result type backed by neverthrow.
 *
 * The numeric properties/iterator are intentionally kept as a migration bridge
 * for older tuple-style call sites. Prefer `.isOk()`, `.isErr()`, `.value`, and
 * `.error` in new code.
 */
export type AppResult<ErrorCode extends string, T> =
  | AppOk<T>
  | AppErr<ErrorCode>;

export type AppErrorResult<ErrorCode extends string> = AppResult<
  ErrorCode,
  void
>;

function withTuple<T, ErrorCode extends string>(
  result: Result<T, ResultErrors<ErrorCode>>
): AppResult<ErrorCode, T> {
  const tuple = result.isErr() ? [result.error, null] : [null, result.value];

  Object.defineProperties(tuple, {
    value: {
      value: result.isOk() ? result.value : undefined,
      enumerable: false,
    },
    error: {
      value: result.isErr() ? result.error : undefined,
      enumerable: false,
    },
    isOk: {
      value: result.isOk.bind(result),
      enumerable: false,
    },
    isErr: {
      value: result.isErr.bind(result),
      enumerable: false,
    },
    unwrapOr: {
      value: result.unwrapOr.bind(result),
      enumerable: false,
    },
    match: {
      value: result.match.bind(result),
      enumerable: false,
    },
  });

  return tuple as unknown as AppResult<ErrorCode, T>;
}

export function ok<T, ErrorCode extends string = never>(
  result: T
): AppResult<ErrorCode, T> {
  return withTuple(neverthrowOk<T, ResultErrors<ErrorCode>>(result));
}

export function err<ErrorCode extends string>(
  code: ErrorCode,
  message: string,
  options?: Omit<ResultError<ErrorCode>, 'code' | 'message'>
): AppResult<ErrorCode, never> {
  return errFromErrors([{ code, message, ...options }]);
}

export function errFromErrors<ErrorCode extends string, T = never>(
  errors: ResultErrors<ErrorCode>
): AppResult<ErrorCode, T> {
  return withTuple(neverthrowErr<T, ResultErrors<ErrorCode>>(errors));
}

/**
 * Checks if the result is an error, optionally checking for a specific error code.
 */
export function isErr<ErrorCode extends string>(
  result: AppResult<string, unknown>,
  errorCode: ErrorCode
): result is AppErr<ErrorCode>;
export function isErr<ErrorCode extends string>(
  result: AppResult<ErrorCode, unknown>
): result is AppErr<ErrorCode>;
export function isErr<ErrorCode extends string = string>(
  result: AppResult<ErrorCode, unknown>,
  errorCode?: ErrorCode
): result is AppErr<ErrorCode> {
  if (!result.isErr()) {
    return false;
  }
  return (
    errorCode == null || result.error.some((error) => error.code === errorCode)
  );
}

/** Checks if the result is ok (not an error). */
export function isOk<ErrorCode extends string, T extends UnknownObjectLike>(
  result: AppResult<ErrorCode, T>
): result is AppOk<T> {
  return result.isOk();
}

/** Unwraps a result, throwing an error if it's an error result. */
export function unwrapOrThrow<
  ErrorCode extends string,
  T extends UnknownObjectLike,
>(result: AppResult<ErrorCode, T>): T {
  if (result.isErr()) {
    throw new Error(result.error.map((e) => e.message).join(', '));
  }
  return result.value;
}

/** Unwraps a result, logging an error to the console if it's an error result. */
export function logAndUnwrap<const T extends UnknownObjectLike>(
  result: AppResult<any, T>
): T | undefined {
  if (result.isErr()) {
    console.error('Error:', result.error.map((e) => e.message).join(', '));
    return undefined;
  }
  return result.value;
}

/** Safely executes a function that returns a result and handles errors. */
export async function tryCatch<
  ErrorCode extends string,
  T extends UnknownObjectLike,
>(
  fn: () => Promise<AppResult<ErrorCode, T>> | AppResult<ErrorCode, T>,
  errorHandler: (errors: ResultErrors<ErrorCode>) => void
): Promise<T | undefined> {
  const result = await fn();
  if (result.isErr()) {
    errorHandler(result.error);
    return undefined;
  }
  return result.value;
}

/** Maps over an ok result, or passes through an error. */
export function mapOk<ErrorCode extends string, T, U>(
  result: AppResult<ErrorCode, T>,
  fn: (value: T) => U
): AppResult<ErrorCode, U> {
  if (result.isErr()) {
    return errFromErrors(result.error);
  }
  return ok(fn(result.value));
}

/** Chains multiple result-returning functions, short-circuiting on errors. */
export function chain<ErrorCode extends string, T extends any[]>(
  initial: AppResult<ErrorCode, T[0]>,
  ...fns: Array<(value: any) => AppResult<ErrorCode, any>>
): AppResult<ErrorCode, T[number]> {
  let result: AppResult<ErrorCode, any> = initial;
  for (const fn of fns) {
    if (result.isErr()) {
      return errFromErrors(result.error);
    }
    result = fn(result.value);
  }
  return result;
}

/** Combines multiple results into a single result, collecting all errors. */
export function combine<ErrorCode extends string, T extends any[]>(
  ...results: { [K in keyof T]: AppResult<ErrorCode, T[K]> }
): AppResult<ErrorCode, T> | AppResult<ErrorCode, {}> {
  const errors: ResultErrors<ErrorCode> = [];
  const values: any[] = [];

  for (const result of results) {
    if (result.isErr()) {
      errors.push(...result.error);
    } else {
      values.push(result.value);
    }
  }

  if (errors.length > 0) {
    return errFromErrors(errors);
  }

  return ok(values as T);
}

export function onlyErr<ErrorCode extends string>(
  code: ErrorCode,
  message: string
): AppErrorResult<ErrorCode> {
  return err(code, message);
}

/** Handles different error codes with specific functions, stopping on the first fatal error. */
export function onErr<
  ErrorCode extends string,
  T extends UnknownObjectLike,
  Handlers extends Record<ErrorCode, (error: ResultError<ErrorCode>) => void>,
>(result: AppResult<ErrorCode, T>, handlers: Handlers): boolean {
  if (result.isErr()) {
    for (const error of result.error) {
      handlers[error.code](error);
      if (error.fatal) {
        return true;
      }
    }
  }
  return false;
}

export type ResultType<T extends AppResult<any, any>> = T extends readonly [
  null,
  infer R,
]
  ? NonNullable<R>
  : never;

/** Error class that preserves result errors when thrown. */
export class ThrownResultError<E extends string = string> extends Error {
  constructor(public readonly errors: ResultErrors<E>) {
    super(errors.map((e) => e.message).join(', '));
    this.name = 'ThrownResultError';
  }
}

/** Wraps a result-returning async function to throw on error. */
export async function throwOnErr<E extends string, T>(
  fn: () => Promise<AppResult<E, T>>
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
): Promise<AppResult<string, T>> {
  try {
    return ok(await throwable());
  } catch (error) {
    if (error instanceof ThrownResultError) {
      return errFromErrors(error.errors);
    }
    return err(
      'UNKNOWN',
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * A hybrid type that acts as both a single ResultError and an array containing
 * that error. Kept for call sites that want the first error while preserving
 * array access.
 */
export type HybridResultError<ErrorCode extends string> =
  ResultError<ErrorCode> &
    [ResultError<ErrorCode>] & {
      readonly length: 1;
    };

export function resultError<ErrorCode extends string>(
  error: ResultError<ErrorCode>
): ResultError<ErrorCode> {
  return error;
}

function errorsFrom<ErrorCode extends string>(
  value: ResultErrors<ErrorCode> | AppResult<ErrorCode, unknown>
): ResultErrors<ErrorCode> {
  if ('isErr' in value) {
    if (value.isErr()) return value.error;
    throw new Error('Cannot create hybrid error from an ok result');
  }
  return value;
}

/** Converts result errors to a hybrid object exposing the first error directly. */
export function toHybridError<ErrorCode extends string>(
  value: ResultErrors<ErrorCode> | AppResult<ErrorCode, unknown>
): HybridResultError<ErrorCode> {
  const errors = errorsFrom(value);
  if (errors.length === 0) {
    throw new Error('Cannot create hybrid error from empty array');
  }

  const primaryError = errors[0];
  const errorArray = [primaryError] as [ResultError<ErrorCode>];

  const hybrid = Object.assign(errorArray, {
    code: primaryError.code,
    message: primaryError.message,
    description: primaryError.description,
    fatal: primaryError.fatal,
    arg: primaryError.arg,
  }) as HybridResultError<ErrorCode>;

  Object.defineProperty(hybrid, 'length', {
    value: 1,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  return hybrid;
}
