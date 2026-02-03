import { SplitDrawer } from '@app/component/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import { filterSafeAttachments } from '@block-channel/utils/attachments';
import { type BlockAlias, type BlockName, useBlockId } from '@core/block';
import { InlineItemPreview } from '@core/component/ItemPreview';
import { toast } from '@core/component/Toast/Toast';
import { Tooltip } from '@core/component/Tooltip';
import { UserIcon } from '@core/component/UserIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import { tryMacroId, useDisplayName } from '@core/user';
import BracketLeft from '@macro-icons/macro-group-bracket-left.svg';
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import type { MessageMention } from '@service-comms/generated/models';
import type { Attachment } from '@service-comms/generated/models/attachment';
import type { ItemType } from '@service-storage/client';
import { useMentionsQuery } from '@queries/channel/mentions';
import { createMemo, Show, Suspense } from 'solid-js';
import { VList } from 'virtua/solid';
import { useSplitLayout } from '../../app/component/split-layout/layout';
import { useChannelContext } from '@block-channel/hooks/channel';

const DRAWER_ID = 'attachments';

export function AttachmentsModal() {
  const drawerControl = useDrawerControl(DRAWER_ID);
  const currentBlockId = useBlockId();
  const { replaceOrInsertSplit } = useSplitLayout();
  const channelContext = useChannelContext();

  const mentionsQuery = useMentionsQuery(() => currentBlockId);

  const attachments = createMemo(() => {
    const mentions: Attachment[] = !mentionsQuery.isSuccess
      ? []
      : (mentionsQuery.data?.mentions ?? []).map((m) =>
          makeAttachmentFromMention(m, currentBlockId)
        );

    const channelAttachments = channelContext.attachments() ?? [];
    const safeAttachments = filterSafeAttachments(channelAttachments);
    const all = [...safeAttachments, ...mentions];
    return all
      .filter(
        (a) => !a.entity_type.startsWith('static/') && a.entity_type !== 'user'
      )
      .sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime()
      );
  });

  const navigateToItem = (blockName: BlockName, blockId: string) => {
    replaceOrInsertSplit({ type: blockName, id: blockId });
  };

  return (
    <>
      <Tooltip tooltip={'View all attachments'}>
        <div
          class="flex items-center gap-1 py-1 font-mono text-xs text-ink-disabled hover:bg-hover relative"
          tabIndex={0}
          role="button"
          onClick={drawerControl.toggle}
        >
          <BracketLeft class="h-4 w-2 text-edge" />
          <PaperclipIcon class="size-4 text-ink" />
          <span class="text-xs">{attachments().length}</span>
          <BracketLeft class="h-4 w-2 rotate-180 text-edge" />
        </div>
      </Tooltip>

      <SplitDrawer
        id={DRAWER_ID}
        title="Channel Attachments"
        side="right"
        size={768}
      >
        <div class="flex justify-center items-center max-w-full h-full max-h-full">
          <div class="flex-1 size-full overflow-x-hidden overflow-y-auto">
            <Show
              when={attachments().length > 0}
              fallback={
                <div class="py-8 text-ink-muted text-sm text-center">
                  No attachments in this channel
                </div>
              }
            >
              <div class="flex flex-col h-full">
                <VList data={attachments()}>
                  {(attachment) => (
                    <Suspense>
                      <AttachmentItem
                        attachment={attachment}
                        onNavigate={navigateToItem}
                        senderId={channelContext
                          .messageSenderMap()
                          .get(attachment.message_id)}
                      />
                    </Suspense>
                  )}
                </VList>
              </div>
            </Show>
          </div>
        </div>
      </SplitDrawer>
    </>
  );
}

function makeAttachmentFromMention(
  mention: MessageMention,
  channelId: string
): Attachment {
  return {
    channel_id: channelId,
    created_at: mention.created_at,
    entity_id: mention.entity_id,
    entity_type: mention.entity_type,
    id: mention.message_id,
    message_id: mention.message_id,
  };
}

type AttachmentItemProps = {
  attachment: Attachment;
  onNavigate: (blockName: BlockName | BlockAlias, blockId: string) => void;
  senderId: string | undefined;
};

function AttachmentItem(props: AttachmentItemProps) {
  const senderId = () => props.senderId ?? '';
  const [userName] = useDisplayName(tryMacroId(senderId()));

  const [preview] = useItemPreview(() => ({
    id: props.attachment.entity_id,
    type: props.attachment.entity_type as ItemType,
  }));

  const handleClick = () => {
    const item = preview();
    if (isAccessiblePreviewItem(item) && item.type === 'document') {
      props.onNavigate(fileTypeToBlockName(item.fileType), item.id);
    } else {
      toast.failure('Failed to open attachment');
    }
  };

  return (
    <button
      class="bg-menu hover:bg-hover p-2 pb-3 border-edge-muted border-b w-full text-left"
      onClick={handleClick}
    >
      <div class="flex justify-start items-center gap-2 mb-4 font-mono text-ink-muted text-xs uppercase">
        <div class="bg-ink-extra-muted size-2" />
        <div>ATTACHED ITEM</div>
        <div class="grow" />
        <div>{formatTimestamp(props.attachment.created_at)}</div>
      </div>
      <span class="inline-flex items-center gap-1 pl-4 text-sm">
        <Show when={senderId()}>
          <UserIcon id={senderId()} size="xs" isDeleted={false} />
          <span class="font-medium text-ink">{userName()}</span>
        </Show>

        <span class="text-ink-extra-muted">attached</span>
        <InlineItemPreview
          itemId={props.attachment.entity_id}
          itemType={props.attachment.entity_type as ItemType}
        />
      </span>
    </button>
  );
}

const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp);
  const datePart = date
    .toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
    })
    .replaceAll('/', '-');

  const timePart = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: 'numeric',
  });

  return `${datePart} @ ${timePart}`;
};
