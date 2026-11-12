import { fireAndForget } from '@core/util/fireAndForget';
import type { BucketConfig } from '../MentionsMenuController';

type Frontier = {
  bucketId: string;
  query: string;
  selectedIndex: number;
  itemCount: number;
  windowKey?: string;
};

/** Don't restart an exhausted scan just because its loading flag flips back.
 * A new selection, query, category or visible row count allows another request. */
export function createMentionPageLoader() {
  let lastRequested: Frontier | undefined;
  return (input: {
    bucket?: Pick<
      BucketConfig,
      'id' | 'hasMore' | 'isLoadingMore' | 'loadMore' | 'windowKey'
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
      itemCount === 0 &&
      lastRequested?.itemCount === 0 &&
      lastRequested.bucketId === bucket.id &&
      lastRequested.query === query
    )
      return;
    if (
      lastRequested?.bucketId === bucket.id &&
      lastRequested.query === query &&
      lastRequested.selectedIndex === selectedIndex &&
      lastRequested.itemCount === itemCount &&
      lastRequested.windowKey === bucket.windowKey?.()
    )
      return;
    lastRequested = {
      bucketId: bucket.id,
      query,
      selectedIndex,
      itemCount,
      windowKey: bucket.windowKey?.(),
    };
    fireAndForget(bucket.loadMore?.(), 'mentions-menu');
  };
}
