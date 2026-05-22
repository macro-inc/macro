import { createQueryNormalizer } from '@normy/query-core';
import type { QueryClient } from '@tanstack/solid-query';

export type NormalizerData = Parameters<
  ReturnType<typeof createQueryNormalizer>['setNormalizedData']
>[0];

export const SOUP_NORM_PREFIX = 'soup:';

export function soupNormKey(id: string): string {
  return `${SOUP_NORM_PREFIX}${id}`;
}

export function stripSoupNormPrefix(normKey: string): string {
  return normKey.slice(SOUP_NORM_PREFIX.length);
}

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
      return channel?.id ? soupNormKey(channel.id as string) : undefined;
    }
    return data?.id ? soupNormKey(data.id as string) : undefined;
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
