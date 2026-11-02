import { match, P } from 'ts-pattern';

/** Base for every error the SDK throws. */
export class MacroError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MacroError';
  }
}

/** Longest server explanation copied into an error message. */
const MAX_DETAIL_LENGTH = 500;

/** The server's explanation in an error body: its text, `message` or `error`. */
function errorDetail(data: unknown): string {
  const detail = match(data)
    .with(P.string, (text) => text)
    .with({ message: P.string }, ({ message }) => message)
    .with({ error: P.string }, ({ error }) => error)
    .otherwise(() => '')
    .trim();
  return detail.length > MAX_DETAIL_LENGTH
    ? `${detail.slice(0, MAX_DETAIL_LENGTH)}…`
    : detail;
}

/**
 * A non-2xx HTTP response (Macro API, or a raw fetch like presigned downloads).
 * The message includes the server's explanation, such as a validation error,
 * and `data` holds the parsed error body.
 */
export class MacroApiError extends MacroError {
  constructor(
    readonly status: number,
    readonly data: unknown,
  ) {
    const detail = errorDetail(data);
    super(
      detail
        ? `Macro API error ${status}: ${detail}`
        : `Macro API error ${status}`,
    );
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
