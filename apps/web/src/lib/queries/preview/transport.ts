import { graphqlCacheEnabled } from '@service-storage/graphql-soup';
import { fetchRestPreviewBatch } from './fetchers';
import { fetchGraphqlPreviewBatch } from './graphql';
import type { ItemEntity, PreviewItem } from './types';

/** Fetches previews through GraphQL when enabled, preserving the REST fallback. */
export async function fetchPreviewBatch(
  items: ItemEntity[]
): Promise<Map<string, PreviewItem>> {
  if (graphqlCacheEnabled()) return fetchGraphqlPreviewBatch(items);
  return fetchRestPreviewBatch(items);
}
