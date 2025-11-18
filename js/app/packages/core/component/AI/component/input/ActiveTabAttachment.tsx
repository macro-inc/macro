import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant/fileType';
import type { Attachment } from '@core/component/AI/types';
import { useChannelsContext } from '@core/component/ChannelsProvider';
import { EntityIcon } from '@core/component/EntityIcon';
import {
  DropdownMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/Menu';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { ChannelWithParticipants } from '@core/user';
import PlusIcon from '@icon/regular/plus.svg?component-solid';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import type {
  AttachmentType,
  ChannelType,
  FileType,
} from '@service-cognition/generated/schemas';
import type { BasicDocument } from '@service-storage/generated/schemas/basicDocument';
import { useHistory } from '@service-storage/history';
import type { SplitContent } from 'app/component/split-layout/layoutManager';
import { globalSplitManager } from 'app/signal/splitLayout';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';

type ActiveTabAttachmentProps = {
  onAddAttachment: (attachment: Attachment) => void;
  onAddAll: (attachments: Attachment[]) => void;
  attachedAttachments: () => Attachment[];
  attachAllOnMount?: boolean;
};

function convertSplitToAttachment(
  split: SplitContent,
  item: BasicDocument | null,
  channel: ChannelWithParticipants | null = null
): Attachment | null {
  let metadata: Attachment['metadata'];
  let attachmentType: AttachmentType;

  switch (split.type) {
    case 'image':
      if (!item) return null;
      const imageName = item.name || 'Image';
      const imageExtension = (item.fileType || 'png') as FileType;
      metadata = {
        type: 'image',
        image_name: imageName,
        image_extension: imageExtension,
      };
      attachmentType = 'image';
      break;
    case 'channel':
      if (!channel) return null;
      const channelName = channel.name || 'Channel';
      const channelType: ChannelType = channel.channel_type || 'public';
      metadata = {
        type: 'channel',
        channel_name: channelName,
        channel_type: channelType,
      };
      attachmentType = 'channel';
      break;
    default:
      if (!item) return null;
      const documentName = item.name || 'Document';
      const documentType = (item.fileType || 'txt') as FileType;
      metadata = {
        type: 'document',
        document_name: documentName,
        document_type: documentType,
      };
      attachmentType = 'document';
      break;
  }

  return {
    id: `split-${split.id}-${Date.now()}`,
    attachmentId: split.id,
    attachmentType,
    metadata,
  };
}

function AddContextDropdown(props: {
  activeTabs: Array<{
    split: SplitContent;
    item: BasicDocument | null;
    channel: ChannelWithParticipants | null;
  }>;
  onAddAttachment: (attachment: Attachment) => void;
  onAddAll: (attachments: Attachment[]) => void;
  attachedAttachments: () => Attachment[];
}) {
  const handleAddAttachment = (tabData: {
    split: SplitContent;
    item: BasicDocument | null;
    channel: ChannelWithParticipants | null;
  }) => {
    const { split, item, channel } = tabData;
    const attachment = convertSplitToAttachment(split, item, channel);
    if (attachment) {
      props.onAddAttachment(attachment);
    }
  };

  // Filter out already attached tabs
  const unattachedTabs = () => {
    const attachedIds = new Set(
      props.attachedAttachments().map((att) => att.attachmentId)
    );
    return props.activeTabs.filter(({ split }) => !attachedIds.has(split.id));
  };

  const handleAddAll = () => {
    const attachments: Attachment[] = [];
    for (const tabData of unattachedTabs()) {
      const { split, item, channel } = tabData;
      const attachment = convertSplitToAttachment(split, item, channel);
      if (attachment) {
        attachments.push(attachment);
      }
    }
    props.onAddAll(attachments);
  };

  return (
    <DropdownMenuContent
      width="md"
      class="z-modal-overlay max-h-[200px] overflow-y-auto"
    >
      <For each={unattachedTabs()}>
        {(tabData, index) => {
          const { split, item, channel } = tabData;

          let name: string | undefined;
          if (split.type === 'channel') {
            name = channel?.name ?? undefined;
          } else {
            name = item?.name;
          }

          return (
            <Show when={name}>
              {(name) => (
                <>
                  <MenuItem
                    text={name()}
                    icon={() => {
                      return (
                        <EntityIcon
                          targetType={fileTypeToBlockName(split.type)}
                          size="sm"
                        />
                      );
                    }}
                    onClick={() => handleAddAttachment(tabData)}
                  />
                  <Show when={index() < unattachedTabs().length - 1}>
                    <MenuSeparator />
                  </Show>
                </>
              )}
            </Show>
          );
        }}
      </For>

      <Show when={unattachedTabs().length > 1}>
        <MenuSeparator />
        <MenuItem
          text="All"
          icon={() => <PlusIcon width={14} height={14} />}
          onClick={handleAddAll}
        />
      </Show>
    </DropdownMenuContent>
  );
}

export function ActiveTabAttachment(props: ActiveTabAttachmentProps) {
  const [showDropdown, setShowDropdown] = createSignal(false);
  const [hasAutoAttached, setHasAutoAttached] = createSignal(false);
  const history = useHistory();
  const channelsContext = useChannelsContext();
  const channels = () => channelsContext.channels();

  // Get valid active tabs using createMemo
  const validActiveTabs = createMemo(() => {
    const splitManager = globalSplitManager();
    if (!splitManager) return [];

    const splits = splitManager.splits();
    const historyItems = history();
    const channelList = channels();

    // Deduplicate by type:id key and resolve names from history/channels
    const uniqueSplits = new Map<
      string,
      {
        split: SplitContent;
        item: BasicDocument | null;
        channel: ChannelWithParticipants | null;
      }
    >();

    for (const split of splits) {
      // TODO: need smarter type checking/inference
      if (
        split.content.type === 'component' ||
        !SUPPORTED_CHAT_ATTACHMENT_BLOCKS.includes(split.content.type)
      ) {
        continue;
      }

      const key = `${split.content.type}:${split.content.id}`;
      if (!uniqueSplits.has(key)) {
        // Find matching item in history
        const historyItem =
          historyItems.find((item) => item.id === split.content.id) || null;
        if (!historyItem || historyItem.type !== 'document') {
          continue;
        }

        // Find matching channel if this is a channel split
        const channelItem =
          split.content.type === 'channel'
            ? channelList.find((channel) => channel.id === split.content.id) ||
              null
            : null;

        uniqueSplits.set(key, {
          split: split.content,
          item: historyItem,
          channel: channelItem,
        });
      }
    }

    return Array.from(uniqueSplits.values());
  });

  // Auto-attach all available context when component first loads
  createEffect(() => {
    if (!props.attachAllOnMount) return;

    const tabs = validActiveTabs();
    if (tabs.length > 0 && !hasAutoAttached()) {
      const attachments: Attachment[] = [];
      for (const tabData of tabs) {
        const { split, item, channel } = tabData;
        const attachment = convertSplitToAttachment(split, item, channel);
        if (attachment) {
          attachments.push(attachment);
        }
      }
      if (attachments.length > 0) {
        props.onAddAll(attachments);
        setHasAutoAttached(true);
      }
    }
  });

  // Count attached tabs (from available context)
  const attachedTabCount = createMemo(() => {
    const availableTabs = validActiveTabs();
    const currentAttachments = props.attachedAttachments();

    if (availableTabs.length === 0) return 0;

    // Count available tabs that are in current attachments
    const attachedIds = new Set(
      currentAttachments.map((att) => att.attachmentId)
    );
    let count = 0;
    for (const { split } of availableTabs) {
      if (attachedIds.has(split.id)) {
        count++;
      }
    }
    return count;
  });

  const unattachedTabCount = createMemo(() => {
    const availableTabs = validActiveTabs();
    const attachedCount = attachedTabCount();
    return availableTabs.length - attachedCount;
  });

  const hasUnattachedTabs = createMemo(() => unattachedTabCount() > 0);

  return (
    <Show when={hasUnattachedTabs()}>
      <div class="py-[1.5] px-2 hover:bg-hover hover-transition-bg text-xs border border-edge border-dashed">
        <DropdownMenu
          open={showDropdown()}
          onOpenChange={setShowDropdown}
          placement="top-start"
        >
          <DropdownMenu.Trigger>
            <div
              class="flex items-center gap-1 text-ink"
              onClick={() => setShowDropdown(!showDropdown())}
            >
              Tabs
            </div>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <AddContextDropdown
              activeTabs={validActiveTabs()}
              onAddAttachment={props.onAddAttachment}
              onAddAll={props.onAddAll}
              attachedAttachments={props.attachedAttachments}
            />
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
    </Show>
  );
}
