import { buildEmailQuery } from '@app/features/email-view/queries/email-query';
import { soupItemMatchesInboxTab } from '@app/features/inbox-view/queries/inbox-item-filter';
import { useInboxEntitiesQuery } from '@app/features/inbox-view/queries/use-inbox-query';
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
import { createChannelUnreadQuery } from '@queries/channel/unread-presence';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { createMemo } from 'solid-js';

/** Presence in the loaded unread page, never a total or a pagination loop. */
export function useSidebarUnread() {
  const notificationSource = useGlobalNotificationSource();
  const graphqlFlag = useFeatureFlag(enableGraphqlSoup);
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
  const inbox = useInboxEntitiesQuery({
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
      meta: { insertFilter: (item) => soupItemMatchesInboxTab(item, 'signal') },
    })
  );

  // Guard resource reads so loading a badge cannot suspend the app shell.
  // Re-check cached rows: optimistic read/done changes can leave them in a page.
  const inboxUnread = createMemo(() => {
    if (inbox.query.isLoading) return false;
    return inbox.hasUnreadEntity(inbox.query.data?.entities ?? []);
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
      return (channels.data ?? []).some((notification) => {
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
          !notificationIsRead(notification)
      );
  });

  return (id: string): boolean => {
    if (id === 'inbox') return inboxUnread();
    if (id === 'mail') return emailUnread();
    if (id === 'channels') return channelsUnread();
    return false;
  };
}
