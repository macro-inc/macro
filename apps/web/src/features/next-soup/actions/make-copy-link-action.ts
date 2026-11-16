import { copyCalendarEventMentionTarget } from '@app/features/calendar-view/copy-event-mention';
import { t } from '@app/lib/i18n';
import { getChannelParams } from '@block-channel/utils/link';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { writeClipboardData } from '@core/util/dataTransfer';
import { buildSimpleEntityUrl } from '@core/util/url';
import { type EntityData, isGithubPrEntity } from '@entity';
import { calendarEventLinkTarget } from '../utils';
import type { EntityActionListState } from './entity-action-context';

/**
 * Get the URL type/path segment for an entity
 */
const getEntityUrlType = (entity: EntityData): string => {
  if (entity.type === 'agent_session') return 'agent';
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
  if (isGithubPrEntity(entity)) {
    return buildSimpleEntityUrl({
      type: 'reviews/pr',
      id: encodeURIComponent(entity.id),
    });
  }

  return buildSimpleEntityUrl(
    {
      type: getEntityUrlType(entity),
      id: getEntityUrlId(entity),
    },
    getEntityUrlParams(entity)
  );
};

export const makeCopyLinkAction = (options: { silent?: boolean } = {}) => {
  const canExecute = (_entity: EntityData): boolean => true;

  const execute = async (entities: EntityData[]) => {
    // Only copy link for the first entity (doesn't make sense for bulk)
    const entity = entities[0];
    if (!entity) return;

    // The calendar is a singleton block, so there is no /app/calendar_event
    // route to link an event by id. Events copy the deep link the calendar's
    // own action writes, with the mention flavor behind it.
    if (entity.type === 'calendar_event') {
      return copyCalendarEventMentionTarget(
        {
          ...calendarEventLinkTarget(entity),
          title: entity.name || '(No title)',
        },
        options
      );
    }

    const url = getEntityUrl(entity);

    const copied = await writeClipboardData({ 'text/plain': url });
    if (!copied) {
      toast.failure(t('entityActions.toastCopyFailed', { count: 1 }));
      return false;
    }
    if (!options.silent) toast.success(t('entityActions.toastLinkCopied'));
    return true;
  };

  /** Blocks already know their id and URL discriminator even when their full
   * entity is absent from Quick Access (notably email threads and calls). */
  const executeByBlock = async (id: string, blockType: string) => {
    const copied = await writeClipboardData({
      'text/plain': buildSimpleEntityUrl({ id, type: blockType }),
    });
    if (!copied) {
      toast.failure(t('entityActions.toastCopyFailed', { count: 1 }));
      return false;
    }
    if (!options.silent) toast.success(t('entityActions.toastLinkCopied'));
    return true;
  };

  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    // Don't clear selection or change focus for copy link.
    return execute(entities);
  };

  return { canExecute, execute, executeByBlock, executeWithSoup };
};
