import { compareDateDesc } from '@core/util/date';
import type { WithNotification } from '@entity/types/notification';
import type { UnifiedNotification } from './types';

/**
 * The newest outstanding notification a row can announce. Home supplies a
 * cutoff so newer own activity cannot borrow an older notification's label or
 * click target. Reading a notification does not dismiss it.
 */
export function newestRowNotification(
  entity: WithNotification<{ type: string }>
): UnifiedNotification | undefined {
  const notification = (entity.notifications?.() ?? [])
    .filter((n) => n.state !== 'done')
    .sort((a, b) => compareDateDesc(a.created_at, b.created_at))[0];
  if (!notification) return undefined;
  if (
    entity.notificationDisplayCutoff != null &&
    compareDateDesc(notification.created_at, entity.notificationDisplayCutoff) >
      0
  ) {
    return undefined;
  }
  return notification;
}

/** A calendar event row announcing a request to join it, which names the requester. */
export function getCalendarJoinRequestNotification(
  entity: WithNotification<{ type: string }>
): UnifiedNotification | undefined {
  if (entity.type !== 'calendar_event') return undefined;
  const notification = newestRowNotification(entity);
  return notification?.notification_metadata.tag ===
    'calendar_event_join_request'
    ? notification
    : undefined;
}
