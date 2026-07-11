import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_TAGS_SEARCH_FE_FLAG,
  ENABLE_TAGS_SEARCH_FE_OVERRIDE,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Rollout gate for the search-view tag surfaces (tag facet + row chips),
 * layered on top of enable-tags-fe so tagging elsewhere can ship while the
 * search view stays dark until its index backfills complete.
 */
export function useSearchTagsFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(ENABLE_TAGS_SEARCH_FE_FLAG, {
    enabledOverride: ENABLE_TAGS_SEARCH_FE_OVERRIDE,
  });
  return () => flag().enabled;
}

/**
 * Whether tag chips may render on list rows in the current split. Rows in
 * the search view follow the rollout gate, rows everywhere else always may.
 */
export function useRowTagsVisible(): Accessor<boolean> {
  const panel = useSplitPanel();
  const searchTags = useSearchTagsFlag();
  return () => {
    const content = panel?.handle.content();
    const inSearchView =
      content?.type === 'component' && content.id === 'search';
    return !inSearchView || searchTags();
  };
}
