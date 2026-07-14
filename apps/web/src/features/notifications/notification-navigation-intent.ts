import { createSignal } from 'solid-js';

export const [
  pendingNotificationNavigationId,
  setPendingNotificationNavigationId,
] = createSignal<string | undefined>();

export function triggerNotificationNavigation(notificationId: string) {
  setPendingNotificationNavigationId(notificationId);
}
