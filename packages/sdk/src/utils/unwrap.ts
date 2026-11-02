/** Base for every error the SDK throws. */
export class MacroError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MacroError';
  }
}

/** A non-2xx HTTP response (Macro API, or a raw fetch like presigned downloads). */
export class MacroApiError extends MacroError {
  /** Parsed response body: a string, JSON object, or the raw client error. */
  readonly body: unknown;

  constructor(
    readonly status: number,
    readonly data: unknown,
  ) {
    super(formatApiError(status, data));
    this.name = 'MacroApiError';
    this.body = data;
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

function formatApiError(status: number, body: unknown): string {
  const detail = errorDetail(body);
  return detail
    ? `Macro API error ${status}: ${detail}`
    : `Macro API error ${status}`;
}

function errorDetail(body: unknown): string | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') {
    const trimmed = body.trim();
    return trimmed || undefined;
  }
  if (typeof body !== 'object') return String(body);
  if (Array.isArray(body)) {
    const parts = body
      .map((item) => errorDetail(item))
      .filter((part): part is string => part !== undefined);
    return parts.length > 0 ? parts.join('; ') : undefined;
  }
  const record = body as Record<string, unknown>;
  const field = firstString(record, ['field', 'loc', 'pointer', 'path']);
  const message = firstString(record, [
    'error',
    'message',
    'detail',
    'msg',
    'reason',
  ]);
  if (field && message) return `${field}: ${message}`;
  if (message) return message;
  if (field) return field;
  const keys = Object.keys(record);
  if (keys.length === 0) return undefined;
  try {
    return JSON.stringify(body);
  } catch {
    return undefined;
  }
}

function firstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const joined = value
        .filter(
          (item): item is string =>
            typeof item === 'string' && item.trim() !== '',
        )
        .join('.');
      if (joined) return joined;
    }
  }
  return undefined;
}
