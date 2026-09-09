import type { NotificationState } from '@service-notification/generated/schemas/notificationState';

/** Compile persisted UI filter intent into exact backend lifecycle states. */
export function notificationStatesForFilter(
  kind: 'done' | 'seen',
  value: unknown
): NotificationState[] {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid notification ${kind} filter`);
  }
  if (kind === 'done') return value ? ['done'] : ['unseen', 'seen'];
  return value ? ['seen', 'done'] : ['unseen'];
}
