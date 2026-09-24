import {
  type ChannelPreviewSelection,
  getChannelEntityTarget,
} from '@app/features/next-soup/utils';
import { getChannelParams } from '@block-channel/utils/link';
import { untrack } from 'solid-js';
import type { PreviewBlockTarget } from './previewTarget';

/**
 * The channel block a channel row opens. Explicit targets win; otherwise unread
 * notifications pick the message. Kept apart from `previewBlockTarget` so
 * channel surfaces do not load every block definition.
 */
export function channelPreviewTarget(
  channel: ChannelPreviewSelection
): PreviewBlockTarget {
  const target = untrack(() => getChannelEntityTarget(channel));
  return {
    blockType: 'channel',
    blockId: channel.type === 'channel' ? channel.id : channel.channelId,
    aliasContext: undefined,
    params:
      target?.kind === 'message'
        ? getChannelParams(target.messageId, target.threadId)
        : undefined,
  };
}
