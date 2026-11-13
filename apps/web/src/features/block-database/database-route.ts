import { z } from 'zod';

/** The table and view a database link opens on. */
export const databaseDetailSearch = {
  namespace: 'database-detail',
  schema: z.object({ tableId: z.string(), viewId: z.string() }),
  defaults: { tableId: '', viewId: '' },
};
