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
