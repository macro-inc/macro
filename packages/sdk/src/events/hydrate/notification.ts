import { match } from 'ts-pattern';
import { Notification } from '../../entities/notifications/notification';
import { User } from '../../entities/users/user';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type NotificationEvent = Extract<
  MacroEvent,
  { event_type: `notification.${string}` }
>;

/** Attach notification and sender handles to a notification event. */
export function hydrateNotificationEvent(
  client: MacroClient,
  event: NotificationEvent,
) {
  return match(event)
    .with({ event_type: 'notification.created' }, ({ metadata }) => ({
      event_type: 'notification.created' as const,
      metadata,
      notification: Notification.byId(client, metadata.notification_id),
      sender: metadata.sender_id
        ? User.byId(client, metadata.sender_id)
        : undefined,
    }))
    .with({ event_type: 'notification.updated' }, ({ metadata }) => ({
      event_type: 'notification.updated' as const,
      metadata,
    }))
    .exhaustive((unknown) => {
      console.warn('macro sdk: unknown notification event', unknown);
      return undefined;
    });
}
