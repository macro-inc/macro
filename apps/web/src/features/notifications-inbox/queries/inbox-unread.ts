import { NotificationInboxUnreadUpdatesDocument } from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { pipe, subscribe } from 'wonka';
import type { InboxUnreadCount } from '../core/inbox-unread';
import { toRowType } from './decode';

const RESUBSCRIBE_DELAY_MS = 3_000;

/**
 * The unread rows of the viewer's whole inbox by kind, kept live.
 *
 * The server sends the current counts when the stream opens and again each
 * time they change, so there is nothing to read first and nothing to merge:
 * the latest payload is the answer. A stream that errors, or a transport
 * that reconnects, may have missed a change; opening the stream again
 * fetches the counts afresh.
 */
export function createInboxUnread(options: {
  client: Accessor<Client>;
  enabled: Accessor<boolean>;
  /** Subscribes to transport reconnects, after which changes may be missed. */
  onReconnected: (listener: () => void) => () => void;
}): Accessor<readonly InboxUnreadCount[] | undefined> {
  const [counts, setCounts] = createSignal<readonly InboxUnreadCount[]>();

  const follow = (client: Client) => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopStream: (() => void) | undefined;

    const startStream = () => {
      clearTimeout(retry);
      stopStream?.();
      const { unsubscribe } = pipe(
        client.subscription(NotificationInboxUnreadUpdatesDocument, {}),
        subscribe((result) => {
          if (result.error) {
            unsubscribe();
            retry = setTimeout(startStream, RESUBSCRIBE_DELAY_MS);
            return;
          }
          const payload = result.data?.notificationInboxUnreadUpdates;
          if (!payload) return;
          setCounts(
            payload.map((entry) => ({
              type: toRowType(entry.rowType),
              passwordRequests: entry.rowType === 'PASSWORD_ACCESS_REQUESTED',
              count: entry.count,
            }))
          );
        })
      );
      stopStream = unsubscribe;
    };

    startStream();
    const stopListening = options.onReconnected(startStream);

    return () => {
      clearTimeout(retry);
      stopStream?.();
      stopListening();
    };
  };

  createEffect(
    on([options.enabled, options.client], ([enabled, client]) => {
      // Counts belong to the session that read them.
      setCounts(undefined);
      if (!enabled) return;
      onCleanup(follow(client));
    })
  );

  return counts;
}
