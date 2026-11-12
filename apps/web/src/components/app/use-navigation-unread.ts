import { buildEmailQuery } from '@app/features/email-view/queries/email-query';
import { soupItemMatchesHomeTab } from '@app/features/home/queries/home-item-filter';
import { useHomeUnreadQuery } from '@app/features/home/queries/use-home-unread-query';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { EMPTY_TAG_FACET_CONTEXT } from '@app/features/soup/filters/facets/tag-facet';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { notificationIsRead } from '@entity/utils/notification';
import { notificationStateFromGraphql } from '@notifications/notification-state';
import { isUnreadChannelMessageNotification } from '@notifications/top-level-channel-notification';
import { createRecentlyOpenedChannelsQuery } from '@queries/channel/recently-opened';
import { createChannelUnreadQuery } from '@queries/channel/unread-presence';
import { queryReadyGate } from '@queries/gate';
import { useChannelCachePrewarm } from '@queries/messages/graphql/prewarm';
import { useNotificationTypePreferencesQuery } from '@queries/notification/type-preferences';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import {
  type SoupApiItemFilter,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { createMemo } from 'solid-js';

// Module scope: cached query meta outlives the hook that registered it.
const signalInsertFilter: SoupApiItemFilter = (item) =>
  soupItemMatchesHomeTab(item, 'signal');

/** Presence in the loaded unread page, never a total or a pagination loop. */
export function useNavigationUnread() {
  const notificationSource = useGlobalNotificationSource();
  const graphqlFlag = useFeatureFlag(enableGraphqlSoup);
  const preferencesQuery = useNotificationTypePreferencesQuery();
  const isTypeDisabled = (type: string) =>
    queryReadyGate(preferencesQuery) &&
    preferencesQuery.data.disabled_types.includes(type);
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
    }),
    () => graphqlFlag().enabled
  );
  const recentChannels = createRecentlyOpenedChannelsQuery(
    makeGraphqlSoupInput({
      params: { limit: 20, sort_method: 'viewed_at' },
      body: compileToAst(
        queryStateFrom(
          defineQueryFilters({
            include: { channelIsParticipant: [true] },
          })
        )
      ),
    }),
    () => graphqlFlag().enabled
  );
  const homeUnread = useHomeUnreadQuery(() => graphqlFlag().enabled);
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
  // Respect user preference: hide badge when email notifications are disabled.
  const emailUnread = createMemo(() => {
    if (isTypeDisabled('new_email')) return false;
    if (!queryReadyGate(email)) return false;
    return email.data.entities.some(
      (entity) => entity.type === 'email' && !entity.isRead && !entity.done
    );
  });
  const unreadChannelIds = createMemo((): string[] => {
    if (!graphqlFlag().enabled) return [];
    if (!channels.isEnabled || !queryReadyGate(channels)) return [];
    return channels.data
      .filter((notification) => {
        const state = notificationStateFromGraphql(notification.state);
        return (
          (notificationSource.withLocalState?.({
            id: notification.id,
            state,
          }) ?? state) === 'unseen'
        );
      })
      .map((notification) => notification.channelId);
  });
  // The channels with unread messages and the ones opened last are the
  // likeliest to be opened next. Both lists keep the server's order.
  useChannelCachePrewarm(unreadChannelIds, () =>
    recentChannels.isEnabled && queryReadyGate(recentChannels)
      ? recentChannels.data
      : []
  );
  const channelsUnread = createMemo(() => {
    if (graphqlFlag().enabled) return unreadChannelIds().length > 0;
    return notificationSource
      .notifications()
      .some(
        (notification) =>
          notification.entity_type === 'channel' &&
          !notificationIsRead(notification) &&
          isUnreadChannelMessageNotification(notification)
      );
  });

  return (id: string): boolean => {
    // Notifications reads the same attention as Home's unread witness; a
    // second live feed here would only duplicate it.
    if (id === 'home' || id === 'notifications') return homeUnread();
    if (id === 'mail') return emailUnread();
    if (id === 'channels') return channelsUnread();
    return false;
  };
}
