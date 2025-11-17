import { useChannelName } from '@core/component/ChannelsProvider';
import { EntityIcon } from '@core/component/EntityIcon';
import { IconButton } from '@core/component/IconButton';
import { BlockLink } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { UserIcon } from '@core/component/UserIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isAccessiblePreviewItem, useItemPreview } from '@core/signal/preview';
import { idToDisplayName } from '@core/user';
import DeleteIcon from '@icon/bold/x-bold.svg';
import ChannelBuildingIcon from '@icon/duotone/building-office-duotone.svg';
import GlobeIcon from '@icon/duotone/globe-duotone.svg';
import ChannelIcon from '@icon/duotone/hash-duotone.svg';
import User from '@icon/duotone/user-duotone.svg';
import ThreeUsersIcon from '@icon/duotone/users-three-duotone.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  type Component,
  createMemo,
  createSignal,
  type ParentProps,
  Show,
} from 'solid-js';
import type { Property } from './types';

type EntityValueDisplayProps = ParentProps<{
  property: Property;
  entityId: string;
  entityType: EntityType;
  canEdit?: boolean;
  onRemove?: () => void;
  isSaving?: boolean;
}>;

const ICON_CLASSES = 'size-4 text-ink-muted';

export const EntityValueDisplay: Component<EntityValueDisplayProps> = (
  props
) => {
  const [isHovered, setIsHovered] = createSignal(false);

  // Get preview for items that need it (document, project, chat, channel for icon)
  const previewTypes: EntityType[] = ['DOCUMENT', 'PROJECT', 'CHAT', 'CHANNEL'];
  const needsPreview = previewTypes.includes(props.entityType);

  const [preview] = useItemPreview({
    id: needsPreview ? props.entityId : '',
    type: needsPreview
      ? (props.entityType.toLowerCase() as
          | 'document'
          | 'project'
          | 'chat'
          | 'channel')
      : undefined,
  });

  const entityName = createMemo(() => {
    switch (props.entityType) {
      case 'USER': {
        const displayName = idToDisplayName(props.entityId);
        return displayName.replace('macro|', '');
      }
      case 'CHANNEL': {
        const channelName = useChannelName(props.entityId, 'Unknown Channel');
        return channelName();
      }
      case 'DOCUMENT':
      case 'PROJECT':
      case 'CHAT': {
        const previewItem = preview();
        if (!previewItem || previewItem.loading) return 'Loading...';
        if (!isAccessiblePreviewItem(previewItem)) return 'Unavailable';
        return previewItem.name || `Unknown ${props.entityType.toLowerCase()}`;
      }
      default:
        return props.entityId;
    }
  });

  const entityIcon = createMemo(() => {
    switch (props.entityType) {
      case 'USER':
        return (
          <UserIcon
            id={props.entityId}
            size="xs"
            isDeleted={false}
            suppressClick={true}
          />
        );

      case 'CHANNEL': {
        const previewItem = preview();
        if (
          !previewItem ||
          previewItem.loading ||
          !isAccessiblePreviewItem(previewItem)
        ) {
          return <ChannelIcon class={ICON_CLASSES} />;
        }

        const channelType = previewItem.channelType;
        switch (channelType) {
          case 'direct_message':
            return <User class={ICON_CLASSES} />;
          case 'private':
            return <ThreeUsersIcon class={ICON_CLASSES} />;
          case 'organization':
            return <ChannelBuildingIcon class={ICON_CLASSES} />;
          case 'public':
            return <GlobeIcon class={ICON_CLASSES} />;
          default:
            return <ChannelIcon class={ICON_CLASSES} />;
        }
      }

      case 'DOCUMENT': {
        const previewItem = preview();
        if (
          !previewItem ||
          previewItem.loading ||
          !isAccessiblePreviewItem(previewItem)
        ) {
          return <EntityIcon targetType="unknown" size="xs" />;
        }

        const fileType = previewItem.fileType;
        const blockName = fileType
          ? fileTypeToBlockName(fileType, true)
          : 'unknown';
        return <EntityIcon targetType={blockName} size="xs" />;
      }

      case 'PROJECT':
        return <EntityIcon targetType="project" size="xs" />;

      case 'CHAT':
        return <EntityIcon targetType="chat" size="xs" />;

      default:
        return <EntityIcon targetType="unknown" size="xs" />;
    }
  });

  const blockOrFileType = createMemo(() => {
    // For channels and chats, use the entity type directly (lowercase for BlockLink)
    const linkableTypes: EntityType[] = ['CHANNEL', 'CHAT', 'PROJECT'];
    if (linkableTypes.includes(props.entityType)) {
      return props.entityType.toLowerCase();
    }

    // For documents, get the file type from preview
    if (props.entityType === 'DOCUMENT') {
      const previewItem = preview();
      if (
        !previewItem ||
        previewItem.loading ||
        !isAccessiblePreviewItem(previewItem)
      ) {
        return null;
      }
      return previewItem.fileType || null;
    }

    return null;
  });

  const content = (
    <div class="flex items-center gap-2">
      <div class="flex-shrink-0">{entityIcon()}</div>
      <span class="truncate font-mono">{entityName()}</span>
    </div>
  );

  const innerContent = (
    <Show when={blockOrFileType()} fallback={props.children ?? content}>
      {(linkType) => (
        <BlockLink blockOrFileName={linkType()} id={props.entityId}>
          {props.children ?? content}
        </BlockLink>
      )}
    </Show>
  );

  return (
    <div
      class="relative inline-flex max-w-[140px] shrink-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        class={`text-xs px-2 py-1 border border-edge hover:bg-hover cursor-pointer bg-transparent text-ink inline-flex items-center w-full min-h-[24px]`}
      >
        <span class="truncate flex-1">{innerContent}</span>
        <Show
          when={
            props.canEdit && isHovered() && !props.isSaving && props.onRemove
          }
        >
          <div class="absolute right-1 inset-y-0 flex items-center">
            <IconButton
              icon={DeleteIcon}
              theme="clear"
              size="xs"
              class="!text-failure !bg-[#2a2a2a] hover:!bg-[#444444] !cursor-pointer !w-4 !h-4 !min-w-4 !min-h-4"
              onClick={props.onRemove}
            />
          </div>
        </Show>
      </div>
    </div>
  );
};
