import { useChannelThreadsNotificationKind } from '@app/features/channels-view/queries/channel-threads-unread';
import { buildEmailQuery } from '@app/features/email-view/queries/email-query';
import { soupItemMatchesHomeTab } from '@app/features/home/queries/home-item-filter';
import { useHomeEntitiesQuery } from '@app/features/home/queries/use-home-query';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { EMPTY_TAG_FACET_CONTEXT } from '@app/features/soup/filters/facets/tag-facet';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  enableChannelThreadsPreview,
  enableGraphqlSoup,
} from '@core/constant/featureFlags';
import { notificationIsRead } from '@entity/utils/notification';
import {
  channelNotificationKind,
  channelNotificationWitness,
} from '@notifications/channel-notification-kind';
import { notificationStateFromGraphql } from '@notifications/notification-state';
import { isUnreadChannelMessageNotification } from '@notifications/top-level-channel-notification';
import { createChannelUnreadQuery } from '@queries/channel/unread-presence';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { createMemo } from 'solid-js';

/** Presence in the loaded unread page, never a total or a pagination loop. */
export function useSidebarNotificationState() {
  const notificationSource = useGlobalNotificationSource();
  const graphqlFlag = useFeatureFlag(enableGraphqlSoup);
  const threadsFlag = useFeatureFlag(enableChannelThreadsPreview);
  const threadsKind = useChannelThreadsNotificationKind(
    () => threadsFlag().enabled
  );
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
  const home = useHomeEntitiesQuery({
    tab: 'signal',
    facets: { read: ['unread'] },
  });
  const email = useSoupAstItemsQuery(
    () =>
      buildEmailQuery({
        tab: 'important',
        inboxIds: undefined,
        facets: { read: ['unread'] },
        facetContext: EMPTY_TAG_FACET_CONTEXT,
      }),
    () => ({
      meta: { insertFilter: (item) => soupItemMatchesHomeTab(item, 'signal') },
    })
  );

  // Guard resource reads so loading a badge cannot suspend the app shell.
  // Re-check cached rows: optimistic read/done changes can leave them in a page.
  const homeUnread = createMemo(() => {
    if (home.query.isLoading) return false;
    return home.hasUnreadEntity(home.query.data?.entities ?? []);
  });
  const emailUnread = createMemo(() => {
    if (email.isLoading) return false;
    return (email.data?.entities ?? []).some(
      (entity) => entity.type === 'email' && !entity.isRead && !entity.done
    );
  });
  const channelsUnread = createMemo(() => {
    if (graphqlFlag().enabled) {
      if (!channels.isEnabled || channels.isLoading) return false;
      return (channels.data?.messages ?? []).some((notification) => {
        const state = notificationStateFromGraphql(notification.state);
        return (
          (notificationSource.withLocalState?.({
            id: notification.id,
            state,
          }) ?? state) === 'unseen'
        );
      });
    }
    return notificationSource
      .notifications()
      .some(
        (notification) =>
          notification.entity_type === 'channel' &&
          !notificationIsRead(notification) &&
          isUnreadChannelMessageNotification(notification)
      );
  });

  const channelKind = createMemo(() => {
    if (!threadsFlag().enabled) return undefined;
    const notifications = graphqlFlag().enabled
      ? channels.isEnabled && !channels.isLoading
        ? (channels.data?.activity ?? []).map((notification) => ({
            ...notification,
            state: notificationStateFromGraphql(notification.state),
          }))
        : []
      : notificationSource
          .notifications()
          .filter((notification) => notification.entity_type === 'channel')
          .map(channelNotificationWitness);
    const kind = channelNotificationKind(
      notifications,
      (notification) =>
        notificationSource.withLocalState?.(notification) ?? notification.state
    );
    if (kind === 'important' || threadsKind() === 'important')
      return 'important';
    return kind !== 'none' || threadsKind() !== 'none' ? 'activity' : 'none';
  });
  const hasUnread = (id: string): boolean => {
    if (id === 'home') return homeUnread();
    if (id === 'mail') return emailUnread();
    if (id === 'channels')
      return threadsFlag().enabled
        ? channelKind() !== 'none'
        : channelsUnread();
    return false;
  };
  return { hasUnread, channelKind };
}

/** Preserve the boolean API for callers that only need unread presence. */
export function useSidebarUnread() {
  return useSidebarNotificationState().hasUnread;
}
