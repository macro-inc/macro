import { setSubscriptionCacheTrace } from '@graphql-cache/exchange/subscription-cache-trace';
import { type Span, Telemetry } from '@macro-inc/observability';
import { createRequest, type Exchange } from '@urql/core';
import { pipe, tap } from 'wonka';
import {
  NotificationUpdatesDocument,
  type NotificationUpdatesSubscription,
} from './graphql/generated/graphql';
import type { GraphqlNotificationPatch } from './graphql-soup-websocket';

const NOTIFICATION_UPDATES_KEY = createRequest(
  NotificationUpdatesDocument,
  {}
).key;

/**
 * Place after the normalized-cache exchange (toward the transport). Notification
 * callbacks must receive live events before cache writes, which wait while every
 * browser tab is hidden. Cache-dependent subscribers still await ordered writes.
 */
export function notificationReceiptExchange(
  onPatch: (patch: GraphqlNotificationPatch, span: Pick<Span, 'error'>) => void
): Exchange {
  return ({ forward }) =>
    (operations) =>
      pipe(
        forward(operations),
        tap((result) => {
          if (
            result.operation.kind !== 'subscription' ||
            result.operation.key !== NOTIFICATION_UPDATES_KEY ||
            result.data == null
          ) {
            return;
          }
          const patch = (result.data as NotificationUpdatesSubscription)
            .notificationUpdates;
          if (!patch) return;
          const span = Telemetry.span('notification.receive');
          span.setAttr('notification.patch_type', patch.__typename);
          span.setAttr('notification.visibility', document.visibilityState);
          if (
            patch.__typename === 'GraphqlNewNotification' ||
            patch.__typename === 'GraphqlUpdatedNotification'
          ) {
            span.setAttr('notification.id', patch.notification.id);
          }
          setSubscriptionCacheTrace(result, span);
          try {
            span.run(() => onPatch(patch, span));
          } catch (error) {
            // An alert callback must not stop cache persistence or later events.
            span.error(error);
            Telemetry.error(error, { surface: 'graphql-notifications' });
          } finally {
            span.end();
          }
        })
      );
}
