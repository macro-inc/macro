import type {
  GetNotificationTypePreferencesResponses,
  NotifEvent,
} from '../../../generated/notification/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Notification } from './notification';

/** A notification event type name, e.g. `channel_mention`. */
export type NotificationType = NotifEvent['tag'];

type NotificationTypePreferences = GetNotificationTypePreferencesResponses[200];

export class NotificationNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a notification by id. */
  byId(id: string): Notification {
    return Notification.byId(this.client, id);
  }

  /** The viewer's notification feed, most recent first, auto-paginated. */
  list(opts?: { pageSize?: number }): AsyncGenerator<Notification> {
    return Notification.list(this.client, opts);
  }

  /** Mark a batch of notifications as seen. */
  async markSeen(ids: string[]): Promise<void> {
    unwrap(
      await this.client.notification.bulkMarkNotificationsSeen({
        body: { notificationIds: ids },
      }),
    );
  }

  /** Mark a batch of notifications as done. */
  async markDone(ids: string[]): Promise<void> {
    unwrap(
      await this.client.notification.bulkMarkNotificationsDone({
        body: { notificationIds: ids },
      }),
    );
  }

  /** Delete a batch of notifications. */
  async delete(ids: string[]): Promise<void> {
    unwrap(
      await this.client.notification.bulkDeleteUserNotificationsV2({
        body: { notificationIds: ids },
      }),
    );
  }

  /** The viewer's notification type preferences (disabled types). */
  async preferences(): Promise<NotificationTypePreferences> {
    return unwrap(
      await this.client.notification.getNotificationTypePreferences(),
    );
  }

  /** Re-enable delivery of a notification type. */
  async enableType(type: NotificationType): Promise<void> {
    unwrap(
      await this.client.notification.enableNotificationType({
        path: { notification_event_type: type },
      }),
    );
  }

  /** Disable delivery of a notification type. */
  async disableType(type: NotificationType): Promise<void> {
    unwrap(
      await this.client.notification.disableNotificationType({
        path: { notification_event_type: type },
      }),
    );
  }
}
