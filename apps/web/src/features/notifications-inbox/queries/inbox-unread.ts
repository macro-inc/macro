import {
  type NotificationInboxRowType,
  NotificationInboxUnreadUpdatesDocument,
  NotificationInboxUnreadUpdatesWithoutChatDocument,
} from '@service-storage/graphql/generated/graphql';
import type { Client, CombinedError, DocumentInput } from '@urql/core';
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

const CHAT_COUNT_REFUSED = /(?:Cannot query|Unknown) field ["']chatCount["']/;

/** Whether the server is from before `chatCount`. */
const refusesChatCount = (error: CombinedError): boolean =>
  error.graphQLErrors.some(({ message }) => CHAT_COUNT_REFUSED.test(message));

/**
 * The latest counts each client delivered. urql shares one subscription
 * among every reader of it on a client and replays nothing to a reader that
 * joins later, so a reader mounted after the stream opened would wait for
 * the next change; it starts from these instead.
 */
const latestCounts = new WeakMap<Client, readonly InboxUnreadCount[]>();

type UnreadUpdatesDocument = DocumentInput<
  {
    notificationInboxUnreadUpdates: readonly {
      rowType: NotificationInboxRowType;
      count: number;
      chatCount?: number;
    }[];
  },
  Record<string, never>
>;

/**
 * The unread rows of the viewer's whole inbox by kind, kept live.
 *
 * The server sends the current counts when the stream opens and again each
 * time they change, so there is nothing to read first and nothing to merge:
 * the latest payload is the answer. A stream that errors, or a transport
 * that reconnects, may have missed a change; opening the stream again
 * fetches the counts afresh.
 *
 * The web app can go live before the new server tasks serve, and a server
 * can be rolled back under it. One that refuses `chatCount` is asked for the
 * counts without it, until the next time the stream opens.
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

    const openStream = (document: UnreadUpdatesDocument) => {
      clearTimeout(retry);
      stopStream?.();
      const { unsubscribe } = pipe(
        client.subscription(document, {}),
        subscribe((result) => {
          if (result.error) {
            unsubscribe();
            if (
              document === NotificationInboxUnreadUpdatesDocument &&
              refusesChatCount(result.error)
            ) {
              openStream(NotificationInboxUnreadUpdatesWithoutChatDocument);
              return;
            }
            retry = setTimeout(startStream, RESUBSCRIBE_DELAY_MS);
            return;
          }
          const payload = result.data?.notificationInboxUnreadUpdates;
          if (!payload) return;
          const next = payload.map((entry) => ({
            type: toRowType(entry.rowType),
            passwordRequests: entry.rowType === 'PASSWORD_ACCESS_REQUESTED',
            count: entry.count,
            chatCount: entry.chatCount,
          }));
          latestCounts.set(client, next);
          setCounts(next);
        })
      );
      stopStream = unsubscribe;
    };
    const startStream = () =>
      openStream(NotificationInboxUnreadUpdatesDocument);

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
      if (!enabled) {
        latestCounts.delete(client);
        return;
      }
      setCounts(latestCounts.get(client));
      onCleanup(follow(client));
    })
  );

  return counts;
}
