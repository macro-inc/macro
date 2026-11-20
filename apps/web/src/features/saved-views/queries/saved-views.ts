import { createUrqlInfiniteQuery } from '@app/lib/urql-solid/create-urql-infinite-query';
import { fireAndForget } from '@core/util/fireAndForget';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import {
  SavedViewDocument,
  type SavedViewFieldsFragment,
  SavedViewsDocument,
  type SavedViewsQuery,
  type SavedViewsQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
} from 'solid-js';
import { unwrap } from 'solid-js/store';
import { readEntityAppearance } from '../../entity-appearance/core/appearance';
import { usePendingEntityAppearance } from '../../entity-appearance/queries/pending-appearance';
import type {
  SavedViewSource,
  SavedViewsSource,
} from '../context/saved-views-source';
import type { SavedView } from '../core/saved-view';
import { registerSavedViewReader } from './active-queries';
import { refreshOnSavedViewChanges } from './saved-view-changes';

export function toSavedView(view: SavedViewFieldsFragment): SavedView {
  return {
    id: view.id,
    ownerId: view.ownerId,
    name: view.name,
    config: structuredClone(unwrap(view.config)),
    sharedTeamId: view.sharedTeamId ?? null,
    revision: view.revision,
    appearance: readEntityAppearance(view.appearance),
  };
}

/**
 * Revalidate server-side access when returning to a view or changing accounts,
 * and re-read when views of `kind` (any kind when omitted) change elsewhere.
 */
function revalidateSavedViewQuery(
  viewerId: Accessor<string | undefined>,
  refresh: () => Promise<unknown>,
  kind?: string
) {
  refreshOnSavedViewChanges(kind, refresh);
  let lastViewer = viewerId();
  createEffect(
    on(viewerId, (viewer) => {
      if (!viewer) return;
      if (lastViewer && lastViewer !== viewer)
        fireAndForget(refresh(), 'saved-views');
      lastViewer = viewer;
    })
  );
  onMount(() => {
    const foreground = () => {
      if (document.visibilityState !== 'visible') return;
      fireAndForget(refresh(), 'saved-views');
    };
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    onCleanup(() => {
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    });
  });
}

/** Cursor-paginated definitions, independent of any selected view. */
export function useSavedViews(options: {
  viewerId: Accessor<string | undefined>;
  kind: string;
}): SavedViewsSource {
  const pendingAppearance = usePendingEntityAppearance();
  const client = createMemo(getGraphqlSoupClient);
  const list = createUrqlInfiniteQuery<
    SavedViewsQuery,
    SavedViewsQueryVariables,
    string | null,
    { viewerId: string | undefined; items: SavedView[] }
  >(() => ({
    query: SavedViewsDocument,
    client: client(),
    enabled: Boolean(options.viewerId()),
    initialPageParam: null,
    variables: (cursor) => ({
      kind: options.kind,
      first: 50,
      after: cursor,
    }),
    getNextPageParam: (page) => page.user.savedViews.nextCursor ?? undefined,
    select: ({ pages }) => ({
      viewerId: pages[0]?.user.id,
      items: [
        ...new Map(
          pages
            .filter((page) => page.user.id === pages[0]?.user.id)
            .flatMap((page) =>
              page.user.savedViews.nodes.map(
                (view) => [view.id, toSavedView(view)] as const
              )
            )
        ).values(),
      ],
    }),
    keepPreviousData: false,
    requestPolicy: 'cache-and-network',
  }));
  const refresh = async () => {
    const result = await list.refetch({ requestPolicy: 'network-only' });
    if (result.error) throw result.error;
  };
  revalidateSavedViewQuery(options.viewerId, refresh, options.kind);
  registerSavedViewReader({ client, refresh });
  const items = createMemo(() => {
    if (list.data?.viewerId !== options.viewerId()) return undefined;
    return list.data?.items.map((view) => {
      const appearance = pendingAppearance('saved_view', view.id, !!list.error);
      return appearance ? { ...view, appearance } : view;
    });
  });
  return {
    items,
    loading: () =>
      !list.error &&
      (list.isPending || list.data?.viewerId !== options.viewerId()),
    error: () => list.error,
    hasMore: () => list.hasNextPage,
    loadingMore: () => list.isFetchingNextPage,
    loadMore: () => list.fetchNextPage(),
    refresh,
  };
}

/** One authorized definition, including views outside the loaded list pages. */
export function useSavedView(options: {
  viewerId: Accessor<string | undefined>;
  id: Accessor<string | undefined>;
}): SavedViewSource {
  const client = createMemo(getGraphqlSoupClient);
  const pendingAppearance = usePendingEntityAppearance();
  const detail = createLiveQuery(
    SavedViewDocument,
    () => {
      const id = options.id();
      return id && options.viewerId() ? { id } : undefined;
    },
    () => ({
      client: client(),
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
    })
  );
  const refresh = async () => {
    if (!options.id()) return;
    const result = await detail.refetch({ requestPolicy: 'network-only' });
    if (result.error) throw result.error;
  };
  revalidateSavedViewQuery(options.viewerId, refresh);
  registerSavedViewReader({ client, id: options.id, refresh });
  return {
    data: () =>
      detail.data?.user.id === options.viewerId()
        ? detail.data?.user.savedView
          ? {
              ...toSavedView(detail.data.user.savedView),
              appearance:
                pendingAppearance(
                  'saved_view',
                  detail.data.user.savedView.id,
                  !!detail.error
                ) ??
                readEntityAppearance(detail.data.user.savedView.appearance),
            }
          : null
        : undefined,
    viewerId: () => detail.data?.user.id,
    loading: () =>
      detail.isPending || detail.data?.user.id !== options.viewerId(),
    error: () => detail.error,
    refresh,
  };
}
