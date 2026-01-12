import { useChannelName } from '@core/component/ChannelsProvider';
import { EntityIcon as CoreEntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isAccessiblePreviewItem, useItemPreview } from '@core/signal/preview';
import { idToDisplayName } from '@core/user';
import ChannelBuildingIcon from '@icon/duotone/building-office-duotone.svg';
import GlobeIcon from '@icon/duotone/globe-duotone.svg';
import ChannelIcon from '@icon/duotone/hash-duotone.svg';
import UserDuotoneIcon from '@icon/duotone/user-duotone.svg';
import ThreeUsersIcon from '@icon/duotone/users-three-duotone.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { type Accessor, createMemo, type JSX } from 'solid-js';

const ICON_CLASSES = 'size-4 text-ink-muted';

/** Entity types that require preview lookup for name/icon resolution */
const PREVIEWABLE_ENTITY_TYPES: EntityType[] = [
  'DOCUMENT',
  'TASK',
  'PROJECT',
  'CHAT',
  'CHANNEL',
  'THREAD',
];

type PropertyEntityDisplayResult = {
  /** Resolved display name for the entity */
  name: Accessor<string>;
  /** Icon JSX element for the entity */
  icon: Accessor<JSX.Element>;
  /** Whether preview data is still loading */
  isLoading: Accessor<boolean>;
  /** Block or file type for linking (null if not linkable) */
  blockOrFileType: Accessor<string | null>;
  /** URL params for navigation (e.g., message ID for threads) */
  linkParams: Accessor<Record<string, string> | undefined>;
};

/**
 * Hook to resolve entity display information (name, icon) for property entity values.
 * Handles preview fetching, channel name resolution, and user display names.
 *
 * @param entityId - The entity's unique identifier
 * @param entityType - The type of entity (USER, CHANNEL, DOCUMENT, etc.)
 * @param options - Optional configuration
 * @returns Object with name, icon, isLoading, and blockOrFileType accessors
 */
export function usePropertyEntityDisplay(
  entityId: Accessor<string>,
  entityType: Accessor<EntityType>,
  options?: {
    /** Custom fallback icon for unknown entity types (null to show nothing) */
    fallbackIcon?: JSX.Element | null;
    /** Specific message ID for THREAD/CHANNEL/CHAT entities */
    specificMessageId?: Accessor<string | null | undefined>;
  }
): PropertyEntityDisplayResult {
  const needsPreview = () =>
    PREVIEWABLE_ENTITY_TYPES.includes(entityType().toUpperCase() as EntityType);

  // Map entity type to preview type
  const getPreviewType = () => {
    const type = entityType().toUpperCase();
    if (type === 'TASK') return 'document';
    if (type === 'THREAD') return 'email';
    return type.toLowerCase() as 'document' | 'project' | 'chat' | 'channel';
  };

  const [preview] = useItemPreview({
    id: needsPreview() ? entityId() : '',
    type: needsPreview() ? getPreviewType() : undefined,
  });

  const channelName = useChannelName(
    entityType().toUpperCase() === 'CHANNEL' ? entityId() : '',
    'Unknown Channel'
  );

  const isLoading = createMemo(() => {
    if (!needsPreview()) return false;
    const previewItem = preview();
    return !previewItem || previewItem.loading;
  });

  const name = createMemo(() => {
    const type = entityType().toUpperCase();
    switch (type) {
      case 'USER': {
        const displayName = idToDisplayName(entityId());
        return displayName.replace('macro|', '');
      }
      case 'CHANNEL':
        return channelName() ?? 'Unknown Channel';
      case 'DOCUMENT':
      case 'TASK':
      case 'PROJECT':
      case 'CHAT':
      case 'THREAD': {
        const previewItem = preview();
        if (!previewItem || previewItem.loading) return 'Loading...';
        if (!isAccessiblePreviewItem(previewItem)) return 'Unavailable';
        return previewItem.name || `Unknown ${type.toLowerCase()}`;
      }
      case 'COMPANY':
        return entityId() ?? 'Company';
      default:
        return entityId();
    }
  });

  const icon = createMemo(() => {
    const type = entityType().toUpperCase();
    switch (type) {
      case 'USER':
        return <UserIcon id={entityId()} size="xs" />;

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
            return <UserDuotoneIcon class={ICON_CLASSES} />;
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

      case 'TASK':
        return <CoreEntityIcon targetType="task" size="xs" />;

      case 'DOCUMENT': {
        const previewItem = preview();
        if (
          !previewItem ||
          previewItem.loading ||
          !isAccessiblePreviewItem(previewItem)
        ) {
          return <CoreEntityIcon targetType="unknown" size="xs" />;
        }

        // Tasks are documents with subType 'task'
        if (previewItem.subType?.type === 'task') {
          return <CoreEntityIcon targetType="task" size="xs" />;
        }

        const fileType = previewItem.fileType;
        const blockName = fileType
          ? fileTypeToBlockName(fileType, true)
          : 'unknown';
        return <CoreEntityIcon targetType={blockName} size="xs" />;
      }

      case 'PROJECT':
        return <CoreEntityIcon targetType="project" size="xs" />;

      case 'CHAT':
        return <CoreEntityIcon targetType="chat" size="xs" />;

      case 'COMPANY':
        return <CoreEntityIcon targetType="company" size="xs" />;

      case 'THREAD':
        return <CoreEntityIcon targetType="email" size="xs" />;

      default:
        if (options && 'fallbackIcon' in options) {
          return options.fallbackIcon;
        }
        return <CoreEntityIcon targetType="unknown" size="xs" />;
    }
  });

  const blockOrFileType = createMemo(() => {
    const type = entityType().toUpperCase();
    // For channels and chats, use the entity type directly (lowercase for BlockLink)
    const linkableTypes: EntityType[] = ['CHANNEL', 'CHAT', 'PROJECT'];
    if (linkableTypes.includes(type as EntityType)) {
      return type.toLowerCase();
    }

    // Tasks are aliased as 'task' for routing
    if (type === 'TASK') {
      return 'task';
    }

    // Threads route to email block
    if (type === 'THREAD') {
      return 'email';
    }

    // For documents, get the file type from preview
    if (type === 'DOCUMENT') {
      const previewItem = preview();
      if (
        !previewItem ||
        previewItem.loading ||
        !isAccessiblePreviewItem(previewItem)
      ) {
        return null;
      }
      // Tasks are documents with subType 'task'
      if (previewItem.subType?.type === 'task') {
        return 'task';
      }
      return previewItem.fileType || null;
    }

    return null;
  });

  const linkParams = createMemo((): Record<string, string> | undefined => {
    const messageId = options?.specificMessageId?.();
    if (!messageId) return undefined;

    const type = entityType().toUpperCase();
    switch (type) {
      case 'THREAD':
        return { email_message_id: messageId };
      case 'CHANNEL':
        return { channel_message_id: messageId };
      case 'CHAT':
        return { message_id: messageId };
      default:
        return undefined;
    }
  });

  return {
    name,
    icon,
    isLoading,
    blockOrFileType,
    linkParams,
  };
}
