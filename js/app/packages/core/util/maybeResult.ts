export interface Error {
  description?: string;
  fatal?: true;
  arg?: string;
}

export interface ResultError<Code extends string = string> extends Error {
  code: Code;
  message: string;
}

export type MaybeError<ErrorCode extends string> =
  | [null]
  | [ResultError<ErrorCode>[]];

export type ObjectLike = Record<string, any>;
// switched from Record<string, unknown> to unknown to avoid type inference issues
// when using the result in a function signature, the type can use NonNullable<T>
// to ensure that the result is not null and thus a result type
type UnknownObjectLike = unknown;

export type MaybeResult<ErrorCode extends string, T> =
  | [null, T]
  | [ResultError<ErrorCode>[], null];

/**
 * Checks if the result is an error, optionally checking for a specific error code.
 * @template ErrorCode - The type of error codes used in the result.
 * @template T - The type of the successful result value.
 * @param {MaybeError<ErrorCode> | MaybeResult<ErrorCode, UnknownObjectLike>} result - The result to check.
 * @param {ErrorCode} [errorCode] - Optional specific error code to check for.
 * @returns {boolean} True if the result is an error (and matches the specified error code if provided), false otherwise.
 */
export function isErr<ErrorCode extends string>(
  result: MaybeError<string> | MaybeResult<string, any>,
  errorCode: ErrorCode
): result is [ResultError<ErrorCode>[], null];
export function isErr<ErrorCode extends string>(
  result: MaybeError<ErrorCode> | MaybeResult<ErrorCode, any>
): result is [ResultError<ErrorCode>[], null];
export function isErr<ErrorCode extends string = string>(
  result: MaybeError<ErrorCode> | MaybeResult<ErrorCode, any>,
  errorCode?: ErrorCode
): result is [ResultError<ErrorCode>[], null] {
  if (result[0] == null) {
    return false;
  }
  return (
    errorCode == null || result[0].some((error) => error.code === errorCode)
  );
}

/**
 * Checks if the result is ok (not an error).
 * @template ErrorCode - The type of error codes used in the result.
 * @template T - The type of the successful result value.
 * @param {MaybeError<ErrorCode> | MaybeResult<ErrorCode, T>} result - The result to check.
 * @returns {boolean} True if the result is ok, false otherwise.
 */
export function isOk<ErrorCode extends string, T extends UnknownObjectLike>(
  result: MaybeError<ErrorCode> | MaybeResult<ErrorCode, T>
): result is [null] | [null, T] {
  return result[0] === null;
}

/**
 * Unwraps a MaybeResult, throwing an error if it's an error result.
 * @template ErrorCode - The type of error codes used in the result.
 * @template T - The type of the successful result value.
 * @param {MaybeResult<ErrorCode, T>} result - The result to unwrap.
 * @returns {T} The unwrapped value if the result is ok.
 * @throws {Error} If the result is an error, with all error messages joined.
 */
export function maybeThrow<
  ErrorCode extends string,
  T extends UnknownObjectLike,
>(result: MaybeResult<ErrorCode, T>): T {
  if (isErr(result)) {
    throw new Error(result[0].map((e) => e.message).join(', '));
  }
  return result[1];
}

/**
 * Unwraps a MaybeResult, logging an error to the console if it's an error result.
 * @template ErrorCode - The type of error codes used in the result.
 * @template T - The type of the successful result value.
 * @param {MaybeResult<ErrorCode, T>} result - The result to unwrap.
 * @returns {T | undefined} The unwrapped value if the result is ok, undefined if it's an error.
 */
export function maybeLog<const T extends UnknownObjectLike>(
  result: MaybeResult<any, T>
): T | undefined {
  if (isErr(result)) {
    console.error('Error:', result[0].map((e) => e.message).join(', '));
    return undefined;
  }
  return result[1];
}

/**
 * Safely executes a function that returns a MaybeResult and handles errors.
 * @template ErrorCode - The type of error codes used in the result.
 * @template T - The type of the successful result value.
 * @param {() => Promise<MaybeResult<ErrorCode, T>>} fn - The function to execute.
 * @param {(errors: ResultError<ErrorCode>[]) => void} errorHandler - The function to handle errors.
 * @returns {Promise<T | undefined>} The result value if successful, undefined if an error occurred.
 */
export async function tryCatch<
  ErrorCode extends string,
  T extends UnknownObjectLike,
>(
  fn: () => Promise<MaybeResult<ErrorCode, T>> | MaybeResult<ErrorCode, T>,
  errorHandler: (errors: ResultError<ErrorCode>[]) => void
): Promise<T | undefined> {
  const result = await fn();
  if (isErr(result)) {
    errorHandler(result[0]);
    return undefined;
  }
  return result[1];
}

/**
 * Maps over an ok result, or passes through an error.
 * @template ErrorCode - The type of error codes used in the result.
 * @template MR - The type of the input resul.
 * @template U - The type of the output result
 * @param {MaybeResult<ErrorCode, MR>} result - The result to map
 * @param {(value: ResultType<MR>) => U} fn - The function to apply to the ok value.
 * @returns {MaybeResult<ErrorCode, U>} A new MaybeResult with the mapped value or the original error.
 */
export function mapOk<
  ErrorCode extends string,
  MR extends MaybeResult<ErrorCode, NonNullable<any>>,
  U,
>(result: MR, fn: (value: ResultType<MR>) => U): MaybeResult<ErrorCode, U> {
  if (isErr(result)) {
    return result;
  }
  return [null, fn(result[1])];
}

/**
 * Chains multiple MaybeResult-returning functions, short-circuiting on errors.
 * @template ErrorCode - The type of error codes used in the result.
 * @template T - The tuple type representing the types of the input and intermediate results.
 * @param {MaybeResult<ErrorCode, T[0]>} initial - The initial result.
 * @param {...Array<(value: any) => MaybeResult<ErrorCode, any>>} fns - The functions to chain.
 * @returns {MaybeResult<ErrorCode, T[number]>} The result of the last chained function or the first encountered error.
 *
 * @example
 * const result = chain(
 *   ok({ value: 5 }),
 *   (v) => ok({ doubled: v.value * 2 }),
 *   (v) => ok({ squared: v.doubled ** 2 })
 * );
 * // result will be [null, { squared: 100 }]
 *
 * @example
 * const result = chain(
 *   ok({ value: 5 }),
 *   (v) => ok({ doubled: v.value * 2 }),
 *   (v) => err('NOT_OKAY', 'Value is NOT okay'),
 *   (v) => ok({ final: v }) // This function won't be called due to the previous error
 * );
 * // result will be [[{ code: 'NOT_OKAY', message: 'Value is NOT okay' }], null]
 */
export function chain<ErrorCode extends string, T extends any[]>(
  initial: MaybeResult<ErrorCode, T[0]>,
  ...fns: Array<(value: any) => MaybeResult<ErrorCode, any>>
): MaybeResult<ErrorCode, T[number]> {
  let result = initial;
  for (const fn of fns) {
    if (isErr(result)) {
      return result;
    }
    result = fn(result[1]);
  }
  return result;
}

/**
 * Combines multiple MaybeResults into a single MaybeResult.
 * @template ErrorCode - The type of error codes used in the results.
 * @template T - The tuple type representing the types of the input results.
 * @param {...MaybeResult<ErrorCode, T[number]>} results - The results to combine.
 * @returns {MaybeResult<ErrorCode, T>} A combined MaybeResult with all values or all errors.
 */
export function combine<ErrorCode extends string, T extends any[]>(
  ...results: { [K in keyof T]: MaybeResult<ErrorCode, T[K]> }
): MaybeResult<ErrorCode, T> | MaybeResult<ErrorCode, {}> {
  const errors: ResultError<ErrorCode>[] = [];
  const values: any[] = [];

  for (const result of results) {
    if (isErr(result)) {
      errors.push(...result[0]);
    } else {
      values.push(result[1]);
    }
  }

  if (errors.length > 0) {
    return [errors, null];
  }

  return [null, values as T];
}

export function ok<T>(result: T): [null, T] {
  return [null, result];
}

export function err<ErrorCode extends string>(
  code: ErrorCode,
  message: string
): [ResultError<ErrorCode>[], null] {
  return [
    [
      {
        code,
        message,
      },
    ],
    null,
  ];
}

export function onlyErr<ErrorCode extends string>(
  code: ErrorCode,
  message: string
): [[ResultError<ErrorCode>]] {
  return [
    [
      {
        code,
        message,
      },
    ],
  ];
}

/**
 * Handles different error codes with specific functions, stopping on the first fatal error.
 * @template ErrorCode - The type of error codes used in the result.
 * @template T - The type of the successful result value.
 * @template Handlers - The type of the handlers object, with a handler for each error code.
 * @param {MaybeResult<ErrorCode, T>} result - The result to handle.
 * @param {Handlers} handlers - An object with error handling functions for each error code.
 * @returns {boolean} True if a fatal error was encountered, false otherwise.
 *
 * @example
 * type MyErrorCode = 'NEGATIVE' | 'TOO_LARGE';
 *
 * interface SuccessResult {
 *   value: number;
 * }
 *
 * function someOperation(input: number): MaybeResult<MyErrorCode, SuccessResult> {
 *   if (input < 0) return err('NEGATIVE', 'Input is negative', { fatal: true });
 *   if (input > 100) return err('TOO_LARGE', 'Input is too large');
 *   return ok({ value: input });
 * }
 *
 * function processInput(input: number) {
 *   const result = someOperation(input);
 *
 *   if (onErr(result, {
 *     NEGATIVE(error) {
 *       console.log('Fatal error:', error.message);
 *       // This is a fatal error, so processing will stop here
 *     },
 *     TOO_LARGE(error) {
 *       console.log('Non-fatal error:', error.message);
 *       // This error is non-fatal, so processing will continue
 *     },
 *   })) {
 *     console.log('A fatal error occurred. Stopping process.');
 *     return;
 *   }
 *
 *   if (isOk(result)) {
 *     console.log('Operation successful, result:', result[1].value);
 *   }
 * }
 *
 * processInput(-5);  // Will log: "Fatal error: Input is negative" and "A fatal error occurred. Stopping process."
 * processInput(150); // Will log: "Non-fatal error: Input is too large" and "Operation completed with non-fatal errors."
 * processInput(25);  // Will log: "Another non-fatal error: Input is not even" and "Operation completed with non-fatal errors."
 * processInput(50);  // Will log: "Operation successful, result: 50"
 */
export function onErr<
  ErrorCode extends string,
  T extends UnknownObjectLike,
  Handlers extends Record<ErrorCode, (error: ResultError<ErrorCode>) => void>,
>(result: MaybeResult<ErrorCode, T>, handlers: Handlers): boolean {
  if (isErr(result)) {
    for (const error of result[0]) {
      handlers[error.code](error);
      if (error.fatal) {
        return true;
      }
    }
  }
  return false;
}

export type ResultType<T extends MaybeResult<any, any>> = T extends MaybeResult<
  any,
  infer R
>
  ? NonNullable<R>
  : never;

/**
 * A hybrid type that acts as both a single ResultError and an array containing that error.
 * Provides backward compatibility by allowing access to error properties directly
 * while maintaining array functionality.
 */
export type HybridResultError<ErrorCode extends string> =
  ResultError<ErrorCode> &
    [ResultError<ErrorCode>] & {
      readonly length: 1;
    };

export function resultError<ErrorCode extends string>(
  error: ResultError<ErrorCode>
): HybridResultError<ErrorCode> {
  return toHybridError([error]);
}

/**
 * Converts an array of ResultError to a hybrid object that acts as both
 * a single error and an array containing that error.
 *
 * @template ErrorCode - The type of error codes used in the result.
 * @param {ResultError<ErrorCode>[]} errors - The array of errors to convert.
 * @returns {HybridResultError<ErrorCode>} A hybrid object with both error properties and array methods.
 *
 * @example
 * const errors: ResultError<'NOT_FOUND'>[] = [{ code: 'NOT_FOUND', message: 'Item not found' }];
 * const hybrid = toHybridError(errors);
 *
 * // Access as single error
 * console.log(hybrid.code); // 'NOT_FOUND'
 * console.log(hybrid.message); // 'Item not found'
 *
 * // Access as array
 * console.log(hybrid.length); // 1
 * console.log(hybrid[0].code); // 'NOT_FOUND'
 * console.log(hybrid.map(e => e.code)); // ['NOT_FOUND']
 *
 * // Maintains backward compatibility
 * console.log(hybrid.code === hybrid[0].code); // true
 */
export function toHybridError<ErrorCode extends string>(
  errors: ResultError<ErrorCode>[]
): HybridResultError<ErrorCode> {
  if (errors.length === 0) {
    throw new Error('Cannot create hybrid error from empty array');
  }

  // Take the first error as the primary error
  const primaryError = errors[0];

  // Create an array with just the primary error
  const errorArray = [primaryError] as [ResultError<ErrorCode>];

  // Create the hybrid object by copying error properties to the array
  const hybrid = Object.assign(errorArray, {
    code: primaryError.code,
    message: primaryError.message,
    description: primaryError.description,
    fatal: primaryError.fatal,
    arg: primaryError.arg,
  }) as HybridResultError<ErrorCode>;

  // Ensure length is readonly and always 1
  Object.defineProperty(hybrid, 'length', {
    value: 1,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  return hybrid;
}
