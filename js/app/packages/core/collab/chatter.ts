import type { RawUpdate } from './shared';

/** What co-located replicas gossip to each other, out-of-band from the live
 *  transport: a loro update or an awareness blob. */
export type ChatterMessage =
  | { type: 'update'; data: RawUpdate }
  | { type: 'awareness'; data: RawUpdate };

/**
 * A side channel between co-located replicas of the same document — e.g. browser
 * tabs of the same doc — so a local edit fans out to its siblings without a
 * network round-trip through the sync service. Orthogonal to the live sync
 * source: environments with a single replica (the AI worker, SSR) use
 * {@link noopChatter}.
 */
export interface Chatter {
  /** Broadcast a message to the other replicas. */
  post(message: ChatterMessage): void;
  /** Subscribe to messages from other replicas. Returns an unsubscribe fn. */
  subscribe(handler: (message: ChatterMessage) => void): () => void;
  /** Tear down the channel. */
  close(): void;
}

/** No co-located replicas — nothing to gossip to, nothing to hear. */
export function noopChatter(): Chatter {
  return { post: () => {}, subscribe: () => () => {}, close: () => {} };
}

const CHANNEL_PREFIX = 'macro-loro-';

/** Cross-tab gossip over the browser {@link BroadcastChannel}. */
export class BroadcastChannelChatter implements Chatter {
  private readonly channel: BroadcastChannel;

  constructor(documentId: string) {
    this.channel = new BroadcastChannel(`${CHANNEL_PREFIX}${documentId}`);
  }

  post(message: ChatterMessage): void {
    this.channel.postMessage(message);
  }

  subscribe(handler: (message: ChatterMessage) => void): () => void {
    const listener = (e: MessageEvent<ChatterMessage>) => handler(e.data);
    this.channel.addEventListener('message', listener);
    return () => this.channel.removeEventListener('message', listener);
  }

  close(): void {
    this.channel.close();
  }
}
