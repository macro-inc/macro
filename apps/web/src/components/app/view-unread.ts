import { buildEmailQuery } from '@app/features/email-view/queries/email-query';
import { soupItemMatchesHomeTab } from '@app/features/home/queries/home-item-filter';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { EMPTY_TAG_FACET_CONTEXT } from '@app/features/soup/filters/facets/tag-facet';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity/types/entity';
import { notificationStateFromGraphql } from '@notifications/notification-state';
import { createChannelUnreadQuery } from '@queries/channel/unread-presence';
import { queryReadyGate } from '@queries/gate';
import { useNotificationTypePreferencesQuery } from '@queries/notification/type-preferences';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import {
  type SoupApiItemFilter,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { type Accessor, createEffect, createMemo, on } from 'solid-js';

/**
 * Past this many unread items a section's label says `99+`, so a count only
 * has to be exact below it.
 */
const COUNTED_EXACTLY = 100;

// Module scope: cached query meta outlives the hook that registered it.
const signalInsertFilter: SoupApiItemFilter = (item) =>
  soupItemMatchesHomeTab(item, 'signal');

/** A thread Mail's Important tab lists as unread. */
function isUnreadMail(entity: EntityData): boolean {
  return entity.type === 'email' && !entity.isRead && !entity.done;
}

/** How a section's unread count is used. */
export type ViewUnreadOptions = {
  /**
   * Whether a number is shown, so the count must be exact up to the label.
   * A dot only needs to know that something is unread.
   */
  exact: boolean;
};

/**
 * How many threads Mail shows as unread: the unread threads of its default
 * Important tab across every inbox the viewer reads, by the same query the
 * tab runs. Exact up to {@link COUNTED_EXACTLY} while `exact` holds; past it,
 * or without `exact`, at least one while any is unread.
 *
 * Zero while "New email" notifications are off: the viewer asked not to be
 * told about new mail, so Mail shows no badge at all.
 */
export function createMailUnread(options: ViewUnreadOptions): Accessor<number> {
  const preferencesQuery = useNotificationTypePreferencesQuery();
  const newEmailOff = () =>
    queryReadyGate(preferencesQuery) &&
    preferencesQuery.data.disabled_types.includes('new_email');
  const email = useSoupAstItemsQuery(
    () =>
      buildEmailQuery({
        tab: 'important',
        inboxIds: undefined,
        facets: { read: ['unread'] },
        facetContext: EMPTY_TAG_FACET_CONTEXT,
      }),
    () => ({
      meta: { insertFilter: signalInsertFilter },
    })
  );

  // Guard resource reads so loading a badge cannot suspend the app shell.
  // Re-check cached rows: optimistic read/done changes can leave them in a page.
  const loaded = createMemo(() => {
    if (!queryReadyGate(email)) return 0;
    return email.data.entities.filter(isUnreadMail).length;
  });
  const unknownPastLoaded = () =>
    options.exact &&
    !newEmailOff() &&
    queryReadyGate(email) &&
    email.hasNextPage &&
    loaded() < COUNTED_EXACTLY;

  // Unread mail past the loaded pages only matters to a number, once reads
  // leave fewer loaded than the label shows: the next page is asked for each
  // time that holds, until the label is reached or no page is left. A page is
  // asked for again only once the rows or their unread count have changed
  // since the last ask, so a page that adds nothing (a failure, or a cache
  // read that did not advance) never loops; the number stays a lower bound
  // until the next read or new row.
  let askedAt: string | undefined;
  createEffect(
    on(
      () =>
        queryReadyGate(email) &&
        unknownPastLoaded() &&
        !email.isFetchingNextPage
          ? `${email.data.entities.length}:${loaded()}`
          : undefined,
      (rows) => {
        if (rows === undefined || rows === askedAt) return;
        askedAt = rows;
        fireAndForget(email.fetchNextPage(), 'nav.mail-unread');
      }
    )
  );

  return () => {
    if (newEmailOff()) return 0;
    // While the next page loads, at least one more is unread.
    return loaded() + (email.hasNextPage ? 1 : 0);
  };
}

/**
 * How many conversations Channels shows as unread: those holding an unseen
 * top-level message, the rail's unread dot, by the same witness the rail
 * reads, with marks the viewer just made applied.
 */
export function createChannelsUnread(): Accessor<number> {
  const notificationSource = useGlobalNotificationSource();
  const channels = createChannelUnreadQuery(
    makeGraphqlSoupInput({
      // Preserve the previous feed's 500-entity candidate bound, but select
      // only channels and one unread witness, never historical message data.
      params: { limit: 500, sort_method: 'updated_at' },
      body: compileToAst(
        queryStateFrom(
          defineQueryFilters({
            include: { channelSeen: false },
          })
        )
      ),
    })
  );

  return createMemo(() => {
    if (!channels.isEnabled || !queryReadyGate(channels)) return 0;
    // One witness per channel at most, so unseen witnesses are channels.
    return channels.data.filter((notification) => {
      const state = notificationStateFromGraphql(notification.state);
      return (
        (notificationSource.withLocalState?.({
          id: notification.id,
          state,
        }) ?? state) === 'unseen'
      );
    }).length;
  });
}
