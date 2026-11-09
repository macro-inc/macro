import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { clause, compileClause, confine } from '@app/features/soup/filters';
import type { NotificationSource } from '@notifications';
import {
  type SoupApiItemFilter,
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from '@queries/soup/transform-utils';
import type { Accessor } from 'solid-js';
import type { ArtifactListSource } from '../context/artifact-source';
import { ARTIFACT_FILE_TYPES, isArtifact } from '../core/artifact';

/**
 * Every HTML document the viewer can access, newest first. Email
 * attachments stay out, as in Drive's default listing: nobody added them.
 */
export function artifactsQuery(): SoupAstItemsQueryArgs {
  return {
    params: { sort_method: 'updated_at', limit: 100 },
    body: compileClause(
      confine({
        df: clause.and(
          clause.or(
            ...ARTIFACT_FILE_TYPES.map((type) => clause.eq('fileType', type))
          ),
          clause.eq('isEmailAttachment', false)
        ),
      })
    ),
  };
}

// Cached query meta outlives the view, so the gate lives at module scope.
const ARTIFACT_ITEM_FILTER: SoupApiItemFilter = (item) =>
  isDisplayableSoupItem(item) && isArtifact(mapApiSoupItemToEntity(item));

/** The Artifacts list over the shared Soup items query. */
export function createArtifactListSource(
  userId: Accessor<string | undefined>,
  notifications: NotificationSource
): ArtifactListSource {
  const query = useSoupAstItemsQuery(artifactsQuery, () => ({
    enabled: Boolean(userId()),
    meta: { itemFilter: ARTIFACT_ITEM_FILTER },
  }));

  return {
    // A pending first page's data read would suspend the list.
    documents: () =>
      (query.isPending ? [] : (query.data?.entities ?? [])).map((entity) =>
        withEntityNotifications(entity, notifications)
      ),
    loading: () => query.isPending && query.isEnabled,
    failed: () => Boolean(query.error) && !query.isFetchNextPageError,
    hasMore: () => query.hasNextPage,
    loadingMore: () => query.isFetchingNextPage,
    loadMoreFailed: () => query.isFetchNextPageError,
    loadMore: () => query.fetchNextPage(),
    retry: () => query.refetch(),
  };
}
