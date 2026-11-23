import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  type EntityLoadError,
  toEntityLoadError,
} from '@core/component/EntityLoadGate';
import { enableChannelLocalSync } from '@core/constant/featureFlags';
import type { CacheHost } from '@graphql-cache/index';
import {
  getGraphqlSoupCacheHost,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import type {
  MessageParent,
  MessageTimelineEntry,
} from '@service-storage/messages';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { queryClient } from '../client';
import { queryReadyGate } from '../gate';
import { channelCacheSupported } from './local/channel-flag';
import {
  channelSyncRuntime,
  channelTouches,
  channelWrites,
} from './local/channel-sync';
import {
  createLocalChannelTimeline,
  type LocalChannelTimeline,
} from './local/channel-timeline';
import {
  getMessageTimelineQueryKey,
  isMissingMessageError,
  type MessageTimelineData,
  useMessageTimelineQuery,
} from './timeline';

/** Where a channel's timeline is read from for this mount. */
export type ChannelTimelineMode = 'local' | 'rest';

/**
 * A parent's message timeline, whichever path reads it: the device for
 * channels under `enable-channel-local-sync`, REST and TanStack otherwise.
 * Reads never suspend.
 */
export interface ChannelTimelineSource {
  mode: Accessor<ChannelTimelineMode>;
  /** The loaded timeline as one newest-first page, or undefined while none. */
  data: Accessor<MessageTimelineData | undefined>;
  /** The newest loaded entry. */
  latestEntry: Accessor<MessageTimelineEntry | undefined>;
  isLoading: Accessor<boolean>;
  /** No timeline yet, loading or not. */
  isPending: Accessor<boolean>;
  /** A timeline is loaded. */
  isReady: Accessor<boolean>;
  /** The first load's failure; a failed page keeps what is shown. */
  loadError: Accessor<EntityLoadError | undefined>;
  /** The message the timeline was asked to centre on does not exist. */
  isMissingTarget: Accessor<boolean>;
  hasOlder: Accessor<boolean>;
  hasNewer: Accessor<boolean>;
  isLoadingOlder: Accessor<boolean>;
  isLoadingNewer: Accessor<boolean>;
  loadOlder(): Promise<void>;
  loadNewer(): Promise<void>;
  retry(): Promise<void>;
  /**
   * Loads the live end again, for a caller that knows it is not shown;
   * resolves once it is loaded and rejects when it fails.
   */
  toLatest(): Promise<void>;
}

function restSource(
  parent: Accessor<MessageParent>,
  aroundMessageId: Accessor<string | null | undefined>,
  enabled: Accessor<boolean>
): Omit<ChannelTimelineSource, 'mode'> {
  const query = useMessageTimelineQuery(parent, aroundMessageId, enabled);
  const data = () =>
    queryReadyGate(query) ? (query.data as MessageTimelineData) : undefined;
  const missingTarget = () =>
    aroundMessageId() != null && isMissingMessageError(query.error);
  return {
    data,
    latestEntry: () => data()?.pages[0]?.entries[0],
    isLoading: () => query.isLoading,
    isPending: () => query.isPending,
    isReady: () => queryReadyGate(query),
    loadError: () =>
      query.isLoadingError && !missingTarget()
        ? toEntityLoadError(query.error)
        : undefined,
    isMissingTarget: missingTarget,
    hasOlder: () => query.hasNextPage,
    hasNewer: () => query.hasPreviousPage,
    isLoadingOlder: () => query.isFetchingNextPage,
    isLoadingNewer: () => query.isFetchingPreviousPage,
    loadOlder: async () => {
      await query.fetchNextPage();
    },
    loadNewer: async () => {
      await query.fetchPreviousPage();
    },
    retry: async () => {
      await query.refetch();
    },
    toLatest: () =>
      queryClient.resetQueries(
        { queryKey: getMessageTimelineQueryKey(parent(), null) },
        { throwOnError: true }
      ),
  };
}

function localSource(
  timeline: LocalChannelTimeline
): Omit<ChannelTimelineSource, 'mode'> {
  const data = createMemo((): MessageTimelineData | undefined =>
    timeline.isLoading() || timeline.loadError()
      ? undefined
      : { pages: [{ entries: timeline.entries() }], pageParams: [null] }
  );
  return {
    data,
    latestEntry: () => timeline.entries()[0],
    isLoading: timeline.isLoading,
    isPending: () => data() === undefined,
    isReady: () => data() !== undefined,
    loadError: () =>
      timeline.isMissingTarget() ? undefined : timeline.loadError(),
    isMissingTarget: timeline.isMissingTarget,
    hasOlder: timeline.hasOlder,
    hasNewer: timeline.hasNewer,
    isLoadingOlder: timeline.isLoadingOlder,
    isLoadingNewer: timeline.isLoadingNewer,
    loadOlder: timeline.loadOlder,
    loadNewer: timeline.loadNewer,
    retry: timeline.retry,
    toLatest: timeline.toLatest,
  };
}

/**
 * Which path reads a parent's messages, chosen once per mount: the device
 * when the flag is on and the cache host serves channel timelines; REST for
 * everything else, and from the moment the host turns out unable.
 */
export function useChannelReadPath(parent: Accessor<MessageParent>) {
  const flag = useFeatureFlag(enableChannelLocalSync);
  const [unsupported, setUnsupported] = createSignal(false);

  const host = createMemo((): CacheHost | undefined => {
    if (parent().type !== 'channel' || unsupported()) return undefined;
    const current = getGraphqlSoupCacheHost();
    if (!current || !graphqlCacheEnabled()) return undefined;
    return channelCacheSupported(current) ? current : undefined;
  });
  // Latched: a flag refresh never moves an open channel between paths. A flag
  // PostHog has not answered yet reads as off, so REST never waits for it; a
  // device it turns on reads from the device from the next mount.
  const mode = createMemo<ChannelTimelineMode, undefined>((previous) => {
    if (!host()) return 'rest';
    return previous ?? (flag().enabled ? 'local' : 'rest');
  }, undefined);
  return { host, mode, setUnsupported: () => setUnsupported(true) };
}

/**
 * Picks the path once per mount: channels read from the device when the flag
 * is on and the cache host serves channel timelines; everything else, and a
 * host found unable mid-way, stays on REST.
 */
export function useChannelTimelineSource(
  parent: Accessor<MessageParent>,
  aroundMessageId: Accessor<string | null | undefined>
): ChannelTimelineSource {
  const { host, mode, setUnsupported } = useChannelReadPath(parent);

  const rest = restSource(parent, aroundMessageId, () => mode() === 'rest');
  const local = createMemo(() => {
    const current = host();
    if (mode() !== 'local' || !current) return undefined;
    return localSource(
      createLocalChannelTimeline(
        {
          host: current,
          runtime: channelSyncRuntime(current),
          touches: channelTouches(current),
          unstored: channelWrites(current).unstoredRoots,
        },
        parent().id,
        aroundMessageId,
        setUnsupported
      )
    );
  });
  const active = () => local() ?? rest;

  return {
    mode,
    data: () => active().data(),
    latestEntry: () => active().latestEntry(),
    isLoading: () => active().isLoading(),
    isPending: () => active().isPending(),
    isReady: () => active().isReady(),
    loadError: () => active().loadError(),
    isMissingTarget: () => active().isMissingTarget(),
    hasOlder: () => active().hasOlder(),
    hasNewer: () => active().hasNewer(),
    isLoadingOlder: () => active().isLoadingOlder(),
    isLoadingNewer: () => active().isLoadingNewer(),
    loadOlder: () => active().loadOlder(),
    loadNewer: () => active().loadNewer(),
    retry: () => active().retry(),
    toLatest: () => active().toLatest(),
  };
}
