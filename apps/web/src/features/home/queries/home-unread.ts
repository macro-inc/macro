import { ENABLE_CLIENT_EMAIL_SIGNAL_FILTER } from '@core/constant/featureFlags';
import type { NotificationSource } from '@notifications/notification-source';
import { notificationStateFromGraphql } from '@notifications/notification-state';
import type { HomeUnreadPresenceQuery } from '@service-storage/graphql/generated/graphql';
import { startOfDay, subWeeks } from 'date-fns';
import { match } from 'ts-pattern';
import { isSignalEmail } from '../../next-soup/filters/inbox-filters';
import type { HomeQueryCapabilities } from './home-query';

type HomeUnreadItem = HomeUnreadPresenceQuery['user']['soup']['items'][number];
type Witness = HomeUnreadItem['unreadNotifications'][number];

/** Evaluate only bounded witnesses. Full history and mark-read inputs stay separate. */
export function hasHomeUnreadWitness(
  items: readonly HomeUnreadItem[],
  capabilities: HomeQueryCapabilities,
  source: Pick<NotificationSource, 'withLocalState'>,
  now = new Date()
): boolean {
  const recent = subWeeks(startOfDay(now), 2).getTime();
  const unread = (notifications: readonly Witness[]) =>
    notifications.some((notification) => {
      const state = notificationStateFromGraphql(notification.state);
      return (
        (source.withLocalState?.({ id: notification.id, state }) ?? state) ===
        'unseen'
      );
    });
  const isRecent = (item: HomeUnreadItem, sortTs?: string) =>
    Date.parse(
      sortTs ?? item.metadata.updatedAt ?? item.metadata.createdAt ?? ''
    ) >= recent;

  return items.some((item) =>
    match(item)
      .with(
        { __typename: 'GraphqlSoupEmailThread' },
        (email) =>
          email.inboxVisible &&
          isRecent(email, email.sortTs) &&
          (!ENABLE_CLIENT_EMAIL_SIGNAL_FILTER ||
            email.isDraft ||
            isSignalEmail(email)) &&
          (!email.isRead || unread(email.unreadReminders))
      )
      .with(
        { __typename: 'GraphqlSoupDocument' },
        (document) =>
          (capabilities.snippets ||
            document.subType?.__typename !== 'GraphqlSnippetSubType') &&
          isRecent(document) &&
          unread(document.unreadNotifications)
      )
      .with(
        { __typename: 'GraphqlSoupChat' },
        { __typename: 'GraphqlSoupProject' },
        (entity) => isRecent(entity) && unread(entity.unreadNotifications)
      )
      .with(
        { __typename: 'GraphqlSoupCalendarEvent' },
        (event) => capabilities.calendar && unread(event.unreadNotifications)
      )
      .with(
        { __typename: 'GraphqlSoupForeignEntity' },
        (entity) =>
          capabilities.foreignEntities && unread(entity.unreadNotifications)
      )
      .with(
        { __typename: 'GraphqlSoupChannel' },
        { __typename: 'GraphqlSoupChannelMessage' },
        (entity) => unread(entity.unreadNotifications)
      )
      .otherwise(() => false)
  );
}
