import type { ChannelShareEntityType } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Channel } from './channel';

/**
 * Grant a channel's current members access to one item, as posting it in the
 * channel does. The caller must be in the channel and able to share the item;
 * sharing again changes nothing.
 */
export async function shareWithChannel(
  client: MacroClient,
  channel: Channel,
  entityType: ChannelShareEntityType,
  entityId: string,
): Promise<void> {
  unwrap(
    await client.storage.shareWithChannel({
      path: { channel_id: channel.id },
      body: { entityType, entityId },
    }),
  );
}
