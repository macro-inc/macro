import { z } from 'zod';

/** The table and view a database link opens on. */
export const databaseDetailSearch = {
  namespace: 'database-detail',
  schema: z.object({ tableId: z.string(), viewId: z.string() }),
  defaults: { tableId: '', viewId: '' },
};

/** The plain query keys a database link carries (`webUrl()` on a table or view). */
export const DATABASE_LINK_PARAMS = ['tableId', 'viewId'];
