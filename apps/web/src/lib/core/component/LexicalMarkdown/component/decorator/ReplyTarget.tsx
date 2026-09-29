import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { useMaybeBlockId, useMaybeBlockName } from '@core/block';
import { getDisplayName, tryMacroId } from '@core/user';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import type { ReplyTargetDecoratorProps } from '@macro-inc/lexical-core';
import { useBotsQuery } from '@queries/bots/bots';
import { useChannelBotsQuery } from '@queries/channel/channel-bots';
import { getBotDisplayName } from '@queries/messages/message-sender';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import { createCallback } from '@solid-primitives/rootless';
import { openDocument } from '../core/BlockLink';
import { QuoteReplyPreview } from './QuoteReplyPreview';

/** Single-line channel reply reference rendered by a ReplyTargetNode. */
export function ReplyTarget(props: ReplyTargetDecoratorProps) {
  const currentBlockId = useMaybeBlockId();
  const currentBlockName = useMaybeBlockName();
  const channelBots = useChannelBotsQuery(() =>
    props.parent.type === 'channel' ? props.parent.id : ''
  );
  const bots = useBotsQuery();
  const document = useDocumentMetadataQuery(() =>
    props.parent.type === 'document' ? props.parent.id : ''
  );
  const senderName = () =>
    getBotDisplayName(
      props.senderId,
      undefined,
      props.parent.type === 'channel'
        ? channelBots.isSuccess
          ? channelBots.data
          : []
        : bots.isSuccess
          ? bots.data
          : []
    ) ||
    getDisplayName(tryMacroId(props.senderId), {}) ||
    props.senderId;

  const targetReady = () =>
    props.parent.type === 'channel' ||
    (document.isSuccess && !!document.data.fileType);

  const openTarget = createCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const channel = props.parent.type === 'channel';
    const fileType = channel
      ? 'channel'
      : document.isSuccess
        ? document.data.fileType
        : undefined;
    if (!fileType) return;
    openDocument(
      fileType,
      props.parent.id,
      channel
        ? {
            [CHANNEL_PARAMS.message]: props.targetMessageId,
            [CHANNEL_PARAMS.thread]: props.targetThreadId,
          }
        : { comment_id: props.targetMessageId },
      openInNewSplitForMention(
        event.shiftKey,
        currentBlockName !== fileType || currentBlockId !== props.parent.id
      )
    );
  });

  return (
    <QuoteReplyPreview
      label={senderName()}
      text={props.displayText}
      ariaLabel={`Replying to ${senderName()}: ${props.displayText}`}
      disabled={!targetReady()}
      onClick={openTarget}
      buttonAttrs={{
        'data-reply-target-target-message-id': props.targetMessageId,
      }}
    />
  );
}
