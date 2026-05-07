import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { getChannelParams } from '@block-channel/utils/link';
import type { BlockAlias, BlockName } from '@core/block';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { tryMacroId, useDisplayName } from '@core/user';
import { compareDateDesc, type DateValue } from '@core/util/date';
import { isErr } from '@core/util/maybeResult';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import {
  isAccessiblePreviewItem,
  type PreviewItem,
  useItemPreview,
} from '@queries/preview';
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
  entityType?: ItemType;
};

function isChannelReference(ref: EntityReference): ref is EntityReference & {
  channel_id: string;
  message_id: string;
  thread_id?: string;
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

const getReferenceCreatedAt = (ref: EntityReference) => {
  if (isChannelReference(ref)) {
    return ref.attachment_created_at;
  } else if (isGenericReference(ref)) {
    return ref.created_at;
  }
};

export function References(props: ReferenceProps) {
  const [references] = createResource(async () => {
    const entityType = props.entityType ?? 'document';
    const response = await commsServiceClient.attachmentReferences({
      entity_type: entityType,
      entity_id: props.documentId,
    });

    if (isErr(response)) {
      console.error(response);
      return [];
    }

    return response[1].references;
  });
  const { openWithSplit } = useSplitLayout();
  const blockOrchestrator = useGlobalBlockOrchestrator();

  const goToMessageLocation = async (
    channelId: string,
    messageId: string,
    threadId?: string
  ) => {
    const blockHandle = await blockOrchestrator.getBlockHandle(channelId);
    await blockHandle?.goToLocationFromParams(
      getChannelParams(messageId, threadId)
    );
  };

  const navigateToItem = ({
    event,
    blockId,
    blockName,
  }: {
    event?: KeyboardEvent | MouseEvent;
    blockName: BlockName | BlockAlias;
    blockId: string;
  }) => {
    openWithSplit(
      { type: blockName, id: blockId },
      { preferNewSplit: event?.shiftKey !== true }
    );
  };

  const navigateToMessage = ({
    channelId,
    messageId,
    threadId,
    event,
  }: {
    event?: KeyboardEvent | MouseEvent;
    channelId: string;
    messageId: string;
    threadId?: string;
  }) => {
    navigateToItem({
      event,
      blockName: 'channel',
      blockId: channelId,
    });
    goToMessageLocation(channelId, messageId, threadId);
  };

  const navigateToGenericReference = (
    item: PreviewItem,
    event?: KeyboardEvent | MouseEvent
  ) => {
    if (isAccessiblePreviewItem(item) && item.type === 'document') {
      const blockId = item.id;
      const blockType = fileTypeToBlockName(item.fileType);
      navigateToItem({
        event,
        blockName: blockType,
        blockId,
      });
    } else {
      toast.failure('Failed to open reference');
    }
  };

  const sortedReferences = createMemo(() => {
    const refs = references() ?? [];
    return refs.sort((a, b) =>
      compareDateDesc(getReferenceCreatedAt(a), getReferenceCreatedAt(b))
    );
  });

  const formatTimestamp = (input: DateValue) => {
    const timestamp = input instanceof Date ? input : new Date(input);
    const datePart = timestamp
      .toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
      })
      .replaceAll('/', '-');

    const timePart = timestamp.toLocaleTimeString('en-US', {
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
              const [userName] = useDisplayName(tryMacroId(ref.sender_id));
              const hasMessageContent =
                ref.message_content && ref.message_content.trim().length > 0;

              const navHandlers = useSplitNavigationHandler((e) =>
                navigateToMessage({
                  event: e,
                  channelId: ref.channel_id,
                  messageId: ref.message_id,
                  threadId: ref.thread_id,
                })
              );

              return (
                <button
                  class="bg-menu hover:bg-hover p-2 pb-3 border-edge-muted border-b w-full text-left"
                  {...navHandlers}
                >
                  <div class="flex justify-start items-center gap-2 mb-4 font-mono text-ink-muted text-xs uppercase">
                    <div class="bg-ink-extra-muted size-2" />
                    <div>{hasMessageContent ? 'REFERENCE' : 'ATTACHMENT'}</div>
                    <div class="grow" />
                    <div>{formatTimestamp(ref.attachment_created_at)}</div>
                  </div>

                  <span class="inline-flex items-center gap-2 pl-4 text-sm">
                    <UserIcon id={ref.sender_id} size="sm" isDeleted={false} />
                    <span class="font-medium text-ink">{userName()}</span>
                    <span class="text-ink-extra-muted">
                      {hasMessageContent ? 'referenced in' : 'attached in'}
                    </span>
                    <InlineItemPreview id={ref.channel_id} type="channel" />
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
              const [userName] = useDisplayName(tryMacroId(userId));
              const [item] = useItemPreview(() => ({
                id: ref.source_entity_id,
                type: ref.source_entity_type as ItemType,
              }));

              const navHandlers = useSplitNavigationHandler((e) =>
                navigateToGenericReference(item(), e)
              );

              return (
                <button
                  class="bg-menu hover:bg-hover p-2 pb-3 border-edge-muted border-b w-full text-left"
                  {...navHandlers}
                >
                  <div class="flex justify-start items-center gap-2 mb-4 font-mono text-ink-muted text-xs uppercase">
                    <div class="bg-ink-extra-muted size-2" />
                    <div>MENTION</div>
                    <div class="grow" />
                    <div>{formatTimestamp(ref.created_at)}</div>
                  </div>

                  <span class="inline-flex items-center gap-1 text-sm pl-4">
                    <UserIcon id={userId} size="sm" isDeleted={false} />
                    <span class="font-medium text-ink">{userName()}</span>
                    <span class="text-ink-extra-muted">mentioned in</span>
                    <InlineItemPreview
                      id={ref.source_entity_id}
                      type={ref.source_entity_type as ItemType}
                    />
                  </span>
                </button>
              );
            }

            return (
              <div class="flex justify-between items-center bg-failure-bg px-4 py-2 border-edge border-b w-full">
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
