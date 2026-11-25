import { deferredGate } from '@core/util/debounce';
import { createMemo } from 'solid-js';
import { channelCacheHost } from './local/channel-flag';
import { channelWrites } from './local/channel-sync';

/** How long a send may stay unanswered before its message is marked unsent. */
export const UNSENT_AFTER_MS = 5000;

/**
 * Whether this session has been trying to send the message for longer than
 * `UNSENT_AFTER_MS`: it is waiting for a connection or for its channel to
 * let it in. A send that is refused for good rolls back instead. Nothing is
 * marked while channels send over REST (`enable-channel-local-sync` off).
 */
export function useMessageUnsent(messageId: () => string): () => boolean {
  const sending = createMemo(() => {
    const host = channelCacheHost();
    return host !== undefined && channelWrites(host).sending(messageId());
  });
  return deferredGate(sending, UNSENT_AFTER_MS);
}
