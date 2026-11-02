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
    const reason = errorReason(data);
    super(
      reason
        ? `Macro API error ${status}: ${reason}`
        : `Macro API error ${status}`,
    );
    this.name = 'MacroApiError';
  }
}

/** The server's own explanation, when its error body carries one. */
function errorReason(data: unknown): string | undefined {
  if (typeof data === 'string') return data.trim() || undefined;
  if (typeof data === 'object' && data !== null && 'message' in data) {
    const { message } = data;
    if (typeof message === 'string') return message.trim() || undefined;
  }
  return undefined;
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
