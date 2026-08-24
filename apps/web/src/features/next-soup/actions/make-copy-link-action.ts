import { copyCalendarEventMentionTarget } from '@block-calendar/copy-event-mention';
import { getChannelParams } from '@block-channel/utils/link';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { buildSimpleEntityUrl } from '@core/util/url';
import { type EntityData, isGithubPrEntity } from '@entity';
import type { SoupState } from '../create-soup-state';
import { calendarEventLinkTarget } from '../utils';

/**
 * Get the URL type/path segment for an entity
 */
const getEntityUrlType = (entity: EntityData): string => {
  if (entity.type === 'document') {
    const { fileType, subType } = entity;
    return fileTypeToBlockName(subType?.type ?? fileType);
  } else if (
    entity.type === 'channel_message' ||
    entity.type === 'channel_thread'
  ) {
    return 'channel';
  }
  return entity.type;
};

const getEntityUrlId = (entity: EntityData): string => {
  if (entity.type === 'channel_message' || entity.type === 'channel_thread') {
    return entity.channelId;
  }
  return entity.id;
};

const getEntityUrlParams = (
  entity: EntityData
): Record<string, string> | undefined => {
  if (entity.type !== 'channel_message' && entity.type !== 'channel_thread') {
    return undefined;
  }
  return getChannelParams(entity.messageId, entity.threadId);
};

const getEntityUrl = (entity: EntityData): string => {
  // TODO(dev-rb/github): Return the Macro /pr/:id URL.
  if (isGithubPrEntity(entity)) return entity.metadata.url;

  return buildSimpleEntityUrl(
    {
      type: getEntityUrlType(entity),
      id: getEntityUrlId(entity),
    },
    getEntityUrlParams(entity)
  );
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

    // The calendar is a singleton block, so there is no /app/calendar_event
    // route to link an event by id. Events copy the deep link the calendar's
    // own action writes, with the mention flavor behind it.
    if (entity.type === 'calendar_event') {
      await copyCalendarEventMentionTarget({
        ...calendarEventLinkTarget(entity),
        title: entity.name || '(No title)',
      });
      return;
    }

    const url = getEntityUrl(entity);

    await navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
  };

  /** Blocks already know their id and URL discriminator even when their full
   * entity is absent from Quick Access (notably email threads and calls). */
  const executeByBlock = async (id: string, blockType: string) => {
    await navigator.clipboard.writeText(
      buildSimpleEntityUrl({ id, type: blockType })
    );
    toast.success('Link copied to clipboard');
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    await execute(entities);
    // Don't clear selection or change focus for copy link
  };

  return { canExecute, execute, executeByBlock, executeWithSoup };
};
