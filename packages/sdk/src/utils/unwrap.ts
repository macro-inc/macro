/** Base for every error the SDK throws. */
export class MacroError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MacroError';
  }
}

/** A non-2xx HTTP response (Macro API, or a raw fetch like presigned downloads). */
export class MacroApiError extends MacroError {
  constructor(
    readonly status: number,
    readonly data: unknown,
  ) {
    super(`Macro API error ${status}`);
    this.name = 'MacroApiError';
  }
}

/** The API succeeded but the addressed entity doesn't exist in the result. */
export class MacroNotFoundError extends MacroError {
  constructor(message: string) {
    super(message);
    this.name = 'MacroNotFoundError';
  }
}

/**
 * Turn a hey-api `{ data, error, response? }` result into either the success
 * payload or a thrown MacroApiError.
 */
export function unwrap<TData, TError>(res: {
  data?: TData;
  error?: TError;
  response?: Response;
}): TData {
  if (res.error !== undefined)
    throw new MacroApiError(res.response?.status ?? 0, res.error);
  return res.data as TData;
}
