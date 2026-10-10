import {
  buildFlatSoupRows,
  createSoupRowStore,
  createTagFacetContext,
  tagFacetReady,
  testFacets,
} from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import type { DateValue } from '@core/util/date';
import { type EmailEntity, isEmailEntity } from '@entity';
import { useEmailFocusQuery } from '@queries/email/focus';
import { createGraphqlSoupDoneProjection } from '@queries/soup/graphql/done-projection';
import { usePendingGraphqlSoupDone } from '@queries/soup/graphql/optimistic-done';
import { createMemo } from 'solid-js';
import { EMAIL_FACETS, type EmailFacetContext } from '../filters/email-facets';
import { useEmailTabAvailability } from '../tab-availability';
import type {
  EmailDataSource,
  EmailDataSourceInput,
  EmailDataSourceItem,
  UseEmailDataSourceOptions,
} from './use-email-query';

const timestamp = (value: DateValue | null | undefined) =>
  value instanceof Date ? value.getTime() : Date.parse(value ?? '') || 0;

// The same recency the other tabs order and group by.
const recency = (email: EmailEntity) =>
  timestamp(email.sortTs ?? email.updatedAt ?? email.createdAt);

function matchesSearch(email: EmailEntity, text: string): boolean {
  return [email.name, email.snippet, email.senderName, email.senderEmail].some(
    (value) => value?.toLowerCase().includes(text) === true
  );
}

/**
 * Applies the view's inbox scope, filters and search to the Focus list. The
 * server returns it most important first; "Most recent" reorders it here.
 * Done threads leave at once, as on Signal: the server drops archived
 * threads only on the next read. Focus has no Status or Done filters.
 */
export function selectFocusEmails(
  emails: readonly EmailEntity[],
  input: EmailDataSourceInput,
  facetContext: EmailFacetContext
): EmailEntity[] {
  const inboxes =
    input.inboxIds === undefined ? undefined : new Set(input.inboxIds);
  const text = input.search.trim().toLowerCase();
  const selected = emails.filter(
    (email) =>
      email.done !== true &&
      (inboxes === undefined ||
        (email.linkId !== undefined && inboxes.has(email.linkId))) &&
      testFacets(
        { ...input.facets, read: [], done: [] },
        EMAIL_FACETS,
        email,
        facetContext
      ) &&
      (text === '' || matchesSearch(email, text))
  );
  return input.focusSort === 'recent'
    ? selected.sort((left, right) => recency(right) - recency(left))
    : selected;
}

/**
 * The Focus tab: signal threads the email focus worker found worth the
 * owner's attention. The whole list arrives in one read, so filtering and
 * ordering happen here rather than on the server.
 */
export function useFocusEmailSource(
  state: EmailDataSourceInput,
  options: UseEmailDataSourceOptions
): EmailDataSource {
  const notificationSource = useGlobalNotificationSource();
  const tabAvailability = useEmailTabAvailability();
  // Never read Focus while its flags are off or still loading.
  const focus = useEmailFocusQuery(
    () => state.tab === 'focus' && tabAvailability('focus') === 'on'
  );
  const pendingDone = usePendingGraphqlSoupDone();
  const projectDone = createGraphqlSoupDoneProjection();
  const facetContext = createMemo(
    (): EmailFacetContext => createTagFacetContext(options.tagSets())
  );
  const ready = () => tagFacetReady(state.facets, options.tagSetsReady());

  // Done and Undo show at once, with or without the normalized cache: Soup's
  // pending done intents are projected onto the server's list.
  const emails = createMemo((): EmailEntity[] => {
    const data = focus.data
      ? { entities: focus.data, groups: undefined }
      : undefined;
    const projected = projectDone(
      'email:focus',
      data,
      pendingDone(),
      true,
      new Set()
    );
    return projected?.entities.filter(isEmailEntity) ?? [];
  });

  const built = createMemo((): EmailDataSourceItem[] => {
    if (!ready()) return [];
    return buildFlatSoupRows(
      selectFocusEmails(emails(), state, facetContext()).map((email) =>
        withEntityNotifications(email, notificationSource)
      )
    );
  });
  const items = createSoupRowStore(built);

  return {
    items,
    isLoading: () =>
      tabAvailability('focus') === 'loading' || focus.isLoading || !ready(),
    isFetching: () => focus.isFetching,
    error: () => focus.error ?? undefined,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
    refresh: async () => {
      await focus.refetch({ requestPolicy: 'network-only' });
    },
  };
}
