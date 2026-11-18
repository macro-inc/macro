import { rejectUnknownOptions } from './options';
import { MacroError } from './unwrap';

/** One page of a cursor-paginated list. */
export interface Page<T, Cursor = string> {
  items: T[];
  nextCursor?: Cursor | null;
}

/**
 * Async generator over a cursor-paginated API. Iterate with `for await`.
 * Cursors are plain JSON values (strings or small objects), so a page whose
 * next cursor serialises identically to the one it was fetched with means the
 * server is not advancing; the generator throws instead of looping forever.
 */
export async function* paginate<T, Cursor = string>(
  fetchPage: (cursor?: Cursor) => Promise<Page<T, Cursor>>,
): AsyncGenerator<T> {
  let cursor: Cursor | undefined;
  do {
    const page = await fetchPage(cursor);
    const nextCursor = page.nextCursor ?? undefined;
    if (
      cursor !== undefined &&
      nextCursor !== undefined &&
      JSON.stringify(nextCursor) === JSON.stringify(cursor)
    ) {
      throw new Error('Pagination cursor did not advance');
    }
    yield* page.items;
    cursor = nextCursor;
  } while (cursor !== undefined);
}

/** The option every auto-paginating iterator takes. */
export interface IterationOptions {
  /**
   * Yield at most this many items in all, then stop without fetching another
   * page. A page size (`pageSize`, or `limit` where an iterator calls it that)
   * sets only how many items one request returns.
   */
  maxItems?: number;
}

/**
 * An auto-paginating iterator's public entry: rejects options it does not
 * take (code-mode programs are untyped, so a wrong key would be dropped
 * silently), checks `maxItems`, and yields at most that many items from
 * `source`. Throws at the call, before any request.
 */
export function iterate<T, Options extends IterationOptions>(
  method: string,
  options: Options | undefined,
  allowed: Record<Exclude<keyof Options, 'maxItems'>, true>,
  source: () => AsyncIterable<T>,
): AsyncGenerator<T> {
  const given = options ?? ({} as Options);
  rejectUnknownOptions(method, given, {
    ...allowed,
    maxItems: true,
  } as Record<keyof Options, true>);
  const { maxItems } = given;
  if (maxItems !== undefined && !(Number.isInteger(maxItems) && maxItems > 0))
    throw new MacroError(
      `${method}: \`maxItems\` must be a positive whole number, not ${maxItems}.`,
    );
  return upTo(source(), maxItems);
}

async function* upTo<T>(
  items: AsyncIterable<T>,
  maxItems: number | undefined,
): AsyncGenerator<T> {
  if (maxItems === undefined) {
    yield* items;
    return;
  }
  let yielded = 0;
  for await (const item of items) {
    yield item;
    if (++yielded >= maxItems) return;
  }
}
