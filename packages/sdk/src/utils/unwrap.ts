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
 * A 422 explains a request body in the API's snake_case field names, while
 * the SDK's options are camelCase (`dataType` for `data_type`). Name the SDK
 * option for each field it mentions, so a caller fixes the option it passed.
 */
function sdkOptionNames(detail: string): string {
  const fields = [
    ...new Set(detail.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)),
  ];
  if (fields.length === 0) return '';
  const names = fields.map(
    (field) =>
      `\`${field}\` is \`${field.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())}\``,
  );
  return ` (in SDK options, ${names.join(', ')}; read the method's reference for the shape each takes)`;
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
    const names = status === 422 ? sdkOptionNames(detail) : '';
    super(
      detail
        ? `Macro API error ${status}: ${detail}${names}`
        : `Macro API error ${status}`,
    );
    this.name = 'MacroApiError';
  }
}

/**
 * A 403: the caller lacks the access the request needs. Most often the user
 * can view the item but not edit it.
 *
 * Agents: tell the user they can only view the item and offer to ask its owner
 * for edit access. Request it only with the user's go-ahead, by calling
 * `access.request('edit')` on the item (for example
 * `macro.initiatives.byId(id).access.request('edit')`); never request access
 * on your own. The request grants nothing: report that it is pending and who
 * reviews it (`access.state()` returns the `owner`), and do not claim the
 * write succeeded. Check `access.state()` later and retry the write only once
 * `accessLevel` allows it.
 *
 * The server does not say which item refused the write. A write that touches
 * two items, such as setting a task's Project (or another property that
 * references an item), needs edit access to both: read `access.state()` on
 * each and request access on the one whose `accessLevel` is below `edit`.
 */
export class MacroForbiddenError extends MacroApiError {
  constructor(data: unknown) {
    super(403, data);
    this.name = 'MacroForbiddenError';
  }
}

/** The API error class for an HTTP status. */
function apiError(status: number, data: unknown): MacroApiError {
  return status === 403
    ? new MacroForbiddenError(data)
    : new MacroApiError(status, data);
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
 * payload or a thrown MacroApiError (MacroForbiddenError for a 403).
 */
export function unwrap<TData, TError>(res: {
  data?: TData;
  error?: TError;
  response?: Response;
}): TData {
  if (res.error !== undefined)
    throw apiError(res.response?.status ?? 0, res.error);
  return res.data as TData;
}
