import type { BucketConfig } from '../MentionsMenuController';

type Frontier = {
  bucketId: string;
  query: string;
  selectedIndex: number;
  itemCount: number;
};

/** Don't restart an exhausted scan just because its loading flag flips back.
 * A new selection, query, category or visible row count allows another request. */
export function createMentionPageLoader() {
  let lastRequested: Frontier | undefined;
  return (input: {
    bucket?: Pick<
      BucketConfig,
      'id' | 'hasMore' | 'isLoadingMore' | 'loadMore'
    >;
    query: string;
    selectedIndex: number;
    itemCount: number;
  }) => {
    const { bucket, query, selectedIndex, itemCount } = input;
    if (!bucket) {
      lastRequested = undefined;
      return;
    }
    if (
      selectedIndex < itemCount - 5 ||
      !bucket.hasMore?.() ||
      bucket.isLoadingMore?.()
    )
      return;
    if (
      lastRequested?.bucketId === bucket.id &&
      lastRequested.query === query &&
      lastRequested.selectedIndex === selectedIndex &&
      lastRequested.itemCount === itemCount
    )
      return;
    lastRequested = { bucketId: bucket.id, query, selectedIndex, itemCount };
    void bucket.loadMore?.();
  };
}
