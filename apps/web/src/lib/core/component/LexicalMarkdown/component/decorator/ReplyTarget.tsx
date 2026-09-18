import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { useMaybeBlockId, useMaybeBlockName } from '@core/block';
import { getDisplayName, tryMacroId } from '@core/user';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import type { ReplyTargetDecoratorProps } from '@macro-inc/lexical-core';
import { useChannelBotsQuery } from '@queries/channel/channel-bots';
import { getBotDisplayName } from '@queries/channel/message-sender';
import { createCallback } from '@solid-primitives/rootless';
import { openDocument } from '../core/BlockLink';
import { QuoteReplyPreview } from './QuoteReplyPreview';

/** Single-line channel reply reference rendered by a ReplyTargetNode. */
export function ReplyTarget(props: ReplyTargetDecoratorProps) {
  const currentBlockId = useMaybeBlockId();
  const currentBlockName = useMaybeBlockName();
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
      openInNewSplitForMention(
        event.shiftKey,
        currentBlockName !== 'channel' || currentBlockId !== props.channelId
      )
    );
  });

  return (
    <QuoteReplyPreview
      label={senderName()}
      text={props.displayText}
      ariaLabel={`Replying to ${senderName()}: ${props.displayText}`}
      onClick={openTarget}
      buttonAttrs={{
        'data-reply-target-target-message-id': props.targetMessageId,
      }}
    />
  );
}
