import { clause, compileClause, confine } from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { hasNotificationCoverage } from '@app/features/soup/notification-coverage';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { notificationIsRead } from '@entity/utils/notification';
import { boundedCount } from '@queries/soup/bounded-count';
import { createBoundedCountPagination } from '@queries/soup/bounded-count-pagination';
import { useSoupAstItemsQuery } from '@queries/soup/items';

/** Counts channels, not messages or Inbox thread rows. Includes direct messages. */
export function useChannelsUnreadCount() {
  const source = useGlobalNotificationSource();
  const query = useSoupAstItemsQuery(() => ({
    params: { expand: true, limit: 100, sort_method: 'updated_at' },
    body: compileClause(
      confine({
        chanf: clause.and(
          clause.eq('channelIsParticipant', true),
          clause.eq('channelSeen', false)
        ),
      })
    ),
  }));
  const count = () => {
    if (query.isLoading || query.error || query.isPlaceholderData) return;
    const entities = query.data?.entities;
    if (!entities) return;
    const unread = entities.filter(
      (entity) =>
        entity.type === 'channel' &&
        // Deliberately unscoped: unread thread activity also makes a channel unread.
        withEntityNotifications(entity, source)
          .notifications?.()
          .some((notification) => !notificationIsRead(notification))
    );
    return boundedCount(
      unread.map((entity) => entity.id),
      !query.hasNextPage && hasNotificationCoverage(entities, source)
    );
  };
  createBoundedCountPagination(query, count);
  return count;
}
