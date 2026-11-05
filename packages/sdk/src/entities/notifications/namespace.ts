import type {
  GetNotificationTypePreferencesResponses,
  ManualNotificationLink,
  NotifEvent,
} from '../../../generated/notification/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { AgentSession } from '../agent-sessions/agent-session';
import { Channel } from '../channels/channel';
import { Chat } from '../chats/chat';
import { Database } from '../databases/database';
import { Document } from '../documents/document';
import { EmailThread } from '../email/thread';
import type { Form } from '../forms/form';
import { Project } from '../projects/project';
import { Routine } from '../routines/routine';
import type { User } from '../users/user';
import { Notification } from './notification';

/** A notification event type name, e.g. `channel_mention`. */
export type NotificationType = NotifEvent['tag'];

type NotificationTypePreferences = GetNotificationTypePreferencesResponses[200];

/** What a sent notification opens. Tasks are documents. */
export type NotificationLink =
  | Document
  | Channel
  | Chat
  | Project
  | EmailThread
  | AgentSession
  | Routine
  | Database
  | Form;

/** A notification to send with {@link NotificationNamespace.send}. */
export interface SendNotificationOptions {
  /** The headline, at most 120 characters. */
  title: string;
  /** More detail, at most 1000 characters. */
  body?: string;
  /** What it opens; the recipient must already be able to see it. */
  link: NotificationLink;
  /** Who gets it; you when omitted. */
  to?: User;
}

function linkReference(link: NotificationLink): ManualNotificationLink {
  return { entityType: linkEntityType(link), entityId: link.id };
}

// Handles have protected constructors, which `P.instanceOf` cannot take.
function linkEntityType(
  link: NotificationLink,
): ManualNotificationLink['entityType'] {
  if (link instanceof Document) return 'document';
  if (link instanceof Channel) return 'channel';
  if (link instanceof Chat) return 'chat';
  if (link instanceof Project) return 'project';
  if (link instanceof EmailThread) return 'email_thread';
  if (link instanceof AgentSession) return 'agent_session';
  if (link instanceof Routine) return 'scheduled_action';
  if (link instanceof Database) return 'database';
  return 'form';
}

/**
 * @routing Use when reading the user's notifications or marking them seen, or when sending a notification to report a finished job or something that needs attention; not sending messages.
 */
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

  /**
   * Notify yourself, or someone who can already see `link`, that work finished or needs attention; post a message instead when a reply is expected.
   *
   * Routines should use this to report back. It is delivered like any other
   * notification (in-app, desktop and phone push) and respects the
   * recipient's notification preferences, so it may not reach them. Sends are
   * rate limited per sender.
   *
   * @example
   * ```ts
   * const doc = macro.documents.byId(docId);
   * await macro.notifications.send({
   *   title: 'Weekly report is ready',
   *   body: '3 new leads this week.',
   *   link: doc,
   * });
   * ```
   */
  async send(options: SendNotificationOptions): Promise<void> {
    unwrap(
      await this.client.notification.sendManualNotification({
        body: {
          title: options.title,
          body: options.body,
          link: linkReference(options.link),
          recipientId: options.to?.id,
        },
      }),
    );
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
