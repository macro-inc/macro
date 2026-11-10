import { type TagFacetContext, tagFacetReady } from '@app/features/soup';
import { queryReadyGate } from '@queries/gate';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';
import {
  materializeEmailSavedView,
  readEmailSavedView,
  resolveEmailSavedViewScope,
} from '../filters/email-saved-view';
import { buildEmailQuery } from './email-query';

/** Enough to see one unread thread past a few just read on this device. */
const UNREAD_PROBE_LIMIT = 20;

/**
 * Whether a view's first unread page has an unread thread: presence, never a
 * total or a pagination loop, like the navigation badges.
 */
export function useEmailSavedViewUnread(options: {
  config: Accessor<unknown>;
  tagContext: Accessor<TagFacetContext>;
  tagSetsReady: Accessor<boolean>;
}): Accessor<boolean> {
  const view = createMemo(() =>
    materializeEmailSavedView(readEmailSavedView(options.config()).config)
  );
  const showsOnlyRead = () => view().facets.read?.includes('read') ?? false;
  const facets = () => ({ ...view().facets, read: ['unread'] });
  const enabled = () =>
    !showsOnlyRead() && tagFacetReady(facets(), options.tagSetsReady());
  const query = useSoupAstItemsQuery(
    () => {
      const args = buildEmailQuery({
        tab: 'all',
        inboxIds: view().inboxIds,
        facets: facets(),
        facetContext: {
          tagPropertyDefinitionByOptionId: new Map([
            ...options.tagContext().tagPropertyDefinitionByOptionId,
            ...view().tagBindings,
          ]),
        },
        savedView: resolveEmailSavedViewScope(view().conditions, new Date()),
      });
      return { ...args, params: { ...args.params, limit: UNREAD_PROBE_LIMIT } };
    },
    () => ({ enabled: enabled() })
  );
  // Re-check cached rows: a thread read here can stay in the fetched page.
  return createMemo(() => {
    if (!enabled() || !queryReadyGate(query)) return false;
    return query.data.entities.some(
      (entity) => entity.type === 'email' && !entity.isRead
    );
  });
}
