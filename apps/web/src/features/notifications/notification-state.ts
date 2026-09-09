import type { NotificationState } from '@service-notification/generated/schemas/notificationState';

export type NotificationAction = 'MARK_SEEN' | 'MARK_DONE' | 'MARK_UNDONE';

/** Mirror the domain transition policy for local optimistic overlays. */
export function nextNotificationState(
  state: NotificationState,
  action: NotificationAction
): NotificationState {
  if (action === 'MARK_DONE') return 'done';
  if (action === 'MARK_UNDONE') return state === 'done' ? 'seen' : state;
  return state === 'unseen' ? 'seen' : state;
}

/** Convert the GraphQL wire enum without inferring anything from timestamps. */
export function notificationStateFromGraphql(
  state: 'UNSEEN' | 'SEEN' | 'DONE'
): NotificationState {
  if (state === 'UNSEEN') return 'unseen';
  if (state === 'SEEN') return 'seen';
  return 'done';
}

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
