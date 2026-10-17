import type { CacheHost } from '../../../graphql-cache/host/types';
import {
  type EntityFilterCacheArgs,
  type EntityFilterCacheResult,
  MAX_RECORD_SELECTION_PAGE_SIZE,
} from '../../../graphql-cache/protocol';

/** Ten full requests cover ~5,000 rows, as deep as anyone scrolls a list. */
export const MAX_MAIL_DEPTH_REQUESTS = 10;

export type MailRequest = Omit<EntityFilterCacheArgs, 'limit' | 'baseline'> & {
  mail: NonNullable<EntityFilterCacheArgs['mail']>;
};

/**
 * Reads a local Mail page `depth` rows deep, following the index's cursor in
 * requests the cache accepts. A write landing between requests ends the read
 * early at the earlier revision, which the caller then reads as stale and
 * evaluates again.
 */
export async function readMailDepth(
  host: Pick<CacheHost, 'entityFilter'>,
  request: MailRequest,
  depth: number
): Promise<{ result: EntityFilterCacheResult; requests: number }> {
  // The cache coordinator takes Mail requests of fewer than 500 rows.
  const pageSize = (wanted: number) =>
    Math.min(Math.max(wanted, 1), MAX_RECORD_SELECTION_PAGE_SIZE - 1);
  let page = await host.entityFilter({ ...request, limit: pageSize(depth) });
  let requests = 1;
  // Bounded: a page that adds no rows or repeats its cursor ends the read.
  while (
    page.kind === 'mail-page' &&
    page.keys.length < depth &&
    page.nextCursor &&
    requests < MAX_MAIL_DEPTH_REQUESTS
  ) {
    const next = await host.entityFilter({
      ...request,
      limit: pageSize(depth - page.keys.length),
      mail: { ...request.mail, cursor: page.nextCursor },
    });
    requests += 1;
    if (
      next.kind !== 'mail-page' ||
      next.revision !== page.revision ||
      next.keys.length === 0 ||
      next.nextCursor === page.nextCursor
    )
      break;
    page = {
      ...next,
      keys: [...page.keys, ...next.keys],
      sortTimestamps: [...page.sortTimestamps, ...next.sortTimestamps],
    };
  }
  return { result: page, requests };
}
