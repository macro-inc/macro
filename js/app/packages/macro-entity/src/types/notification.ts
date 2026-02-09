// Temporarily use the generated types for now
import type { ApiUserNotification } from '@service-notification/generated/schemas/apiUserNotification';
import type { Accessor } from 'solid-js';

export type Notification = Omit<ApiUserNotification, 'ownerId'>;

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
