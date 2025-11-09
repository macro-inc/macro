import type { BlockName } from '@core/block';
import { itemToBlockName } from '@core/constant/allBlocks';
import { isAccessiblePreviewItem, useItemPreview } from '@core/signal/preview';
import type { EntityType } from '@core/types';
import { useDisplayName } from '@core/user/displayName';
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

export const DefaultUserNameResolver: UserNameResolver = async (id: string) =>
  raceTimeout(until(useDisplayName(id)[0]), RESOLVER_TIMEOUT);

const getPreview = async (id: string, type: EntityType) => {
  const [preview] = useItemPreview({ id, type: type as ItemType });
  await raceTimeout(
    until(() => preview() && !preview()!.loading),
    RESOLVER_TIMEOUT
  );
  return preview();
};

export const DefaultDocumentNameResolver: DocumentNameResolver = async (
  id: string,
  type: string
) => {
  const preview = await getPreview(id, type as EntityType);
  if (!isAccessiblePreviewItem(preview)) return undefined;
  return preview.name;
};

export const DefaultNotificationBlockNameResolver: NotificationBlockNameResolver =
  async (entityId: string, entityType: EntityType) => {
    const preview = await getPreview(entityId, entityType);
    if (!isAccessiblePreviewItem(preview)) return undefined;

    return itemToBlockName({
      type: preview.type,
      fileType: preview.fileType,
      name: preview.name,
    });
  };
