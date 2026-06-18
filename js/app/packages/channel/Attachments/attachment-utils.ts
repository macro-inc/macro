import type { SplitContent } from '@app/component/split-layout/layoutManager';
import { getChannelParams } from '@channel/Channel/link';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { EntityData } from '@entity';
import { match } from 'ts-pattern';

/** size-25.5 = 102px, matching the tile size in MediaGrid. */
export const THUMB_SIZE = 102;
/** gap-1.5 = 6px between tiles. */
export const THUMB_GAP = 6;

/** Number of square thumbnails that fit in a row of the given content width. */
export function itemsPerRow(containerWidth: number): number {
  if (containerWidth <= 0) return 1;
  return Math.max(
    1,
    Math.floor((containerWidth + THUMB_GAP) / (THUMB_SIZE + THUMB_GAP))
  );
}

export function getEntityClickContent(entity: EntityData): SplitContent {
  return match(entity)
    .with({ type: 'document' }, (e) => ({
      type: fileTypeToBlockName(e.subType?.type ?? e.fileType),
      id: e.id,
    }))
    .with({ type: 'chat' }, (e) => ({ type: 'chat' as const, id: e.id }))
    .with({ type: 'email' }, (e) => ({ type: 'email' as const, id: e.id }))
    .with({ type: 'channel' }, (e) => ({
      type: 'channel' as const,
      id: e.id,
    }))
    .with({ type: 'project' }, (e) => ({
      type: 'project' as const,
      id: e.id,
    }))
    .with({ type: 'channel_message' }, (e) => ({
      type: 'channel' as const,
      id: e.channelId,
      params: getChannelParams(e.messageId, e.threadId),
    }))
    .with({ type: 'call' }, (e) => ({
      type: 'call' as const,
      id: e.id,
    }))
    .with({ type: 'automation' }, (e) => ({
      type: 'automation' as const,
      id: e.id,
    }))
    .with({ type: 'foreign' }, () => {
      throw new Error('foreign entities do not support channel attachments');
    })
    .with({ type: 'crm_company' }, () => {
      throw new Error('crm companies are not openable as attachments');
    })
    .with({ type: 'crm_contact' }, () => {
      throw new Error('crm contacts are not openable as attachments');
    })
    .exhaustive();
}
