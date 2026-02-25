import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { buildSimpleEntityUrl } from '@core/util/url';
import type { EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';

/**
 * Get the URL type/path segment for an entity
 */
const getEntityUrlType = (entity: EntityData): string => {
  if (entity.type === 'document') {
    const { fileType, subType } = entity;
    return fileTypeToBlockName(subType?.type ?? fileType);
  }
  return entity.type;
};

export const makeCopyLinkAction = () => {
  const canExecute = (_entity: EntityData): boolean => {
    // Can copy link for any entity type
    return true;
  };

  const execute = async (entities: EntityData[]) => {
    // Only copy link for the first entity (doesn't make sense for bulk)
    const entity = entities[0];
    if (!entity) return;

    const url = buildSimpleEntityUrl(
      {
        type: getEntityUrlType(entity),
        id: entity.id,
      },
      {}
    );

    await navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    await execute(entities);
    // Don't clear selection or change focus for copy link
  };

  return { canExecute, execute, executeWithSoup };
};
