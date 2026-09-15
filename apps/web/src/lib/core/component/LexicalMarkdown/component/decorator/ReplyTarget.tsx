import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { getDisplayName, tryMacroId } from '@core/user';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import type { ReplyTargetDecoratorProps } from '@macro-inc/lexical-core';
import { useChannelBotsQuery } from '@queries/channel/channel-bots';
import { getBotDisplayName } from '@queries/channel/message-sender';
import { createCallback } from '@solid-primitives/rootless';
import { openDocument } from '../core/BlockLink';

/** Single-line channel reply reference rendered by a ReplyTargetNode. */
export function ReplyTarget(props: ReplyTargetDecoratorProps) {
  const channelBots = useChannelBotsQuery(() => props.channelId);
  const senderName = () =>
    getBotDisplayName(props.senderId, undefined, channelBots.data) ||
    getDisplayName(tryMacroId(props.senderId), {}) ||
    props.senderId;

  const openTarget = createCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openDocument(
      'channel',
      props.channelId,
      {
        [CHANNEL_PARAMS.message]: props.targetMessageId,
        [CHANNEL_PARAMS.thread]: props.targetThreadId,
      },
      openInNewSplitForMention(event.shiftKey, true)
    );
  });

  return (
    <button
      type="button"
      class="w-full min-w-0 truncate text-left text-xs text-ink-muted pl-3 py-1.5 rounded-md hover:bg-hover"
      aria-label={`Replying to ${senderName()}`}
      data-reply-target-target-message-id={props.targetMessageId}
      on:mousedown={(event) => event.preventDefault()}
      on:click={openTarget}
    >
      Replying to <span class="font-medium">{senderName()}</span>
    </button>
  );
}
