/** One page of a cursor-paginated list. */
export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
}

/** Async generator over a cursor-paginated API. Iterate with `for await`. */
export async function* paginate<T>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
): AsyncGenerator<T> {
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    yield* page.items;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}
