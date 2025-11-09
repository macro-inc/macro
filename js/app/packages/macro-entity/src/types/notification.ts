// Temporarily use the generated types for now
import type { UserNotification } from 'service-notification/generated/schemas/userNotification';
import type { Accessor } from 'solid-js';

export type Notification = Omit<UserNotification, 'ownerId'>;

export type WithNotification<T> = T & {
  notifications?: Accessor<Notification[]>;
};
