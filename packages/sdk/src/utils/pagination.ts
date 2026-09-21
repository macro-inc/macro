/** One page of a cursor-paginated list. */
export interface Page<T, Cursor = string> {
  items: T[];
  nextCursor?: Cursor | null;
}

/** Async generator over a cursor-paginated API. Iterate with `for await`. */
export async function* paginate<T, Cursor = string>(
  fetchPage: (cursor?: Cursor) => Promise<Page<T, Cursor>>,
): AsyncGenerator<T> {
  let cursor: Cursor | undefined;
  do {
    const page = await fetchPage(cursor);
    yield* page.items;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}
