import type { NotificationState } from '@service-notification/generated/schemas/notificationState';
import { match } from 'ts-pattern';

export type NotificationAction = 'MARK_SEEN' | 'MARK_DONE' | 'MARK_UNDONE';

/** Mirror the domain transition policy for local optimistic overlays. */
export function nextNotificationState(
  state: NotificationState,
  action: NotificationAction
): NotificationState {
  return match(action)
    .with('MARK_DONE', () => 'done' as const)
    .with('MARK_UNDONE', () => (state === 'done' ? 'seen' : state))
    .with('MARK_SEEN', () => (state === 'unseen' ? 'seen' : state))
    .exhaustive();
}

/** Convert the GraphQL wire enum without inferring anything from timestamps. */
export function notificationStateFromGraphql(
  state: 'UNSEEN' | 'SEEN' | 'DONE'
): NotificationState {
  return match(state)
    .with('UNSEEN', () => 'unseen' as const)
    .with('SEEN', () => 'seen' as const)
    .with('DONE', () => 'done' as const)
    .exhaustive();
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
