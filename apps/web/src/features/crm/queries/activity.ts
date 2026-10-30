import type { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import {
  EMPTY_TAG_FACET_CONTEXT,
  type TagFacetContext,
  tagFacetReady,
} from '../../soup';
import type { CrmActivityViewState } from '../core/activity-view';
import type { CrmSoupActivityTab } from '../core/navigation';
import { buildCrmActivityQuery } from './activity-options';

/** A bounded query for the complete authorized CRM activity feed. */
export function useCrmActivityQuery(
  createQuery: typeof useSoupAstItemsQuery,
  tab: Accessor<CrmSoupActivityTab>,
  userId: Accessor<string | undefined>,
  options?: Accessor<CrmActivityViewState>,
  facetContext: Accessor<TagFacetContext> = () => EMPTY_TAG_FACET_CONTEXT,
  tagsReady: Accessor<boolean> = () => true
) {
  return createQuery(
    () => buildCrmActivityQuery(tab(), options?.(), facetContext()),
    () => ({
      enabled:
        !!userId() && tagFacetReady(options?.().facets ?? {}, tagsReady()),
    })
  );
}
