import type { BlockName } from '@core/block';
import { itemToResolvedBlockName } from '@core/constant/allBlocks';
import type { EntityType } from '@core/types';
import { macroIdToEmail, tryMacroId, useDisplayName } from '@core/user';
import { getItemPreview, isAccessiblePreviewItem } from '@queries/preview';
import type { ItemType } from '@service-storage/client';
import { raceTimeout, until } from '@solid-primitives/promise';

export type UserNameResolver = (id: string) => Promise<string | undefined>;
export type DocumentNameResolver = (
  id: string,
  type: EntityType
) => Promise<string | undefined>;

export type NotificationBlockNameResolver = (
  entityId: string,
  entityType: EntityType
) => Promise<BlockName | undefined>;

const RESOLVER_TIMEOUT = 1000;

export const DefaultUserNameResolver: UserNameResolver = async (id: string) => {
  const macroId = tryMacroId(id);
  const resolvedName = await raceTimeout(
    until(useDisplayName(macroId)[0]),
    RESOLVER_TIMEOUT
  );
  if (resolvedName) return resolvedName;
  return macroId ? macroIdToEmail(macroId) : id || undefined;
};

const getPreview = async (id: string, type: EntityType) => {
  return await raceTimeout(
    getItemPreview({ id, type: type as ItemType }),
    RESOLVER_TIMEOUT
  );
};

export const DefaultDocumentNameResolver: DocumentNameResolver = async (
  id: string,
  type: string
) => {
  const preview = await getPreview(id, type as EntityType);
  if (!preview || !isAccessiblePreviewItem(preview)) return undefined;
  return preview.name;
};

export const DefaultNotificationBlockNameResolver: NotificationBlockNameResolver =
  async (entityId: string, entityType: EntityType) => {
    const preview = await getPreview(entityId, entityType);
    if (!preview || !isAccessiblePreviewItem(preview)) return undefined;

    return itemToResolvedBlockName({
      type: preview.type,
      fileType: preview.fileType,
      name: preview.name,
    });
  };
