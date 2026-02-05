// Temporarily use the generated types for now
import type { UserNotification } from '@service-notification/generated/schemas/userNotification';
import type { Accessor } from 'solid-js';

export type Notification = Omit<UserNotification, 'ownerId'>;

export type WithNotification<T> = T & {
  notifications?: Accessor<Notification[]>;
};

/**
 * Extended notification type that includes stacked notifications for bulk operations.
 * When clicking a stacked notification row, this array contains all notifications in the stack
 * so they can be bulk-marked as done.
 */
export type WithStackedNotifications<T> = T & {
  stackedNotifications?: Notification[];
};

export const isWithNotification = <T extends {} = {}>(
  item: T
): item is WithNotification<T> => {
  return 'notifications' in item && typeof item.notifications === 'function';
};

export const isWithStackedNotifications = <T extends {} = {}>(
  item: T
): item is WithStackedNotifications<T> => {
  return (
    'stackedNotifications' in item && Array.isArray(item.stackedNotifications)
  );
};
