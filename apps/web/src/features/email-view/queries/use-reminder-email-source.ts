import type { EmailRowReminder } from '@app/features/reminders/core/email-row-reminder';
import {
  buildFlatSoupRows,
  createSoupLoadMoreRow,
  createSoupRowStore,
  createTagFacetContext,
  tagFacetReady,
  testFacets,
} from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { enableReminders } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { type EmailEntity, isEmailEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import { collectionReminderEntity } from '@queries/reminders/collection';
import { useEmailReminderCollection } from '@queries/reminders/email-collection';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { ListEmailRemindersParams } from '@service-storage/generated/schemas/listEmailRemindersParams';
import {
  createComputed,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  indexArray,
  onCleanup,
  untrack,
} from 'solid-js';
import { EMAIL_FACETS } from '../filters/email-facets';
import { buildEmailQuery } from './email-query';
import type {
  EmailDataSource,
  EmailDataSourceInput,
  EmailDataSourceItem,
  UseEmailDataSourceOptions,
} from './use-email-query';

/** Original email rows in reminder order, with membership and facets owned by the server. */
export function useReminderEmailSource(
  state: EmailDataSourceInput,
  options: UseEmailDataSourceOptions
): EmailDataSource {
  const userId = useUserId();
  const enabled = useFeatureFlag(enableReminders);
  const notificationSource = useGlobalNotificationSource();
  const tagContext = createMemo(() => createTagFacetContext(options.tagSets()));
  const ready = () => tagFacetReady(state.facets, options.tagSetsReady());
  const active = () =>
    state.tab === 'reminders' && enabled().enabled && ready();
  const filters = createMemo(
    (): ListEmailRemindersParams => ({
      inboxIds: state.inboxIds,
      noInboxes: state.inboxIds?.length === 0,
      done:
        state.facets.done?.length === 1
          ? state.facets.done[0] === 'done'
          : undefined,
      read:
        state.facets.read?.length === 1
          ? state.facets.read[0] === 'read'
          : undefined,
      calendar: state.facets.calendar?.includes('has-calendar-invite'),
      tags: (state.facets.tags ?? [])
        .flatMap((id) => {
          const property = tagContext().tagPropertyDefinitionByOptionId.get(id);
          return property ? [`${property}:${id}`] : [];
        })
        .sort(),
      attachments: (state.facets.attachments ?? [])
        .map((id) => id.replace('attachment-', ''))
        .sort(),
    })
  );
  const collection = useEmailReminderCollection(() => ({
    userId: userId(),
    enabled: active(),
    filters: filters(),
  }));
  const pages = createMemo(() =>
    queryReadyGate(collection) ? collection.data.pages : []
  );
  const hydration = indexArray(pages, (page) => {
    const ids = () => page().items.map((item) => item.threadId);
    return useSoupAstItemsQuery(
      () =>
        buildEmailQuery(
          {
            tab: 'reminders',
            inboxIds: state.inboxIds,
            facets: state.facets,
            facetContext: tagContext(),
          },
          ids()
        ),
      () => ({ enabled: active() && ids().length > 0, keepPreviousData: false })
    );
  });
  const scope = createMemo(() =>
    JSON.stringify([userId(), active(), filters()])
  );
  const [disposed, setDisposed] = createSignal(false);
  onCleanup(() => setDisposed(true));
  const usable = (query: ReturnType<typeof useSoupAstItemsQuery>) =>
    queryReadyGate(query) && !query.isPlaceholderData;
  const pending = () =>
    hydration().some(
      (query, index) =>
        pages()[index].items.length > 0 && !usable(query) && !query.error
    );
  const failed = () =>
    hydration().filter(
      (query, index) =>
        pages()[index].items.length > 0 && !usable(query) && query.error
    );
  const matches = (email: EmailEntity) =>
    testFacets(
      { ...state.facets, read: [] },
      EMAIL_FACETS,
      email,
      tagContext()
    );
  const entities = createMemo(() => {
    const byId = new Map(
      hydration().flatMap((query) =>
        usable(query)
          ? query
              .data!.entities.filter(isEmailEntity)
              .filter(matches)
              .map((entity) => [entity.id, entity] as const)
          : []
      )
    );
    const seen = new Set<string>();
    return pages().flatMap((page) =>
      page.items.flatMap((item) => {
        const email = byId.get(item.threadId);
        if (!email || seen.has(email.id)) return [];
        seen.add(email.id);
        return [withEntityNotifications(email, notificationSource)];
      })
    );
  });
  const reminders = createMemo<Map<string, EmailRowReminder>>(() => {
    if (!active()) return new Map();
    const visibleIds = new Set(entities().map((email) => email.id));
    return new Map(
      pages().flatMap((page) =>
        page.items
          .filter((item) => visibleIds.has(item.threadId))
          .map(
            (item) =>
              [
                item.threadId,
                {
                  nearest: collectionReminderEntity(item.nearest),
                  count: item.count,
                },
              ] as const
          )
      )
    );
  });
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [loadError, setLoadError] = createSignal<Error>();
  const error = () =>
    failed()[0]?.error ??
    loadError() ??
    (entities().length === 0 ? (collection.error ?? undefined) : undefined);
  const hasMore = () =>
    Boolean(
      collection.hasNextPage || loadingMore() || pending() || failed().length
    );
  const built = createMemo((): EmailDataSourceItem[] => {
    const rows: EmailDataSourceItem[] = buildFlatSoupRows(entities());
    // A sparse page or an unhydrated final page still has reachable work.
    if (hasMore())
      rows.push(
        createSoupLoadMoreRow({
          scopeId: 'email:reminders',
          label: error() ? 'Couldn’t load more email. Try again' : 'Load More',
          isLoading:
            loadingMore() || collection.isFetchingNextPage || pending(),
        })
      );
    return rows;
  });
  const items = createSoupRowStore(built);

  // Every caller waits for the same operation, including native row publication.
  // Returning a resolved no-op while a fetch is pending makes detail navigation
  // spin its hasMore loop and can starve the network task itself.
  let inFlight: Promise<void> | undefined;
  const waitForHydration = (requestScope: string) =>
    new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        createComputed(() => {
          if (disposed() || scope() !== requestScope) {
            dispose();
            reject(new Error('Email view changed while loading'));
          } else if (!collection.isFetchingNextPage && !pending()) {
            items();
            dispose();
            resolve();
          }
        });
      });
    });
  const loadMore = (): Promise<void> => {
    if (inFlight) return inFlight;
    const requestScope = scope();
    setLoadingMore(true);
    setLoadError(undefined);
    inFlight = Promise.resolve()
      .then(async () => {
        const retries = failed();
        if (retries.length) {
          await Promise.all(retries.map((query) => query.refresh()));
        } else if (
          !pending() &&
          collection.hasNextPage &&
          !collection.isFetchingNextPage
        ) {
          const result = await collection.fetchNextPage();
          if (result?.error) setLoadError(result.error);
        }
        await waitForHydration(requestScope);
      })
      .catch((cause) => {
        if (scope() !== requestScope || disposed()) throw cause;
        setLoadError(
          cause instanceof Error ? cause : new Error('Email couldn’t be loaded')
        );
      })
      .finally(() => {
        inFlight = undefined;
        setLoadingMore(false);
      });
    return inFlight;
  };

  // Optimistic archive/tag changes must remove stale membership immediately.
  // Refill from the authoritative collection once per changed membership, not
  // from an unfiltered native page. Read changes intentionally retain admission.
  let reconciled = '';
  createEffect(() => {
    const currentScope = scope();
    // An intermediate fetch is not evidence that a mismatch disappeared.
    // Retain the reconciliation signature while any admitted page refreshes.
    if (
      hydration().some(
        (query, index) =>
          pages()[index].items.length > 0 &&
          (!usable(query) || query.isFetching)
      )
    )
      return;
    const missing = hydration().flatMap((query, index) => {
      if (!usable(query) || query.isFetching) return [];
      const ids = new Set(
        query
          .data!.entities.filter(isEmailEntity)
          .filter(matches)
          .map((email) => email.id)
      );
      return pages()
        [index].items.filter((item) => !ids.has(item.threadId))
        .map((item) => item.threadId);
    });
    const signature = JSON.stringify([currentScope, missing]);
    if (signature === reconciled) return;
    reconciled = signature;
    if (missing.length && active()) untrack(() => void collection.refetch());
  });
  createEffect(() => {
    scope();
    setLoadError(undefined);
  });

  return {
    reminderForThread: (threadId) => reminders().get(threadId),
    items,
    isLoading: () =>
      (state.tab === 'reminders' && enabled().loading) ||
      !ready() ||
      collection.isLoading ||
      (entities().length === 0 && pending()),
    isFetching: () =>
      collection.isFetching || hydration().some((query) => query.isFetching),
    error,
    hasMore,
    isLoadingMore: () =>
      loadingMore() || collection.isFetchingNextPage || pending(),
    loadMore,
    refresh: async () => {
      setLoadError(undefined);
      await Promise.all([
        collection.refetch(),
        ...hydration().map((query) => query.refresh()),
      ]);
    },
  };
}
