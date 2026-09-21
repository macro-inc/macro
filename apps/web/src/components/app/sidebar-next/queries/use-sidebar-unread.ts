import { buildEmailQuery } from '@app/features/email-view/queries/email-query';
import { soupItemMatchesInboxTab } from '@app/features/inbox-view/queries/inbox-item-filter';
import { useInboxEntitiesQuery } from '@app/features/inbox-view/queries/use-inbox-query';
import { EMPTY_TAG_FACET_CONTEXT } from '@app/features/soup/filters/facets/tag-facet';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { unreadFilterFn } from '@entity/utils/filter';
import { notificationIsRead } from '@entity/utils/notification';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { createMemo } from 'solid-js';

/** Presence in the loaded unread page, never a total or a pagination loop. */
export function useSidebarUnread() {
  const notificationSource = useGlobalNotificationSource();
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
    return inbox
      .transformEntities(inbox.query.data?.entities ?? [])
      .some(unreadFilterFn);
  });
  const emailUnread = createMemo(() => {
    if (email.isLoading) return false;
    return (email.data?.entities ?? []).some(
      (entity) => entity.type === 'email' && !entity.isRead && !entity.done
    );
  });
  const channelsUnread = createMemo(() =>
    notificationSource
      .notifications()
      .some(
        (notification) =>
          notification.entity_type === 'channel' &&
          !notificationIsRead(notification)
      )
  );

  return (id: string): boolean => {
    if (id === 'inbox') return inboxUnread();
    if (id === 'mail') return emailUnread();
    if (id === 'channels') return channelsUnread();
    return false;
  };
}
