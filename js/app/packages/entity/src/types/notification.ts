import type { ApiUserNotification } from '@service-notification/generated/schemas/apiUserNotification';
import type { Accessor } from 'solid-js';

export type Notification = Omit<ApiUserNotification, 'owner_id'>;

export type WithNotification<T> = T & {
  notifications?: Accessor<Notification[]>;
};

/**
 * Extended notification type that includes stacked notifications for bulk operations.
 * When clicking a stacked notification row, this array contains all notifications in the stack
 * so they can be bulk-marked as done.
 */
type WithStackedNotifications<T> = T & {
  stackedNotifications?: Notification[];
};

export const isWithNotification = <T extends {} = {}>(
  item: T
): item is WithNotification<T> => {
  return 'notifications' in item && typeof item.notifications === 'function';
};

const _isWithStackedNotifications = <T extends {} = {}>(
  item: T
): item is WithStackedNotifications<T> => {
  return (
    'stackedNotifications' in item && Array.isArray(item.stackedNotifications)
  );
};
