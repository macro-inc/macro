import { queryClient } from '@queries/client';
import { refreshActiveGraphqlPreviewQueries } from '@queries/preview/active-queries';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { setEntityAppearance } from '@service-storage/entity-appearance';
import {
  acknowledgeGraphqlRestWrite,
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import { refreshProjectQueries } from '../projects/queries/project-revalidation';
import { createSaveEntityAppearance } from './queries/appearance';

/** Lazy production wiring; the editor and query adapter accept explicit capabilities. */
export const saveEntityAppearance = createSaveEntityAppearance({
  queryClient,
  cacheHost: getGraphqlCacheHost,
  update: setEntityAppearance,
  acknowledgeWrite: acknowledgeGraphqlRestWrite,
  refreshUncached: async (entity) => {
    await Promise.all([
      refreshActiveGraphqlSoupQueries({ throwOnError: true }),
      refreshActiveGraphqlPreviewQueries(entity.id),
      ...(entity.type === 'initiative'
        ? [refreshProjectQueries(getGraphqlSoupClient())]
        : []),
    ]);
  },
});
