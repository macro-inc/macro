import { deleteMessage } from '@block-channel/signal/channel';
import { getUrlToMessage } from '@block-channel/state/link';
import { useBlockId } from '@core/block';
import { logger } from '@observability';
import ReplyIcon from '@phosphor-icons/core/regular/arrow-bend-up-left.svg?component-solid';
import CopyIcon from '@phosphor-icons/core/regular/copy.svg?component-solid';
import LinkIcon from '@phosphor-icons/core/regular/link.svg?component-solid';
import Pencil from '@phosphor-icons/core/regular/pencil.svg?component-solid';
import Trash from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { useUserId } from '@service-gql/client';
import { createCallback } from '@solid-primitives/rootless';
import { toast } from 'core/component/Toast/Toast';
import type { Accessor, Component } from 'solid-js';
import { createMemo } from 'solid-js';

export type MessageAction = {
  text: string;
  icon: Component;
  onClick: () => void;
  enabled: boolean;
  dividerBefore?: boolean;
};

export function createMessageActions(params: {
  messageId: string;
  messageContent: string;
  threadId?: string;
  senderId: string;
  onEdit: () => void;
  onReply: () => void;
}): Accessor<MessageAction[]> {
  const blockId = useBlockId();
  const userId = useUserId();

  const deleteMessage_ = createCallback(() => deleteMessage(params.messageId));

  function copyLinkToMessage() {
    const normalizedThreadId =
      params.threadId == null ? undefined : String(params.threadId);
    const url = getUrlToMessage(blockId, params.messageId, normalizedThreadId);
    navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
  }

  function copyMessageText() {
    const text = params.messageContent;
    if (!text) return toast.failure('No message to copy');

    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast.success('Message copied to clipboard');
      })
      .catch((cause) => {
        logger.error('failed to copy message', { cause });
        toast.failure('Failed to copy message');
      });
  }

  return createMemo<MessageAction[]>(() => [
    {
      text: 'Reply',
      onClick: params.onReply,
      enabled: !params.threadId,
      icon: ReplyIcon,
    },
    {
      text: 'Copy Link to Message',
      onClick: copyLinkToMessage,
      icon: LinkIcon,
      enabled: true,
    },
    {
      text: 'Copy Message Text',
      onClick: copyMessageText,
      icon: CopyIcon,
      enabled: true,
    },
    {
      text: 'Edit Message',
      onClick: params.onEdit,
      enabled: userId() === params.senderId,
      icon: Pencil,
      dividerBefore: true,
    },
    {
      text: 'Delete Message',
      onClick: deleteMessage_,
      enabled: userId() === params.senderId,
      icon: Trash,
    },
  ]);
}
