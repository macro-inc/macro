import type { SplitReference } from '@app/lib/split-router';
import { z } from 'zod';

/** The table and view a database link opens on. */
export const databaseDetailSearch = {
  namespace: 'database-detail',
  schema: z.object({ tableId: z.string(), viewId: z.string() }),
  defaults: { tableId: '', viewId: '' },
};

/** The plain query keys a database link carries (`webUrl()` on a table or view). */
export const DATABASE_LINK_PARAMS = ['tableId', 'viewId'];

/**
 * A database link opened inside the app (an agent reply, a mention) carries
 * its table and view as block params. They stay off the route's external
 * keys, which would keep them in the URL and reopen the link on every reload.
 */
export function withDatabaseLinkParams(
  reference: SplitReference | undefined,
  query: URLSearchParams
): SplitReference | undefined {
  if (reference?.type !== 'database') return reference;
  const params = Object.fromEntries(
    DATABASE_LINK_PARAMS.flatMap((key) => {
      const value = query.get(key);
      return value ? [[key, value]] : [];
    })
  );
  return Object.keys(params).length ? { ...reference, params } : reference;
}
