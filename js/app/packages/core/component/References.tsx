import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { getChannelParams } from '@block-channel/utils/link';
import type { BlockAlias, BlockName } from '@core/block';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { tryMacroId, useDisplayNameParts } from '@core/user';
import { compareDateDesc, type DateValue } from '@core/util/date';

import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { formatRelativeTimestamp } from '@entity';
import {
  isAccessiblePreviewItem,
  type PreviewItem,
  useItemPreview,
} from '@queries/preview';
import { type ItemType, storageServiceClient } from '@service-storage/client';
import type { ApiAttachmentEntityReference as EntityReference } from '@service-storage/generated/schemas/apiAttachmentEntityReference';
import type { ApiAttachmentGenericReference as GenericReference } from '@service-storage/generated/schemas/apiAttachmentGenericReference';
import { createMemo, createResource, For, type JSX, Show } from 'solid-js';
import { InlineItemPreview } from './ItemPreview';
import { StaticMarkdown } from './LexicalMarkdown/component/core/StaticMarkdown';
import { twoLineClampMarkdownTheme } from './LexicalMarkdown/theme';
import { UserIcon } from './UserIcon';

type ReferenceProps = {
  documentId: string;
  entityType?: ItemType;
};

type ChannelRef = EntityReference & {
  channel_id: string;
  message_id: string;
  thread_id?: string;
  sender_id: string;
  attachment_created_at: string;
  message_content?: string;
};

type GenericRef = EntityReference &
  GenericReference & { reference_type: 'generic' };

function isChannelReference(ref: EntityReference): ref is ChannelRef {
  return (
    'channel_id' in ref &&
    'message_id' in ref &&
    'sender_id' in ref &&
    'attachment_created_at' in ref
  );
}

function isGenericReference(ref: EntityReference): ref is GenericRef {
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

interface ReferenceRowProps {
  source: JSX.Element;
  senderAvatar?: JSX.Element;
  senderName?: string;
  timestamp: DateValue;
  body?: JSX.Element;
  onClick?: (e: KeyboardEvent | MouseEvent) => void;
}

function ReferenceRow(props: ReferenceRowProps) {
  const navHandlers = useSplitNavigationHandler<HTMLDivElement>((e) => {
    props.onClick?.(e);
  });

  return (
    <div
      role="button"
      tabIndex={0}
      class="group/ref-row flex flex-col px-3 py-2 hover:bg-ink-muted/6 min-w-0 overflow-hidden cursor-pointer"
      onMouseDown={navHandlers.onMouseDown}
      onClick={navHandlers.onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onClick?.(e);
        }
      }}
    >
      <div class="flex items-center gap-2 min-w-0 text-xs leading-5">
        <Show when={props.senderAvatar}>{props.senderAvatar}</Show>
        <div class="min-w-0 flex items-center gap-1.5 overflow-hidden">
          <Show when={props.senderName}>
            <span class="ph-no-capture shrink-0 font-medium text-ink truncate max-w-[8rem]">
              {props.senderName}
            </span>
            <span class="shrink-0 text-ink-muted/70">in</span>
          </Show>
          <div class="min-w-0 flex items-center overflow-hidden text-ink-muted">
            {props.source}
          </div>
        </div>
        <span class="shrink-0 ml-auto text-ink-extra-muted tabular-nums">
          {formatRelativeTimestamp(props.timestamp)}
        </span>
      </div>

      <Show when={props.body}>
        <div class="ph-no-capture min-w-0 mt-1.5 ml-1 pl-2.5 border-l-2 border-ink-muted/12 text-xs text-ink-muted/65">
          {props.body}
        </div>
      </Show>
    </div>
  );
}

function ReferencesCard(props: { children: JSX.Element }) {
  return (
    <div class="rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 overflow-hidden">
      <div class="divide-y divide-ink-muted/8">{props.children}</div>
    </div>
  );
}

// A message that is only mention tags adds no info — the row's source chip
// already links to the same target.
const MENTION_TAG_RE = /<m-\w+-mention>[\s\S]*?<\/m-\w+-mention>/g;
function isOnlyMentions(markdown: string): boolean {
  return markdown.replace(MENTION_TAG_RE, '').trim().length === 0;
}

function ChannelReferenceRow(props: {
  reference: ChannelRef;
  onOpen: (e: KeyboardEvent | MouseEvent) => void;
}) {
  const { firstName, fullName } = useDisplayNameParts(
    tryMacroId(props.reference.sender_id)
  );
  const senderName = () => firstName() || fullName();
  const hasContent = () => {
    const content = props.reference.message_content?.trim();
    if (!content) return false;
    return !isOnlyMentions(content);
  };

  return (
    <ReferenceRow
      source={
        <InlineItemPreview id={props.reference.channel_id} type="channel" />
      }
      senderAvatar={
        <UserIcon
          id={props.reference.sender_id}
          size="sm"
          isDeleted={false}
          suppressClick
          showTooltip={false}
        />
      }
      senderName={senderName()}
      timestamp={props.reference.attachment_created_at}
      onClick={props.onOpen}
      body={
        hasContent() ? (
          <StaticMarkdown
            markdown={props.reference.message_content || ''}
            theme={twoLineClampMarkdownTheme}
          />
        ) : undefined
      }
    />
  );
}

function GenericReferenceRow(props: {
  reference: GenericRef;
  onOpen: (item: PreviewItem, e?: KeyboardEvent | MouseEvent) => void;
}) {
  const userId = props.reference.user_id!;
  const { firstName, fullName } = useDisplayNameParts(tryMacroId(userId));
  const senderName = () => firstName() || fullName();
  const [item] = useItemPreview(() => ({
    id: props.reference.source_entity_id,
    type: props.reference.source_entity_type as ItemType,
  }));

  return (
    <ReferenceRow
      source={
        <InlineItemPreview
          id={props.reference.source_entity_id}
          type={props.reference.source_entity_type as ItemType}
        />
      }
      senderAvatar={
        <UserIcon
          id={userId}
          size="sm"
          isDeleted={false}
          suppressClick
          showTooltip={false}
        />
      }
      senderName={senderName()}
      timestamp={props.reference.created_at}
      onClick={(e) => props.onOpen(item(), e)}
    />
  );
}

export function References(props: ReferenceProps) {
  const [references] = createResource(async () => {
    const entityType = props.entityType ?? 'document';
    const response = await storageServiceClient.attachmentReferences({
      entity_type: entityType,
      entity_id: props.documentId,
    });

    if (response.isErr()) {
      console.error(response);
      return [];
    }

    return response.value.references;
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

  return (
    <Show
      when={sortedReferences().length > 0}
      fallback={
        <div class="py-8 text-ink-muted text-sm text-center">
          No references found
        </div>
      }
    >
      <ReferencesCard>
        <For each={sortedReferences()}>
          {(ref) => {
            if (isChannelReference(ref)) {
              return (
                <ChannelReferenceRow
                  reference={ref}
                  onOpen={(e) =>
                    navigateToMessage({
                      event: e,
                      channelId: ref.channel_id,
                      messageId: ref.message_id,
                      threadId: ref.thread_id,
                    })
                  }
                />
              );
            }
            if (isGenericReference(ref)) {
              return (
                <GenericReferenceRow
                  reference={ref}
                  onOpen={navigateToGenericReference}
                />
              );
            }
            return (
              <div class="px-3 py-2 text-xs text-failure">
                Unknown reference type
              </div>
            );
          }}
        </For>
      </ReferencesCard>
    </Show>
  );
}
