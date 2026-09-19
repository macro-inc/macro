import { copyCalendarEventMentionTarget } from '@block-calendar/copy-event-mention';
import { toast } from '@core/component/Toast/Toast';
import { buildSimpleEntityUrl } from '@core/util/url';
import {
  getChannelNotificationParams,
  type UnifiedNotification,
} from '@notifications';

/**
 * Copy the link to whatever a notification points at.
 *
 * The calendar is a singleton block, so an event has no `/app/calendar_event`
 * route to address it by id — a reminder copies the calendar's deep link for
 * the occurrence it fired for, with the mention flavor behind it so a paste
 * into an editor stays a live mention.
 */
export async function copyNotificationLink(notification: UnifiedNotification) {
  const metadata = notification.notification_metadata;
  if (metadata.tag === 'calendar_event_reminder') {
    await copyCalendarEventMentionTarget({
      eventId: metadata.content.eventId,
      title: metadata.content.title,
      occurrenceKey: metadata.content.occurrenceKey,
    });
    return;
  }

  const { params } = getChannelNotificationParams(notification);
  await navigator.clipboard.writeText(
    buildSimpleEntityUrl(
      { type: notification.entity_type, id: notification.entity_id },
      params
    )
  );
  toast.success('Link copied to clipboard');
}
