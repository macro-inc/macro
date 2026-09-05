export { groupedCacheVersion } from './grouped-operations';
export { initSoupNormalizer } from './normalizer';
export {
  bumpSoupEntityNotifiedAt,
  bumpSoupEntityTouchedAt,
  getSoupEntityById,
  hasSoupEntity,
  invalidateAllSoup,
  invalidateSoupEntity,
  invalidateSoupQueriesReferencing,
  optimisticUpdateSoupEntity,
  optimisticUpdateSoupItemUpdatedAt,
  optimisticUpdateSoupItemViewedAt,
  refetchSoupEntity,
  removeSearchEntities,
  removeSoupEntities,
  removeSoupEntitiesFromDoneFilteredQueries,
  removeSoupEntitiesFromQueriesReferencing,
  restoreSoupEntityToDoneFilteredQueries,
} from './operations';
export type {
  SoupEntityTag,
  SoupTransaction,
} from './types';
