import { getChannelParams } from '@channel/Channel/link';
import { fireAndForget } from '@core/util/fireAndForget';
import { pushNotificationNavigation } from '@service-notification/generated/push';
import type { PushNotificationNavigation } from '@service-notification/generated/schemas/pushNotificationNavigation';
import { createSignal } from 'solid-js';
import {
  endNotificationOpen,
  notificationOpenSpan,
  startNotificationOpen,
} from './notification-open-trace';

export type NotificationNavigationIntent = {
  notificationId: string;
  recipientId?: string;
  target?: PushNotificationNavigation;
  deliveryId?: string;
  receivedAtMs?: number;
  acknowledge?: () => Promise<void>;
};

export const [pendingNotificationNavigation, setPendingNotificationNavigation] =
  createSignal<NotificationNavigationIntent>();
let acknowledgedDeliveryId: string | undefined;
let latestReceiptMs: number | undefined;
let completing: NotificationNavigationIntent | undefined;
let completion:
  | { intent: NotificationNavigationIntent; outcome: string }
  | undefined;

export const pendingNotificationNavigationId = () =>
  pendingNotificationNavigation()?.notificationId;

export function setPendingNotificationNavigationId(
  notificationId: string | undefined
): void {
  if (!notificationId) {
    latestReceiptMs = undefined;
    acknowledgedDeliveryId = undefined;
    completion = undefined;
  }
  setPendingNotificationNavigation(
    notificationId ? { notificationId } : undefined
  );
}

export function triggerNotificationNavigation(notificationId: string): void {
  startNotificationOpen(notificationId);
  setPendingNotificationNavigationId(notificationId);
}

/** The native iOS bridge JSON-encodes nested APNs values; Android can send objects. */
export function notificationIntentFromPayload(
  payload: Record<string, unknown>
): NotificationNavigationIntent | undefined {
  const notificationId = payload.notificationId;
  if (typeof notificationId !== 'string' || !notificationId) return;
  const recipientId =
    typeof payload.recipientId === 'string' && payload.recipientId
      ? payload.recipientId
      : undefined;
  let navigation = payload.navigation;
  if (typeof navigation === 'string') {
    try {
      navigation = JSON.parse(navigation);
    } catch {
      navigation = undefined;
    }
  }
  const parsed = pushNotificationNavigation.safeParse(navigation);
  // Direct destinations must be bound to an account. Old/malformed pushes
  // still use the authenticated notification lookup.
  return {
    notificationId,
    recipientId,
    target: recipientId && parsed.success ? parsed.data : undefined,
  };
}

/** Return true when receipt acknowledgment belongs to navigation, not delivery. */
export function receiveNotificationTap(
  event: {
    type: string;
    payload: Record<string, unknown>;
    deliveryId?: string;
    receivedAtMs?: number;
  },
  acknowledge: (deliveryId: string) => Promise<void>
): boolean {
  if (event.type !== 'BACKGROUND_TAP' && event.type !== 'FOREGROUND_TAP')
    return false;
  const intent = notificationIntentFromPayload(event.payload);
  if (!intent) return false;
  if (event.deliveryId && event.deliveryId === acknowledgedDeliveryId)
    return false;
  if (
    event.deliveryId &&
    event.deliveryId === pendingNotificationNavigation()?.deliveryId
  ) {
    if (completion)
      finishNotificationNavigation(completion.intent, completion.outcome);
    return true;
  }
  if (
    event.receivedAtMs !== undefined &&
    latestReceiptMs !== undefined &&
    event.receivedAtMs < latestReceiptMs
  )
    return false;
  latestReceiptMs = event.receivedAtMs ?? latestReceiptMs;
  completion = undefined;
  const deliveryId = event.deliveryId;
  startNotificationOpen(
    intent.notificationId,
    intent.target,
    event.receivedAtMs,
    deliveryId
  );
  setPendingNotificationNavigation({
    ...intent,
    deliveryId,
    receivedAtMs: event.receivedAtMs,
    acknowledge: deliveryId ? () => acknowledge(deliveryId) : undefined,
  });
  return true;
}

/** Select the first route only after the session's actual account is known. */
export function notificationLaunchPath(
  recipientId: string
): string | undefined {
  const intent = pendingNotificationNavigation();
  if (!intent?.target || intent.recipientId !== recipientId) return;
  const { channelId, messageId, threadId } = intent.target;
  const params = new URLSearchParams(
    getChannelParams(messageId, threadId ?? messageId)
  );
  return `/channel/${encodeURIComponent(channelId)}?${params}`;
}

export function finishNotificationNavigation(
  intent: NotificationNavigationIntent,
  outcome = 'applied'
): void {
  if (pendingNotificationNavigation() !== intent) return;
  if (completing === intent) return;
  completion = { intent, outcome };
  const complete = () => {
    if (pendingNotificationNavigation() !== intent) return;
    acknowledgedDeliveryId = intent.deliveryId;
    notificationOpenSpan(intent.notificationId)?.event(
      'notification.route_applied'
    );
    if (outcome !== 'applied' || !intent.target) endNotificationOpen(outcome);
    setPendingNotificationNavigation(undefined);
    completion = undefined;
  };
  if (!intent.acknowledge) {
    complete();
    return;
  }
  const finish = async () => {
    completing = intent;
    try {
      await intent.acknowledge?.();
      complete();
    } finally {
      if (completing === intent) completing = undefined;
    }
  };
  fireAndForget(finish(), 'notification-navigation');
}
