import { createQueryNormalizer } from '@normy/query-core';
import type { QueryClient } from '@tanstack/solid-query';

export type NormalizerData = Parameters<
  ReturnType<typeof createQueryNormalizer>['setNormalizedData']
>[0];

/**
 * Extracts a normalization key from SoupApiItem wrappers.
 * Only objects with `tag + data + frecency_score` are normalized.
 */
export const getNormalizationObjectKey = (
  obj: Record<string, unknown>
): string | undefined => {
  if ('tag' in obj && 'data' in obj && 'frecency_score' in obj) {
    const data = obj.data as Record<string, unknown>;
    if (obj.tag === 'channel') {
      const channel = data?.channel as Record<string, unknown> | undefined;
      return channel?.id ? `soup:${channel.id}` : undefined;
    }
    return data?.id ? `soup:${data.id}` : undefined;
  }
  return undefined;
};

let _normalizer: ReturnType<typeof createQueryNormalizer> | undefined;

export function getSoupNormalizer(): ReturnType<typeof createQueryNormalizer> {
  if (!_normalizer) {
    throw new Error(
      'soupNormalizer not initialized — call initSoupNormalizer() first'
    );
  }
  return _normalizer;
}

/**
 * Create and subscribe the normalizer. Call once at app startup.
 * Accepts queryClient as a parameter to avoid circular imports.
 */
export function initSoupNormalizer(qc: QueryClient): () => void {
  _normalizer = createQueryNormalizer(qc, {
    getNormalizationObjectKey,
    normalize: false,
  });
  _normalizer.subscribe();
  return () => _normalizer!.unsubscribe();
}
