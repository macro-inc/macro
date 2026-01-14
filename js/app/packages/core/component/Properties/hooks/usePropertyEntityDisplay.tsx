import { useChannelName } from '@core/component/ChannelsProvider';
import { EntityIcon as CoreEntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import {
  isAccessiblePreviewItem,
  type PreviewItem,
  type PreviewItemAccess,
  useItemPreview,
} from '@core/signal/preview';
import { tryMacroId, useDisplayName } from '@core/user';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { type Accessor, createMemo, type JSX } from 'solid-js';
import { entityTypeToItemType } from '../utils';
import { match } from 'ts-pattern';

const PREVIEWABLE_ENTITY_TYPES: EntityType[] = [
  'DOCUMENT',
  'TASK',
  'PROJECT',
  'CHAT',
  'CHANNEL',
  'THREAD',
] as const;

type PreviewableEntityType = (typeof PREVIEWABLE_ENTITY_TYPES)[number];

const isPreviewable = (
  type: EntityType | undefined
): type is PreviewableEntityType => {
  if (!type) return false;
  return PREVIEWABLE_ENTITY_TYPES.includes(type);
};

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

const checkPreviewItem = (item?: PreviewItem): item is PreviewItemAccess => {
  if (!item) return false;
  if (!isAccessiblePreviewItem(item)) return false;
  if (item.loading) return false;
  return true;
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
  const previewType = () => entityTypeToItemType(entityType());

  const previewWrapper = () => {
    const eType = entityType();
    const pType = previewType();
    if (isPreviewable(eType)) {
      return useItemPreview({
        id: entityId(),
        type: pType,
      })[0];
    }
  };
  const preview = createMemo(() => previewWrapper()?.());

  const channelNameWrapper = () => {
    const eType = entityType();
    if (eType === 'CHANNEL') {
      return useChannelName(entityId());
    }
  };
  const channelName = createMemo(() => channelNameWrapper()?.());

  const userNameWrapper = () => {
    const eType = entityType();
    if (eType === 'USER') {
      return useDisplayName(tryMacroId(entityId()))[0];
    }
  };
  const userName = createMemo(() => userNameWrapper()?.() ?? '');

  const isLoading = createMemo(() => {
    if (!isPreviewable(entityType())) return false;
    const previewItem = preview();
    return !previewItem || previewItem.loading;
  });

  const name = createMemo(() =>
    match(entityType())
      .with('USER', () => userName())
      .with('CHANNEL', () => channelName() || 'Channel')
      .with('COMPANY', () => entityId())
      .otherwise(() => {
        const item = preview();
        if (!item || item.loading) return 'Loading...';
        if (isAccessiblePreviewItem(item)) {
          return item.name;
        }
        return `Unknown ${entityType().toLowerCase()}`;
      })
  );

  const icon = createMemo(() =>
    match(entityType())
      .with('USER', () => <UserIcon id={entityId()} size="xs" />)
      .with('CHANNEL', () => <CoreEntityIcon targetType="channel" size="xs" />)
      .with('TASK', () => <CoreEntityIcon targetType="task" size="xs" />)
      .with('DOCUMENT', () => {
        const item = preview();
        if (!checkPreviewItem(item)) {
          return <CoreEntityIcon targetType="unknown" size="xs" />;
        }
        const { subType, fileType } = item;
        const blockName = fileTypeToBlockName(subType?.type ?? fileType, true);
        return <CoreEntityIcon targetType={blockName} size="xs" />;
      })
      .with('PROJECT', () => <CoreEntityIcon targetType="project" size="xs" />)
      .with('CHAT', () => <CoreEntityIcon targetType="chat" size="xs" />)
      .with('COMPANY', () => <CoreEntityIcon targetType="company" size="xs" />)
      .with('THREAD', () => <CoreEntityIcon targetType="email" size="xs" />)
      .otherwise(() => {
        if (options && 'fallbackIcon' in options) {
          return options.fallbackIcon;
        }
        return <CoreEntityIcon targetType="unknown" size="xs" />;
      })
  );

  const blockOrFileType = createMemo(() =>
    match(entityType())
      .with('CHANNEL', () => 'channel')
      .with('CHAT', () => 'chat')
      .with('PROJECT', () => 'project')
      .with('TASK', () => 'task')
      .with('THREAD', () => 'email')
      .with('DOCUMENT', () => {
        const item = preview();
        if (!checkPreviewItem(item)) {
          return null;
        }
        if (item.subType?.type === 'task') {
          return 'task';
        }
        return item.fileType || null;
      })
      .otherwise(() => null)
  );

  const linkParams = createMemo((): Record<string, string> | undefined => {
    const messageId = options?.specificMessageId?.();
    if (!messageId) return undefined;

    return match(entityType())
      .with('THREAD', () => ({ email_message_id: messageId }))
      .with('CHANNEL', () => ({ channel_message_id: messageId }))
      .with('CHAT', () => ({ message_id: messageId }))
      .otherwise(() => undefined);
  });

  return {
    name,
    icon,
    isLoading,
    blockOrFileType,
    linkParams,
  };
}
