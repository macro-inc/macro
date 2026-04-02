import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { buildSimpleEntityUrl } from '@core/util/url';
import type { EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';

/**
 * Get the URL type/path segment for an entity
 */
const getEntityUrlType = (entity: EntityData): string => {
  if (entity.type === 'document') {
    const { fileType, subType } = entity;
    return fileTypeToBlockName(subType?.type ?? fileType);
  } else if (entity.type === 'channel_message') {
    return 'channel';
  }
  return entity.type;
};

const getEntityUrlId = (entity: EntityData): string => {
  if (entity.type === 'channel_message') {
    return entity.channelId;
  }
  return entity.id;
};

const getEntityUrlParams = (entity: EntityData): Record<string, string> => {
  if (entity.type === 'channel_message') {
    const params = {
      [CHANNEL_PARAMS.message]: entity.messageId,
    };
    if (entity.threadId) {
      params[CHANNEL_PARAMS.thread] = entity.threadId;
    }
    return params;
  }
  return {};
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

    let url: string;
    url = buildSimpleEntityUrl(
      {
        type: getEntityUrlType(entity),
        id: getEntityUrlId(entity),
      },
      getEntityUrlParams(entity)
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
