import { type Span, Telemetry } from '@macro-inc/observability';

type Target = { channelId: string; messageId: string };
let active: { notificationId: string; target?: Target; span: Span } | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;

/** A notification open outlives the native callback and ends at target positioning. */
export function startNotificationOpen(
  notificationId: string,
  target?: Target,
  receivedAtMs?: number,
  deliveryId?: string
): void {
  endNotificationOpen('superseded');
  const span = Telemetry.span('notification.open');
  span.setAttr('notification.id', notificationId);
  span.setAttr('notification.direct_target', !!target);
  if (deliveryId) span.setAttr('notification.delivery_id', deliveryId);
  if (target) {
    span.setAttr('channel.id', target.channelId);
    span.setAttr('message.id', target.messageId);
  }
  if (receivedAtMs !== undefined) {
    span.setAttr(
      'notification.native_handoff_ms',
      Math.max(0, Date.now() - receivedAtMs)
    );
  }
  active = { notificationId, target, span };
  timeout = setTimeout(() => endNotificationOpen('target_not_visible'), 60_000);
}

export function notificationOpenSpan(notificationId: string): Span | undefined {
  return active?.notificationId === notificationId ? active.span : undefined;
}

export function notificationTargetSpan(
  channelId: string,
  messageId: string
): Span | undefined {
  return active?.target?.channelId === channelId &&
    active.target.messageId === messageId
    ? active.span
    : undefined;
}

export function markNotificationTargetVisible(
  channelId: string,
  messageId: string
): void {
  if (!notificationTargetSpan(channelId, messageId)) return;
  active?.span.event('notification.target_visible');
  endNotificationOpen('visible');
}

export function endNotificationOpen(outcome: string): void {
  clearTimeout(timeout);
  active?.span.setAttr('notification.outcome', outcome);
  active?.span.end();
  active = undefined;
}
