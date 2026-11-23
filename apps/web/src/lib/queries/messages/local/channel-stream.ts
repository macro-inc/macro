import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import { Telemetry } from '@macro-inc/observability';
import {
  ChannelTimelineUpdatesDocument,
  type ChannelTimelineUpdatesSubscription,
} from '@service-storage/graphql/generated/graphql';
import type { Client, OperationResult } from '@urql/core';
import type { ChannelSyncRuntime } from './channel-sync-runtime';

/** The first wait before subscribing again after the stream ended. */
export const CHANNEL_STREAM_RETRY_MS = 1_000;
const MAX_CHANNEL_STREAM_RETRY_MS = 60_000;

type StreamRuntime = Pick<
  ChannelSyncRuntime,
  'onFrame' | 'onConnected' | 'onDisconnected'
>;

export interface ChannelStream {
  /** The socket (re)connected: frames flow from here on. */
  connected(): void;
  /** The socket closed: frames stop until it connects again. */
  disconnected(): void;
  dispose(): void;
}

/**
 * Follows `channelTimelineUpdates` for one client and hands each frame to the
 * sync runtime. A stream that ends, as one that fell behind does, leaves every
 * channel unproven and subscribes again; the runtime then catches up the
 * channels on screen.
 */
export function createChannelStream(
  client: Pick<Client, 'subscription'>,
  runtime: StreamRuntime
): ChannelStream {
  let unsubscribe: (() => void) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryMs = CHANNEL_STREAM_RETRY_MS;
  let socketUp = false;
  let disposed = false;

  const end = () => {
    unsubscribe?.();
    unsubscribe = undefined;
    runtime.onDisconnected();
    if (disposed || retry !== undefined) return;
    const wait = retryMs;
    retryMs = Math.min(retryMs * 2, MAX_CHANNEL_STREAM_RETRY_MS);
    retry = setTimeout(() => {
      retry = undefined;
      subscribe();
      // A socket that stayed up hears no new connection, so nothing else
      // tells the runtime frames flow again.
      if (socketUp) runtime.onConnected();
    }, wait);
  };

  const onResult = (
    result: OperationResult<ChannelTimelineUpdatesSubscription>
  ) => {
    const frame = result.data?.channelTimelineUpdates;
    if (frame) {
      retryMs = CHANNEL_STREAM_RETRY_MS;
      const metadata = normalizedCacheResultMetadata(result);
      runtime.onFrame(
        frame,
        metadata?.source === 'live-network' &&
          metadata.cacheEffectsApplied === true
      );
    }
    if (result.error) {
      Telemetry.error(result.error, { surface: 'channel-stream' });
      end();
      return;
    }
    // urql ends a subscription with a final `hasNext: false` result.
    if (result.hasNext === false) end();
  };

  function subscribe() {
    if (disposed) return;
    let ended = false;
    const subscription = client
      .subscription(ChannelTimelineUpdatesDocument, {})
      .subscribe((result) => {
        if (ended) return;
        if (result.error || result.hasNext === false) ended = true;
        onResult(result);
      });
    unsubscribe = () => {
      ended = true;
      subscription.unsubscribe();
    };
  }

  subscribe();
  return {
    connected() {
      socketUp = true;
      if (unsubscribe) runtime.onConnected();
    },
    disconnected() {
      socketUp = false;
      runtime.onDisconnected();
    },
    dispose() {
      disposed = true;
      clearTimeout(retry);
      retry = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
      runtime.onDisconnected();
    },
  };
}
