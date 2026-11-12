import { fireAndForget } from '@core/util/fireAndForget';
import { normalizeNameText } from '@core/util/name-match-score';
import type { CacheHost } from '@graphql-cache/host/types';
import { MAX_PEOPLE_BATCH } from '@graphql-cache/people/generated';
import { hashKey, queryOptions, useQuery } from '@tanstack/solid-query';
import { CombinedError } from '@urql/core';
import {
  type Accessor,
  createEffect,
  createMemo,
  createUniqueId,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import { queryReadyGate } from '../gate';
import { subscribeToVisibleCacheChanges } from '../subscribe-to-visible-cache-changes';
import { loadContactCheckpoint } from './backfill';
import { ContactDirectoryScopeError } from './cache-scope';
import { contactsKeys } from './keys';
import { createContactQueryEpoch } from './query-epoch';
import {
  type ContactReferenceReader,
  createContactReferenceReader,
} from './reference-reader';
import type {
  ContactReferenceHost,
  ContactReferenceRequest,
} from './references';

type ReferenceHost = ContactReferenceHost &
  Pick<CacheHost, 'onCacheChanged' | 'onCacheGenerationChanged'>;

function referenceOptions(
  owner: string,
  userId: string | undefined,
  host: ReferenceHost | undefined,
  epoch: number,
  input: ContactReferenceRequest,
  reader: ContactReferenceReader
) {
  return queryOptions({
    queryKey: contactsKeys.references(
      owner,
      userId ?? '',
      host?.clientId ?? 'network',
      epoch,
      input
    ).queryKey,
    enabled: !!userId && input.labels.length > 0,
    queryFn: async ({ signal }) => {
      if (!userId) throw new Error('Contact references require authentication');
      const resolved = await reader(userId, host, input, signal);
      return {
        userId,
        hostId: host?.clientId,
        epoch,
        inputKey: hashKey([input]),
        resolved,
      };
    },
    gcTime: 0,
    staleTime: 0,
    retry: false,
    networkMode: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

/** One current inference input, not a retained directory or per-query history. */
export function createContactReferenceSource(
  scope: Accessor<{ userId?: string; host?: ReferenceHost }>,
  request: Accessor<ContactReferenceRequest>,
  enabled: Accessor<boolean> = () => true,
  read?: ContactReferenceReader
) {
  const owner = createUniqueId();
  const reader = createContactReferenceReader(read);
  let active = true;
  let waking = false;
  onCleanup(() => {
    active = false;
    reader.dispose();
  });
  const { epoch } = createContactQueryEpoch(scope);
  const input = createMemo<ContactReferenceRequest>(() => {
    const value = request();
    return {
      labels: value.labels.slice(0, MAX_PEOPLE_BATCH + 1),
      matching: value.matching,
      excludeSecondaryInboxes: value.excludeSecondaryInboxes,
      secondaryInboxIds: value.secondaryInboxIds
        ? [...value.secondaryInboxIds].sort()
        : undefined,
    };
  });
  const query = useQuery(() =>
    referenceOptions(
      owner,
      enabled() ? scope().userId : undefined,
      scope().host,
      epoch(),
      input(),
      reader.read
    )
  );
  const data = () => {
    const error = query.error;
    // GraphQL/HTTP rejections are not offline evidence for automatic resolution.
    if (
      !enabled() ||
      error instanceof ContactDirectoryScopeError ||
      (error instanceof CombinedError &&
        (error.graphQLErrors.length || error.response)) ||
      !queryReadyGate(query)
    )
      return;
    const value = query.data;
    if (
      value.userId !== scope().userId ||
      value.hostId !== scope().host?.clientId ||
      value.epoch !== epoch() ||
      value.inputKey !== hashKey([input()])
    )
      return;
    return value.resolved;
  };
  const byLabel = createMemo(() => {
    const result = data();
    return new Map(
      input().labels.flatMap((label, index) => {
        const entry = result?.matches[index];
        return entry ? [[normalizeNameText(label), entry] as const] : [];
      })
    );
  });

  // Only a readiness transition wakes an incomplete read. Do not send HTTP
  // lookups or full scans for every background hydration page.
  async function wake() {
    if (!active || waking || query.isFetching || !enabled()) return;
    const result = untrack(data);
    const native = result?.native ? { ...result.native } : undefined;
    if (!native?.supported || !result?.matches.some((entry) => !entry.complete))
      return;
    const current = untrack(scope);
    if (!current.userId || !current.host?.people || current.host.disabled)
      return;
    const generation = untrack(epoch);
    const key = hashKey([untrack(input)]);
    waking = true;
    try {
      const completedAt = loadContactCheckpoint(
        current.userId,
        native.generation
      ).completedAt;
      let ready = completedAt !== null && completedAt !== native.completedAt;
      if (!ready && native.contextPending) {
        const context = await current.host.people.context({
          identity: current.userId,
          storageGeneration: native.generation,
        });
        ready = context.kind === 'ready';
      }
      const latest = untrack(data)?.native;
      if (
        !ready ||
        !active ||
        !enabled() ||
        query.isFetching ||
        untrack(epoch) !== generation ||
        scope().userId !== current.userId ||
        scope().host !== current.host ||
        hashKey([untrack(input)]) !== key ||
        latest?.generation !== native.generation ||
        latest.completedAt !== native.completedAt ||
        latest.contextPending !== native.contextPending
      )
        return;
      await query.refetch({ cancelRefetch: false });
    } finally {
      waking = false;
    }
  }
  createEffect(() => {
    const host = scope().host;
    if (host)
      onCleanup(
        subscribeToVisibleCacheChanges(host, wake, {
          searchBuckets: () => ['person'],
        })
      );
  });
  createEffect(
    on(
      () => query.isFetching,
      (fetching) => {
        if (!fetching) fireAndForget(wake(), 'contact-reference-readiness');
      }
    )
  );
  return {
    data,
    lookup: (label: string) => {
      if (query.error) return;
      const result = byLabel().get(normalizeNameText(label));
      return result?.complete ? result.people : undefined;
    },
    ready: () =>
      input().labels.length === 0 ||
      (!query.error && !!data()?.matches.every((entry) => entry.complete)),
    loading: () => query.isFetching,
    error: () => query.error,
    retry: () => query.refetch({ cancelRefetch: false }),
  };
}
