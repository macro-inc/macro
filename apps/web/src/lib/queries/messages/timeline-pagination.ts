import type { MessageCursor } from '@service-storage/messages';
import type {
  Query,
  QueryFunction,
  QueryFunctionContext,
  QueryKey,
} from '@tanstack/query-core';
import type { MessageTimelineData } from './timeline';

type PageParam = MessageTimelineData['pageParams'][number];

function isTimelineData(value: unknown): value is MessageTimelineData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pages' in value &&
    Array.isArray(value.pages) &&
    'pageParams' in value &&
    Array.isArray(value.pageParams)
  );
}

function sameCursor(
  left: MessageCursor | null | undefined,
  right: MessageCursor | null | undefined
) {
  return left?.id === right?.id && left?.created_at === right?.created_at;
}

function samePageParam(left: PageParam, right: PageParam) {
  if (left === null || right === null) return left === right;
  return (
    sameCursor(left.next_cursor, right.next_cursor) &&
    sameCursor(left.previous_cursor, right.previous_cursor)
  );
}

function rebasePagination<T extends MessageTimelineData>(
  fetched: T,
  before: MessageTimelineData,
  current: MessageTimelineData
): T {
  // A reset changed the slice this request was extending. Its cursor no longer
  // connects to the current cache, so leave that replacement intact.
  if (
    current.pages.length !== before.pages.length ||
    current.pageParams.some(
      (param, index) =>
        !samePageParam(param, before.pageParams[index]) ||
        !sameCursor(
          current.pages[index].next_cursor,
          before.pages[index].next_cursor
        ) ||
        !sameCursor(
          current.pages[index].previous_cursor,
          before.pages[index].previous_cursor
        )
    )
  ) {
    return { ...fetched, pages: current.pages, pageParams: current.pageParams };
  }

  // Cached IDs include removals since the request began. An overlapping server
  // page must neither resurrect those messages nor duplicate live arrivals.
  const seen = new Set(
    [...before.pages, ...current.pages].flatMap((page) =>
      page.items.map((message) => message.id)
    )
  );
  return {
    ...fetched,
    pages: fetched.pages.map((page, index) => {
      const cachedIndex = before.pageParams.findIndex((param) =>
        samePageParam(param, fetched.pageParams[index])
      );
      if (cachedIndex !== -1) return current.pages[cachedIndex];
      return {
        ...page,
        items: page.items.filter((message) => {
          if (seen.has(message.id)) return false;
          seen.add(message.id);
          return true;
        }),
      };
    }),
  };
}

/** Keep live cache writes when TanStack commits an assembled pagination result. */
export async function preserveLiveTimelinePages<
  T,
  TQueryKey extends QueryKey,
  TPageParam,
>(
  fetch: QueryFunction<T, TQueryKey, TPageParam>,
  context: QueryFunctionContext<TQueryKey>,
  query: Query
): Promise<T> {
  const before = query.state.data;
  const paginating = query.state.fetchMeta?.fetchMore !== undefined;
  // InfiniteQuery's persister wraps the whole fetch, which supplies its own
  // page contexts. The persister context itself intentionally has no pageParam.
  const fetched = await fetch(
    context as QueryFunctionContext<TQueryKey, TPageParam>
  );
  const current = query.state.data;
  if (
    !paginating ||
    current === before ||
    !isTimelineData(before) ||
    !isTimelineData(current) ||
    !isTimelineData(fetched)
  ) {
    return fetched;
  }
  return rebasePagination(fetched, before, current);
}
