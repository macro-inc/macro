import type { RawUpdate } from './shared';

/** What co-located replicas gossip to each other, out-of-band from the live
 *  transport: a loro update or an awareness blob. */
export type ChatterMessage =
  | { type: 'update'; data: RawUpdate }
  | { type: 'awareness'; data: RawUpdate };

/**
 * Generic interface for "other people" that should also receive updates from
 * the local peer.
 *
 * Usually this is just a wrapper around a broadcast channel.
 */
export interface Chatter {
  /** Broadcast a message to the other replicas. */
  post(message: ChatterMessage): void;
  /** Subscribe to messages from other replicas. Returns an unsubscribe fn. */
  subscribe(handler: (message: ChatterMessage) => void): () => void;
  /** Tear down the channel. */
  close(): void;
}

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

  public post(message: ChatterMessage): void {
    this.channel.postMessage(message);
  }

  public subscribe(handler: (message: ChatterMessage) => void): () => void {
    const listener = (e: MessageEvent<ChatterMessage>) => handler(e.data);
    this.channel.addEventListener('message', listener);
    return () => this.channel.removeEventListener('message', listener);
  }

  public close(): void {
    this.channel.close();
  }
}
