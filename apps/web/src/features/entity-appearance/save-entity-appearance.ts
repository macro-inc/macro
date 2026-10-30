import { queryClient } from '@queries/client';
import { setEntityAppearance } from '@service-storage/entity-appearance';
import { getGraphqlCacheHost } from '@service-storage/graphql-soup';
import { createSaveEntityAppearance } from './queries/appearance';

/** Lazy production wiring; the editor and query adapter accept explicit capabilities. */
export const saveEntityAppearance = createSaveEntityAppearance({
  queryClient,
  cacheHost: getGraphqlCacheHost,
  update: setEntityAppearance,
});
