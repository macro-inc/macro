import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import type { ListLinksResponse } from '@service-email/generated/schemas';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import type { ApiActivity } from '@service-storage/generated/schemas/apiActivity';
import { useQuery } from '@tanstack/solid-query';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from 'solid-js';
import type { QueryAccount } from '../auth/account-scope';
import { channelActivityQueryOptions } from '../channel/activity';
import {
  cachedGraphqlChannelsQueryOptions,
  listChannelsQueryOptions,
} from '../channel/channels';
import type { CachedGraphqlChannel } from '../channel/graphql';
import { emailLinksQueryOptions } from '../email/link';
import { queryReadyGate } from '../gate';
import { subscribeToVisibleCacheChanges } from '../subscribe-to-visible-cache-changes';
import { buildContactContextFacts } from './context-facts';

// Selectors capture resolved ownership. Retained data from an old observer/key
// can never be relabeled with the current account during Solid reconciliation.
function channelsOptions(account: QueryAccount | undefined, enabled: boolean) {
  return {
    ...listChannelsQueryOptions(account, enabled),
    select: (rows: ApiChannelWithLatest[]) => ({ account, rows }),
  };
}
function activityOptions(account: QueryAccount | undefined, enabled: boolean) {
  return {
    ...channelActivityQueryOptions(account, enabled),
    select: (rows: ApiActivity[]) => ({ account, rows }),
  };
}
function linksOptions(account: QueryAccount | undefined, enabled: boolean) {
  return {
    ...emailLinksQueryOptions(account, enabled),
    select: (rows: ListLinksResponse) => ({ account, rows }),
  };
}
function cachedOptions(
  account: QueryAccount | undefined,
  host: CacheHost | undefined,
  generation: number,
  enabled: boolean
) {
  return {
    ...cachedGraphqlChannelsQueryOptions(host, account, generation),
    enabled: enabled && !!host && !!account,
    select: (rows: CachedGraphqlChannel[]) => ({ account, generation, rows }),
  };
}
function sameAccount(a: QueryAccount | undefined, b: QueryAccount): boolean {
  return a?.userId === b.userId && a.session === b.session;
}

/** Additional observers reuse existing keyed queries; no contact-directory read.
 * Reads are status-gated so background publishing cannot suspend the app shell. */
export function createContactContextSource(options: {
  account: Accessor<QueryAccount | undefined>;
  host: Accessor<CacheHost | undefined>;
  generation: Accessor<number>;
  enabled: Accessor<boolean>;
}) {
  const channels = useQuery(() =>
    channelsOptions(options.account(), options.enabled())
  );
  const activity = useQuery(() =>
    activityOptions(options.account(), options.enabled())
  );
  const links = useQuery(() =>
    linksOptions(options.account(), options.enabled())
  );
  const cached = useQuery(() =>
    cachedOptions(
      options.account(),
      options.host(),
      options.generation(),
      options.enabled()
    )
  );
  createEffect(
    on([options.host, options.enabled], ([host, enabled]) => {
      if (!host || !enabled) return;
      onCleanup(
        subscribeToVisibleCacheChanges(
          host,
          () => cached.refetch({ cancelRefetch: false }),
          { searchBuckets: () => ['channel', 'dm'] }
        )
      );
    })
  );
  return createMemo(() => {
    const account = options.account();
    if (
      !options.enabled() ||
      !account ||
      !queryReadyGate(channels) ||
      !queryReadyGate(activity) ||
      !queryReadyGate(links)
    )
      return;
    const c = channels.data;
    const a = activity.data;
    const l = links.data;
    if (
      !sameAccount(c.account, account) ||
      !sameAccount(a.account, account) ||
      !sameAccount(l.account, account)
    )
      return;
    const overlay = queryReadyGate(cached) ? cached.data : undefined;
    const span = Telemetry.span('contacts.context.derive');
    span.setAttr('contacts.channel_count', c.rows.length);
    try {
      const facts = buildContactContextFacts({
        viewer: account.userId,
        channels: c.rows,
        activity: a.rows,
        links: l.rows.links,
        cachedChannels:
          overlay &&
          sameAccount(overlay.account, account) &&
          overlay.generation === options.generation()
            ? overlay.rows
            : [],
      });
      span.setAttr('contacts.context_count', facts.size);
      return facts;
    } finally {
      span.end();
    }
  });
}
