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

/**
 * @routing Use when reading the user's notifications or marking them seen, such as catching up on what they missed; not sending messages.
 */
export class NotificationNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a notification by id. */
  byId(id: string): Notification {
    return Notification.byId(this.client, id);
  }

  /**
   * The viewer's notification feed, most recent first, auto-paginated.
   *
   * @readonly
   */
  list(opts?: { pageSize?: number }): AsyncGenerator<Notification> {
    return Notification.list(this.client, opts);
  }

  /**
   * Mark a batch of notifications as seen.
   *
   * @write
   * @idempotent
   */
  async markSeen(ids: string[]): Promise<void> {
    unwrap(
      await this.client.notification.bulkMarkNotificationsSeen({
        body: { notificationIds: ids },
      }),
    );
  }

  /**
   * Mark a batch of notifications as done.
   *
   * @write
   * @idempotent
   */
  async markDone(ids: string[]): Promise<void> {
    unwrap(
      await this.client.notification.bulkMarkNotificationsDone({
        body: { notificationIds: ids },
      }),
    );
  }

  /**
   * Delete a batch of notifications.
   *
   * @destructive
   * @idempotent
   */
  async delete(ids: string[]): Promise<void> {
    unwrap(
      await this.client.notification.bulkDeleteUserNotificationsV2({
        body: { notificationIds: ids },
      }),
    );
  }

  /**
   * The viewer's notification type preferences (disabled types).
   *
   * @readonly
   */
  async preferences(): Promise<NotificationTypePreferences> {
    return unwrap(
      await this.client.notification.getNotificationTypePreferences(),
    );
  }

  /**
   * Re-enable delivery of a notification type.
   *
   * @write
   * @idempotent
   */
  async enableType(type: NotificationType): Promise<void> {
    unwrap(
      await this.client.notification.enableNotificationType({
        path: { notification_event_type: type },
      }),
    );
  }

  /**
   * Disable delivery of a notification type.
   *
   * @write
   * @idempotent
   */
  async disableType(type: NotificationType): Promise<void> {
    unwrap(
      await this.client.notification.disableNotificationType({
        path: { notification_event_type: type },
      }),
    );
  }
}
