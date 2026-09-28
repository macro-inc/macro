import { useEntitySubscription } from '@service-connection/client';
import type { Accessor } from 'solid-js';

/**
 * Tracks presence on a channel so live viewer indicators populate. Pure
 * tracking — message updates for open channels invalidate through
 * useMessageSubscription, not here.
 */
export function useChannelPresenceSubscription(channelId: Accessor<string>) {
  useEntitySubscription(() => ({
    entity_type: 'channel',
    entity_id: channelId(),
  }));
}
