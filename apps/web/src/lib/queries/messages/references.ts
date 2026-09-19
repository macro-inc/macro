import { createReconnectEffect } from '@macro-inc/collaboration/websocket';
import {
  createConnectionWebsocketEffect,
  ws,
} from '@service-connection/websocket';
import { parseWebsocketPayload } from '@service-connection/websocket-payload';
import type { MessageEvent } from '@service-storage/generated/schemas/messageEvent';
import type { ReferencedThread } from '@service-storage/generated/schemas/referencedThread';
import {
  entityMessagesClient,
  type MessageCursor,
  type MessageParent,
} from '@service-storage/messages';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { messageKeys } from './keys';

/**
 * Channel membership changes and mentions in channels this client does not
 * track reach it through no live frame, so discovery also polls while shown.
 */
const REFERENCE_REFRESH_INTERVAL_MS = 30_000;

/** Source changes that can add or remove a discovered thread; typing and reactions cannot. */
const DISCOVERY_CHANGES: ReadonlySet<MessageEvent['change']['type']> = new Set([
  'posted',
  'edited',
  'message_deleted',
  'thread_updated',
]);

/** The server pages authorized identities; the Discussion shows the whole set. */
async function fetchReferencedThreads(parent: MessageParent) {
  const threads: ReferencedThread[] = [];
  let cursor: MessageCursor | null | undefined;
  do {
    const page = await entityMessagesClient.references(parent, cursor);
    threads.push(...page.threads);
    cursor = page.next_cursor;
  } while (cursor);
  return threads;
}

/** Optional, permission-filtered source threads; source messages remain channel-owned. */
export function useChannelReferenceThreadsQuery(
  parent: Accessor<MessageParent>,
  enabled: Accessor<boolean>
) {
  const queryKey = () => messageKeys.references(parent()).queryKey;
  const query = useQuery(() => ({
    queryKey: queryKey(),
    enabled: enabled() && parent().type === 'document',
    refetchInterval: enabled() ? REFERENCE_REFRESH_INTERVAL_MS : false,
    queryFn: () => fetchReferencedThreads(parent()),
  }));
  const invalidate = () => {
    if (!enabled()) return;
    void queryClient.invalidateQueries({ queryKey: queryKey() });
  };
  createConnectionWebsocketEffect((frame) => {
    if (frame.type !== 'message_update') return;
    const event = parseWebsocketPayload<MessageEvent>(frame.type, frame.data);
    if (
      event?.parent?.type === 'channel' &&
      DISCOVERY_CHANGES.has(event.change?.type)
    )
      invalidate();
  });
  createReconnectEffect(ws, invalidate);
  return query;
}
