import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import {
  RegisteredWorkDocument,
  RegisteredWorkUpdatesDocument,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { pipe, subscribe } from 'wonka';
import {
  sortWorkItems,
  type WorkItem,
  workItemFromEntry,
} from '../core/work-item';

const RESUBSCRIBE_DELAY_MS = 3_000;

/**
 * Live registered work for a set of accounts. It follows the stream before
 * reading, so nothing committed during the read is missed, and reads again
 * whenever the stream says changes may have been missed.
 */
export function createRegisteredWork(options: {
  client: Accessor<Client>;
  accountIds: Accessor<readonly string[]>;
  enabled: Accessor<boolean>;
  /** Subscribes to transport reconnects, after which changes may be missed. */
  onReconnected: (listener: () => void) => () => void;
}) {
  const [items, setItems] = createSignal<ReadonlyMap<string, WorkItem>>(
    new Map()
  );
  const [loaded, setLoaded] = createSignal(false);
  const key = createMemo(() =>
    options.enabled() ? [...options.accountIds()].sort().join(',') : ''
  );

  const follow = (accountIds: string[], client: Client) => {
    let latestRead = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopStream: (() => void) | undefined;
    let disposed = false;

    const read = async () => {
      const readId = ++latestRead;
      const result = await Telemetry.span(
        'agent_work.read',
        { attributes: { 'agent_work.account_count': accountIds.length } },
        () =>
          client
            .query(
              RegisteredWorkDocument,
              { accountIds },
              { requestPolicy: 'network-only' }
            )
            .toPromise()
      );
      if (disposed || readId !== latestRead) return;

      const entries = result.data?.user.registeredWork;
      if (!entries) return;

      setItems(
        new Map(
          entries.map((entry) => [entry.id, workItemFromEntry(entry)] as const)
        )
      );
      setLoaded(true);
    };

    const startStream = () => {
      const { unsubscribe } = pipe(
        client.subscription(RegisteredWorkUpdatesDocument, { accountIds }),
        subscribe((result) => {
          if (result.error) {
            stopStream?.();
            retry = setTimeout(startStream, RESUBSCRIBE_DELAY_MS);
            return;
          }

          const patches = result.data?.registeredWorkUpdates ?? [];
          if (patches.length === 0) return;

          let invalidated = false;
          const next = new Map(items());
          for (const patch of patches) {
            if (patch.__typename === 'GraphqlRegisteredWorkUpsert') {
              next.set(patch.entry.id, workItemFromEntry(patch.entry));
            } else if (patch.__typename === 'GraphqlRegisteredWorkRemove') {
              next.delete(patch.registrationId);
            } else {
              invalidated = true;
            }
          }

          setItems(next);
          if (invalidated) refresh();
        })
      );
      stopStream = unsubscribe;
    };

    const refresh = () => fireAndForget(read(), 'agent_work.read');

    startStream();
    refresh();
    const stopListening = options.onReconnected(refresh);

    return () => {
      disposed = true;
      clearTimeout(retry);
      stopStream?.();
      stopListening();
    };
  };

  createEffect(
    on([key, options.client], ([current, client], previous) => {
      if (current !== previous?.[0]) {
        setItems(new Map());
        setLoaded(false);
      }
      if (!current) return;

      onCleanup(follow(current.split(','), client));
    })
  );

  const byAccount = createMemo(() => {
    const grouped = new Map<string, WorkItem[]>();
    for (const item of sortWorkItems(items().values())) {
      const list = grouped.get(item.accountId);
      if (list) list.push(item);
      else grouped.set(item.accountId, [item]);
    }
    return grouped;
  });

  return {
    /** False until the first read lands, so existing work isn't announced. */
    loaded,
    byAccount,
    /** Accounts with work, in the order they were asked for. */
    accountsWithWork: createMemo(() =>
      options.accountIds().filter((id) => byAccount().has(id))
    ),
  };
}
