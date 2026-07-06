import type { SplitContent } from '@app/component/split-layout/layoutManager';
import { getChannelParams } from '@block-channel/utils/link';
import type { EntityIconSelector } from '@core/component/EntityIcon';
import { getIconConfig } from '@core/component/EntityIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { Favorite } from '@service-storage/generated/schemas/favorite';

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

export function favoriteDisplayName(favorite: Favorite): string {
  return (
    favorite.name?.trim() ||
    getIconConfig(favoriteIconType(favorite) ?? 'default').prettyName ||
    'Untitled'
  );
}
