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
