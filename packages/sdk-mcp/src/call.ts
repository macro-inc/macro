import { match, P } from 'ts-pattern';
import type { Macro } from '../../sdk/src/macro';
import { MacroApiError, MacroError } from '../../sdk/src/utils/unwrap';
import type { Catalog, Operation, PathStep } from './catalog';
import { DEFAULT_MAX_ITEMS, MAX_ITEMS_INPUT } from './tools';
import { HandleInput, type InputValidators } from './validate';

/** Why an operation failed, as the caller sees it. */
export type ErrorCode =
  | 'invalid'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'rate_limited'
  | 'internal';

/** An operation's outcome, shaped as MCP's `CallToolResult`. */
export type OperationResult = {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: true;
};

/** Each handle class's constructor, by name (the generated `handleClasses`). */
export type HandleClasses = Readonly<Record<string, object>>;

/** Deepest nesting a result keeps; deeper values are cut. */
const MAX_DEPTH = 32;

export class OperationError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'OperationError';
  }
}

function invoke(
  target: object,
  name: string,
  args: readonly unknown[]
): unknown {
  const method: unknown = Reflect.get(target, name);
  if (typeof method !== 'function')
    throw new OperationError('internal', `${name} is not callable`);
  const result: unknown = Reflect.apply(method, target, args);
  return result;
}

function asObject(value: unknown, what: string): object {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  )
    throw new OperationError('internal', `${what} is not an object`);
  return value;
}

/** Replace every {@link HandleInput} in a parsed input with its handle. */
function mint(
  value: unknown,
  client: object,
  classes: HandleClasses,
  catalog: Catalog
): unknown {
  if (value instanceof HandleInput) {
    const reference = catalog.handles[value.className];
    const handleClass = classes[value.className];
    if (reference?.kind !== 'byId' || !handleClass)
      throw new OperationError('internal', `can't mint ${value.className}`);
    const args = reference.parameters.map((parameter) =>
      parameter.client
        ? client
        : mint(value.arguments_[parameter.name], client, classes, catalog)
    );
    return invoke(handleClass, 'byId', args);
  }
  if (Array.isArray(value))
    return value.map((item) => mint(item, client, classes, catalog));
  if (value instanceof Date || typeof value !== 'object' || value === null)
    return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      mint(item, client, classes, catalog),
    ])
  );
}

async function follow(
  start: object,
  path: readonly PathStep[]
): Promise<object> {
  let current = start;
  for (const step of path) {
    const next: unknown = step.call
      ? await invoke(current, step.name, [])
      : Reflect.get(current, step.name);
    current = asObject(next, step.name);
  }
  return current;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' && value !== null && Symbol.asyncIterator in value
  );
}

async function collect(iterable: AsyncIterable<unknown>, limit: number) {
  const items: unknown[] = [];
  if (limit <= 0) return items;
  for await (const item of iterable) {
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}

/**
 * A JSON-safe copy of a result. Handles serialize through their `toJSON`
 * (identity and loaded detail, never their client); any other class
 * instance is reduced to its class name so nothing authenticated leaks.
 */
export function toJsonSafe(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol')
    return undefined;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((item) => toJsonSafe(item, depth + 1) ?? null);
  const toJSON: unknown = Reflect.get(value, 'toJSON');
  if (typeof toJSON === 'function') {
    const serialized: unknown = Reflect.apply(toJSON, value, []);
    return serialized === value ? {} : toJsonSafe(serialized, depth + 1);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    return { class: value.constructor.name };
  const entries = Object.entries(value).flatMap(([key, item]) => {
    const safe = toJsonSafe(item, depth + 1);
    return safe === undefined ? [] : [[key, safe] as const];
  });
  return Object.fromEntries(entries);
}

/** Optional URL enrichment must not turn a completed operation into an error. */
async function webUrl(value: unknown): Promise<string | undefined> {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    const method: unknown = Reflect.get(value, 'webUrl');
    if (typeof method !== 'function') return undefined;
    const url: unknown = await Reflect.apply(method, value, []);
    return typeof url === 'string' ? url : undefined;
  } catch {
    return undefined;
  }
}

function summary(
  operation: Operation,
  result: unknown,
  url: string | undefined
) {
  const outcome = match(result)
    .with(P.nullish, () => 'done')
    .with(
      P.array(),
      (items) => `${items.length} item${items.length === 1 ? '' : 's'}`
    )
    .otherwise(() => 'ok');
  return `${operation.name}: ${outcome}${url ? ` (${url})` : ''}`;
}

/** The caller-facing code and message for an error an operation threw. */
export function describeError(error: unknown): {
  code: ErrorCode;
  message: string;
} {
  if (error instanceof OperationError)
    return { code: error.code, message: error.message };
  if (error instanceof MacroApiError) {
    const code = match(error.status)
      .returnType<ErrorCode>()
      .with(400, 422, () => 'invalid')
      .with(401, 403, () => 'forbidden')
      .with(404, 410, () => 'not_found')
      .with(409, 412, () => 'conflict')
      .with(429, () => 'rate_limited')
      .otherwise(() => 'internal');
    // A 5xx body can describe server internals; a 4xx explains the request.
    const message =
      error.status >= 500 ? `Macro API error ${error.status}` : error.message;
    return { code, message };
  }
  if (error instanceof MacroError)
    return {
      code: error.name === 'MacroNotFoundError' ? 'not_found' : 'invalid',
      message: error.message,
    };
  return { code: 'internal', message: 'The operation failed unexpectedly.' };
}

export function errorResult(error: unknown): OperationResult {
  const { code, message } = describeError(error);
  return {
    content: [{ type: 'text', text: `${code}: ${message}` }],
    structuredContent: { error: { code, message } },
    isError: true,
  };
}

/**
 * Validate an operation's input, mint the handles it names, run the SDK
 * method and shape its result. Errors become `isError` results.
 */
export async function runOperation(options: {
  operation: Operation;
  input: Readonly<Record<string, unknown>>;
  macro: Macro;
  catalog: Catalog;
  classes: HandleClasses;
  validators: InputValidators;
}): Promise<OperationResult> {
  const { operation, input, macro, catalog, classes, validators } = options;
  try {
    const parsed = validators.operation(operation).safeParse(input);
    if (!parsed.success)
      throw new OperationError(
        'invalid',
        parsed.error.issues
          .map(
            (issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`
          )
          .join('; ')
      );
    const values = asObject(
      mint(parsed.data, macro._client, classes, catalog),
      'input'
    );

    const target =
      operation.receiver.kind === 'handle'
        ? asObject(Reflect.get(values, operation.receiver.property), 'target')
        : macro;
    const receiver = await follow(target, operation.receiver.path);
    const args = operation.parameters.flatMap((parameter) => {
      const value: unknown = Reflect.get(values, parameter.name);
      if (!parameter.rest) return [value];
      return Array.isArray(value) ? value : [];
    });
    // Drop trailing omitted optionals so defaults apply.
    while (args.length && args.at(-1) === undefined) args.pop();

    const returned: unknown = await invoke(receiver, operation.method, args);
    const maxItems: unknown = Reflect.get(values, MAX_ITEMS_INPUT);
    const result = isAsyncIterable(returned)
      ? await collect(
          returned,
          typeof maxItems === 'number' ? maxItems : DEFAULT_MAX_ITEMS
        )
      : returned;

    const url =
      operation.receiver.kind === 'handle'
        ? await webUrl(target)
        : await webUrl(result);
    return {
      content: [{ type: 'text', text: summary(operation, result, url) }],
      structuredContent: {
        result: toJsonSafe(result) ?? null,
        ...(url ? { url } : {}),
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}
