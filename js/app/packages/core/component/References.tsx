import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import type { BlockName } from '@core/block';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import {
  isAccessiblePreviewItem,
  isDocumentPreviewItem,
  type PreviewItem,
  useItemPreview,
} from '@core/signal/preview';
import { useDisplayName } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import { commsServiceClient } from '@service-comms/client';
import type { EntityReference } from '@service-comms/generated/models/entityReference';
import type { GenericReference } from '@service-comms/generated/models/genericReference';
import type { ItemType } from '@service-storage/client';
import { createMemo, createResource, For, Show } from 'solid-js';
import { InlineItemPreview } from './ItemPreview';
import { StaticMarkdown } from './LexicalMarkdown/component/core/StaticMarkdown';
import { UserIcon } from './UserIcon';

export type ReferenceProps = {
  documentId: string;
};

function isChannelReference(ref: EntityReference): ref is EntityReference & {
  channel_id: string;
  message_id: string;
  sender_id: string;
  attachment_created_at: string;
  message_content?: string;
} {
  return (
    'channel_id' in ref &&
    'message_id' in ref &&
    'sender_id' in ref &&
    'attachment_created_at' in ref
  );
}

function isGenericReference(
  ref: EntityReference
): ref is EntityReference & GenericReference & { reference_type: 'generic' } {
  return (
    'reference_type' in ref &&
    (ref as any).reference_type === 'generic' &&
    'source_entity_type' in ref &&
    'entity_type' in ref &&
    'created_at' in ref
  );
}

export function References(props: ReferenceProps) {
  const [references] = createResource(async () => {
    const response = await commsServiceClient.attachmentReferences({
      entity_type: 'document',
      entity_id: props.documentId,
    });

    if (isErr(response)) {
      console.error(response);
      return [];
    }

    return response[1].references;
  });
  const { replaceOrInsertSplit } = useSplitLayout();
  const blockOrchestrator = useGlobalBlockOrchestrator();

  const messageLocation = async (
    channelId: string,
    messageId: string,
    threadId?: string
  ) => {
    const blockHandle = await blockOrchestrator.getBlockHandle(channelId);
    await blockHandle?.goToLocationFromParams({
      message_id: messageId,
      thread_id: threadId,
    });
  };

  const navigateToMessage = (
    channelId: string,
    messageId: string,
    threadId?: string
  ) => {
    replaceOrInsertSplit({
      type: 'channel',
      id: channelId,
    });
    messageLocation(channelId, messageId, threadId);
  };

  const navigateToItem = (blockName: BlockName, blockId: string) => {
    replaceOrInsertSplit({
      type: blockName,
      id: blockId,
    });
  };

  const navigateToGenericReference = (item: PreviewItem) => {
    if (isAccessiblePreviewItem(item) && isDocumentPreviewItem(item)) {
      const blockId = item.id;
      const blockType = fileTypeToBlockName(item.fileType) as BlockName;
      navigateToItem(blockType, blockId);
    } else {
      toast.failure('Failed to open reference');
    }
  };

  const sortedReferences = createMemo(() => {
    const refs = references() ?? [];
    return refs.sort((a, b) => {
      let timeA = '0';
      let timeB = '0';

      if (isChannelReference(a)) {
        timeA = a.attachment_created_at;
      } else if (isGenericReference(a)) {
        timeA = a.created_at;
      }

      if (isChannelReference(b)) {
        timeB = b.attachment_created_at;
      } else if (isGenericReference(b)) {
        timeB = b.created_at;
      }

      return new Date(timeB).getTime() - new Date(timeA).getTime();
    });
  });

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

  return (
    <div class="flex flex-col">
      <Show
        when={sortedReferences().length > 0}
        fallback={
          <div class="py-8 text-ink-muted text-sm text-center">
            No references found
          </div>
        }
      >
        <For each={sortedReferences()}>
          {(ref) => {
            if (isChannelReference(ref)) {
              const [userName] = useDisplayName(ref.sender_id);
              const hasMessageContent =
                ref.message_content && ref.message_content.trim().length > 0;

              return (
                <button
                  class="bg-menu hover:bg-hover p-2 pb-3 border-edge-muted border-b w-full text-left"
                  onMouseDown={(e) => {
                    // Prevent focus change on mousedown to avoid split activation flash
                    // The click handler will properly handle navigation
                    e.preventDefault();
                  }}
                  onClick={() =>
                    navigateToMessage(ref.channel_id, ref.message_id)
                  }
                >
                  <div class="flex justify-start items-center gap-2 mb-4 font-mono text-ink-muted text-xs uppercase">
                    <div class="bg-ink-extra-muted size-2" />
                    <div>{hasMessageContent ? 'REFERENCE' : 'ATTACHMENT'}</div>
                    <div class="grow" />
                    <div>{formatTimestamp(ref.attachment_created_at)}</div>
                  </div>

                  <span class="inline-flex items-center gap-2 pl-4 text-sm">
                    <UserIcon id={ref.sender_id} size="xs" isDeleted={false} />
                    <span class="font-medium text-ink">{userName()}</span>
                    <span class="text-ink-extra-muted">
                      {hasMessageContent ? 'referenced in' : 'attached in'}
                    </span>
                    <InlineItemPreview
                      itemId={ref.channel_id}
                      itemType="channel"
                    />
                  </span>
                  <Show when={hasMessageContent}>
                    <div class="pl-4 text-ink-muted text-xs">
                      <StaticMarkdown markdown={ref.message_content || ''} />
                    </div>
                  </Show>
                </button>
              );
            }

            if (isGenericReference(ref)) {
              const userId = ref.user_id!;
              const [userName] = useDisplayName(userId);
              const [item] = useItemPreview({
                id: ref.source_entity_id,
                type: ref.source_entity_type as any,
              });

              return (
                <button
                  class="bg-menu hover:bg-hover p-2 pb-3 border-edge-muted border-b w-full text-left"
                  onMouseDown={(e) => {
                    // Prevent focus change on mousedown to avoid split activation flash
                    // The click handler will properly handle navigation
                    e.preventDefault();
                  }}
                  onClick={() => navigateToGenericReference(item())}
                >
                  <div class="flex justify-start items-center gap-2 mb-4 font-mono text-ink-muted text-xs uppercase">
                    <div class="bg-ink-extra-muted size-2" />
                    <div>MENTION</div>
                    <div class="grow" />
                    <div>{formatTimestamp(ref.created_at)}</div>
                  </div>

                  <span class="inline-flex items-center gap-1 text-sm pl-4">
                    <UserIcon id={userId} size="xs" isDeleted={false} />
                    <span class="font-medium text-ink">{userName()}</span>
                    <span class="text-ink-extra-muted">mentioned in</span>
                    <InlineItemPreview
                      itemId={ref.source_entity_id}
                      itemType={ref.source_entity_type as ItemType}
                    />
                  </span>
                </button>
              );
            }

            return (
              <div class="flex justify-between items-center bg-failure-bg px-4 py-2 border-edge/30 border-b w-full">
                <div class="text-failure text-xs">
                  Unknown reference type: {JSON.stringify(ref, null, 2)}
                </div>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
