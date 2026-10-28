/**
 * Normalized GraphQL cache — JS glue.
 * Design doc: apps/web/docs/graphql-normalized-cache-plan.md
 *
 * The reactive document query, `createLiveQuery`, is imported from
 * `./solid/create-live-query`; it is not re-exported here.
 */

export {
  compileEntityResolvers,
  type EntityFromArgumentDescriptor,
  type EntityResolverConfig,
  type EntityResolverWire,
  entityFromArgument,
} from './exchange/entity-resolvers';
export {
  type CachedSelection,
  type CachedVariant,
  type InspectionSelection,
  inspect,
  inspectVariants,
  selectAll,
} from './exchange/inspection';
export {
  type NormalizedCacheResultMetadata,
  normalizedCacheResultMetadata,
} from './exchange/normalized-cache-exchange';
export {
  executeOptimisticMutation,
  type LinkDiff,
  type ListSelection,
  type OptimisticMutationDisposition,
  type OptimisticMutationOptions,
  type OptimisticUpdate,
  optimisticMutationDispositionOf,
  prependUnique,
  type QueryRevalidation,
  remove,
  removeEmbeddedLink,
  type Selection,
  select,
  selectRecord,
  update,
  upsertByField,
  upsertEmbeddedLink,
} from './exchange/optimistic';
export {
  type RecordSelection,
  readRecordsByKeys,
  selectRecords,
} from './exchange/record-selection';
export { createTauriCacheHost } from './host/tauri-host';
export type {
  CacheHost,
  CacheReadArgs,
  CacheWriteArgs,
  InspectQueryArgs,
  InspectQueryVariantsArgs,
} from './host/types';
export { createWorkerCacheHost } from './host/worker-host';
export type {
  CachedQueryInstanceWire,
  CachedQueryVariantWire,
  CachePush,
  CacheReadPriority,
  CacheRequest,
  CacheResponse,
  CacheRevision,
  CalendarCommitArgs,
  CalendarCommitCacheResult,
  CalendarFreshness,
  CalendarLinkWatermarkWire,
  CalendarRangeCacheArgs,
  CalendarRangeCacheResult,
  CalendarSpanKind,
  CalendarSpanWire,
  CalendarWatermarkUpdateWire,
  EnqueueOptimisticMutationResult,
  EntityFilterCacheArgs,
  EntityFilterCacheResult,
  InitialMutationClaim,
  MutationSettlement,
  OptimisticWriteResult,
  QueryVariableFilter,
  ReadRecordsByKeysArgs,
  ReadRecordsByKeysResult,
  ReadResult,
  SearchCacheArgs,
  SearchCachePage,
  SearchCursor,
  SearchDocumentWire,
  SearchProfile,
  SelectedRecordByKeyWire,
  WriteResult,
} from './protocol';
export {
  INITIAL_CACHE_REVISION,
  MAX_CACHE_SEARCH_QUERY_BYTES,
  MAX_RECORD_SELECTION_PAGE_SIZE,
  validateCacheSearchArgs,
  validateRecordSelectionKeys,
} from './protocol';
