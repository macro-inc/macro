/**
 * Normalized GraphQL cache — JS glue.
 * Design doc: apps/web/docs/graphql-normalized-cache-plan.md
 */

export {
  type CachedSelection,
  type InspectionSelection,
  inspect,
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
  type Selection,
  select,
  update,
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
} from './host/types';
export { createWorkerCacheHost } from './host/worker-host';
export type {
  CachedQueryInstanceWire,
  CachePush,
  CacheRequest,
  CacheResponse,
  MutationSettlement,
  OptimisticWriteResult,
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
