/**
 * Normalized GraphQL cache — JS glue.
 * Design doc: apps/web/docs/graphql-normalized-cache-plan.md
 */

export {
  type CachedSelection,
  type CachedVariant,
  type InspectionSelection,
  inspect,
  inspectVariants,
  selectAll,
} from './exchange/inspection';
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
  update,
  upsertEmbeddedLink,
} from './exchange/optimistic';
export {
  type RecordSelection,
  readRecords,
  type SelectedRecordPage,
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
  EnqueueOptimisticMutationResult,
  InitialMutationClaim,
  MutationSettlement,
  OptimisticWriteResult,
  QueryVariableFilter,
  ReadRecordsArgs,
  ReadResult,
  RecordCursor,
  SelectedRecordPageWire,
  WriteResult,
} from './protocol';
export {
  MAX_RECORD_SELECTION_PAGE_SIZE,
  validateRecordSelectionLimit,
} from './protocol';
