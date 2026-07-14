export { groupedCacheVersion } from './grouped-operations';
export { initSoupNormalizer } from './normalizer';
export {
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
  removeSoupEntitiesFromQueriesReferencing,
} from './operations';
export type {
  SoupEntityTag,
  SoupTransaction,
} from './types';
