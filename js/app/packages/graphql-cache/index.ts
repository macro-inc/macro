/**
 * Normalized GraphQL cache — JS glue.
 * Design doc: js/app/docs/graphql-normalized-cache-plan.md
 */

export type {
  CacheHost,
  CacheReadArgs,
  CacheWriteArgs,
} from './host/types';
export { createWorkerCacheHost } from './host/worker-host';
export type {
  CacheBroadcast,
  CachePush,
  CacheRequest,
  CacheResponse,
  ReadResult,
  WriteResult,
} from './protocol';
