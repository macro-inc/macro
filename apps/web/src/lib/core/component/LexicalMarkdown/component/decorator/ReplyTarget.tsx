import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { singleLineMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { getDisplayName, tryMacroId } from '@core/user';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import type { ReplyTargetDecoratorProps } from '@macro-inc/lexical-core';
import { useBotsQuery } from '@queries/bots/bots';
import { useChannelBotsQuery } from '@queries/channel/channel-bots';
import { getBotDisplayName } from '@queries/messages/message-sender';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import { createCallback } from '@solid-primitives/rootless';
import { openDocument } from '../core/BlockLink';

/** Single-line channel reply reference rendered by a ReplyTargetNode. */
export function ReplyTarget(props: ReplyTargetDecoratorProps) {
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
      openInNewSplitForMention(event.shiftKey, true)
    );
  });

  return (
    <button
      type="button"
      class="group/reply-target flex w-full min-w-0 items-center gap-1 py-1 text-left text-xs text-ink-muted rounded-md hover:bg-hover"
      aria-label={`Replying to ${senderName()}: ${props.displayText}`}
      data-reply-target-target-message-id={props.targetMessageId}
      on:mousedown={(event) => event.preventDefault()}
      on:click={openTarget}
    >
      <svg
        viewBox="0 0 20 21.333"
        class="ml-1 h-[1.333rem] w-5 shrink-0 overflow-visible text-edge transition-opacity group-hover/reply-target:opacity-0"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M20 10.667H8a8 5.333 0 0 0-8 5.333v5.333"
          stroke="currentColor"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <span class="shrink-0 font-semibold text-ink-disabled transition-colors group-hover/reply-target:text-ink-subtle">
        {senderName()}
      </span>
      <div class="min-w-0 flex-1 overflow-hidden italic text-ink-subtle transition-colors group-hover/reply-target:text-ink-muted">
        <StaticMarkdown
          markdown={props.displayText}
          theme={singleLineMarkdownTheme}
          target="internal"
          singleLine
        />
      </div>
    </button>
  );
}
