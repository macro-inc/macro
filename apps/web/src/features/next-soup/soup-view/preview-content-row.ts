import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import type { EntityData } from '@entity';
import { previewSourceEntityId } from '../preview-history';

export function previewContentMatchesEntity(
  content: SplitContent,
  entity: EntityData
) {
  const sourceEntityId = previewSourceEntityId(content);
  if (sourceEntityId !== undefined) return entity.id === sourceEntityId;

  if (entity.id === content.id) return true;
  if (content.type !== 'channel') return false;
  const params = content.params as
    | Record<string, string | undefined>
    | undefined;

  if (entity.type === 'channel_message') {
    return (
      entity.channelId === content.id &&
      entity.messageId === params?.[CHANNEL_PARAMS.message]
    );
  }

  if (entity.type === 'channel_thread') {
    return (
      entity.channelId === content.id &&
      entity.threadId === params?.[CHANNEL_PARAMS.thread]
    );
  }

  return false;
}
