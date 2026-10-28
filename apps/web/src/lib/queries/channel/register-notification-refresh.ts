import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import { type Client, createRequest } from '@urql/core';
import { createEffect, on, onCleanup, untrack } from 'solid-js';
import {
  type ChannelNotificationReader,
  channelNotificationRefresh,
} from './notification-refresh';

/** Syncs Solid query lifetimes with the client's imperative refresh queue. */
export function registerChannelNotificationRefresh(
  options: () => {
    client: Pick<Client, 'query'>;
    queries: readonly QueryRevalidation[];
    reader: ChannelNotificationReader;
  }
) {
  let client: Pick<Client, 'query'> | undefined;
  const registrations = new Map<
    number,
    { reader: ChannelNotificationReader; dispose: () => void }
  >();
  const clear = () => {
    for (const registration of registrations.values()) registration.dispose();
    registrations.clear();
  };
  createEffect(
    on(options, (next) => {
      if (client !== next.client) clear();
      client = next.client;
      const coordinator = channelNotificationRefresh(client);
      const keys = new Set<number>();
      for (const query of next.queries) {
        const key = createRequest(query.document, query.variables).key;
        keys.add(key);
        const existing = registrations.get(key);
        if (existing) Object.assign(existing.reader, next.reader);
        else {
          const reader = { ...next.reader };
          registrations.set(key, {
            reader,
            dispose: coordinator.register(query, reader),
          });
        }
      }
      for (const [key, registration] of registrations) {
        if (keys.has(key)) continue;
        registration.dispose();
        registrations.delete(key);
      }
      coordinator.changed();
    })
  );
  onCleanup(clear);
  return () => {
    const next = untrack(options);
    return channelNotificationRefresh(next.client).refresh(next.queries);
  };
}
