import { getChannelParams } from '@block-channel/utils/link';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import type { EntityIconSelector } from '@core/component/EntityIcon';
import { getIconConfig } from '@core/component/EntityIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import {
  type ItemEntity,
  isAccessiblePreviewItem,
  useItemPreview,
} from '@queries/preview';
import { ChannelTypeEnum } from '@service-storage/client';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { type Accessor, createMemo } from 'solid-js';

/** The block to open for a favorite (also its URL type segment). */
export function favoriteBlockName(favorite: Favorite) {
  if (favorite.entityType === 'document') {
    return fileTypeToBlockName(favorite.documentSubType ?? favorite.fileType);
  }
  if (favorite.entityType === 'email_thread') return 'email' as const;
  // Passes chat/channel/project/call through and remaps channel_message and
  // CRM entity types to their block names.
  return fileTypeToBlockName(favorite.entityType);
}

/**
 * The split content that opens a favorite. Channel-message favorites open
 * their owning channel (hydrated as `channelId`) focused on the message.
 */
export function favoriteSplitContent(favorite: Favorite): SplitContent {
  if (favorite.entityType === 'channel_message' && favorite.channelId) {
    return {
      type: 'channel',
      id: favorite.channelId,
      params: getChannelParams(favorite.entityId),
    };
  }
  return { type: favoriteBlockName(favorite), id: favorite.entityId };
}

export function favoriteIconType(favorite: Favorite): EntityIconSelector {
  if (
    favorite.entityType === 'channel' ||
    favorite.entityType === 'channel_message'
  ) {
    return (favorite.channelType ?? 'channel') as EntityIconSelector;
  }
  if (favorite.entityType === 'document') {
    // icon: true keeps e.g. docx showing the write icon instead of pdf
    return fileTypeToBlockName(
      favorite.documentSubType ?? favorite.fileType,
      true
    );
  }
  return favoriteBlockName(favorite);
}

/**
 * The preview entity that names a favorite: the favorite's own entity for
 * kinds the preview pipeline covers, the owning channel for channel-message
 * favorites, and undefined for kinds without a preview fetcher
 * (e.g. crm_contact), which fall back to their entity-kind label.
 */
function favoritePreviewEntity(favorite: Favorite): ItemEntity | undefined {
  switch (favorite.entityType) {
    case 'channel':
      return { id: favorite.entityId, type: 'channel' };
    case 'channel_message':
      return favorite.channelId
        ? { id: favorite.channelId, type: 'channel' }
        : undefined;
    case 'email_thread':
      return { id: favorite.entityId, type: 'email' };
    case 'document':
    case 'chat':
    case 'project':
    case 'call':
    case 'crm_company':
      return { id: favorite.entityId, type: favorite.entityType };
    default:
      return undefined;
  }
}

/** Entity-kind fallback used until a favorite's preview resolves. */
export function favoriteDisplayName(favorite: Favorite): string {
  return (
    getIconConfig(favoriteIconType(favorite) ?? 'default').prettyName ||
    'Untitled'
  );
}

/**
 * The user whose avatar represents a DM channel favorite: the other
 * participant, resolved from the channels list like the channel rows in the
 * rest of the sidebar. Undefined for non-DM favorites (and while the channel
 * list loads), so callers can fall back to the entity icon.
 *
 * Call during component setup. The favorite's identity must be stable for
 * the component's lifetime (favorites lists key rows by entity, so it is).
 */
export function useFavoriteDmRecipientId(
  favorite: Favorite
): Accessor<string | undefined> {
  const entity = favoritePreviewEntity(favorite);
  const channelId = entity?.type === 'channel' ? entity.id : undefined;
  if (!channelId) return () => undefined;
  const ctx = useChannelsContext();
  const userId = useUserId();
  return createMemo(() => {
    const channel = ctx.channelsById()[channelId];
    if (channel?.channel_type !== ChannelTypeEnum.DirectMessage) {
      return undefined;
    }
    // A self-DM has no other participant; show the viewer's own avatar.
    const recipient =
      channel.participants.find((p) => p.user_id !== userId()) ??
      channel.participants[0];
    return recipient?.user_id;
  });
}

/**
 * Reactive display name for a favorite: subscribes to the entity's preview
 * (fetching it if needed) and resolves like `favoriteDisplayName`.
 *
 * Call during component setup. The favorite's identity must be stable for
 * the component's lifetime (favorites lists key rows by entity, so it is).
 */
export function useFavoriteDisplayName(favorite: Favorite): Accessor<string> {
  const entity = favoritePreviewEntity(favorite);
  if (!entity) return () => favoriteDisplayName(favorite);
  const [preview] = useItemPreview(() => entity);
  return () => {
    const item = preview();
    if (isAccessiblePreviewItem(item) && item.name.trim()) return item.name;
    return favoriteDisplayName(favorite);
  };
}
