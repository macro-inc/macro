import type { EntityItem } from '@core/context/quickAccess';
import type { ChannelEntity, EmailEntity } from '@entity';
import { trackMention } from '@core/signal/mention';
import {
  INSERT_DATE_MENTION_COMMAND,
  INSERT_DOCUMENT_MENTION_COMMAND,
  INSERT_GROUP_MENTION_COMMAND,
} from '../../../../plugins/mentions';
import { REMOVE_INLINE_SEARCH_COMMAND } from '../../../../plugins';
import type {
  HandlerDependencies,
  MentionItem,
} from '../../../../utils/mentionsUtils';
import { handleUserMention } from '../../../../utils/mentionsUtils';
import type { DateOption } from '@core/util/dateSearch/useDateSearch';
import { getBlockNameFromEntity } from './entityUtils';

/**
 * Handle entity mention (documents, channels, emails, etc.).
 */
export async function handleEntityMention(
  item: EntityItem,
  dependencies: HandlerDependencies
): Promise<void> {
  const {
    editor,
    blockName,
    blockId,
    onDocumentMention,
    disableMentionTracking,
    onEmailMention,
  } = dependencies;

  const entity = item.data;

  let mentionId: string | undefined;
  if (
    blockId &&
    blockName !== 'channel' &&
    blockName !== 'chat' &&
    !disableMentionTracking
  ) {
    const trackType =
      item.bucket === 'channel' || item.bucket === 'dm'
        ? 'channel'
        : 'document';
    mentionId = await trackMention(blockId, trackType, entity.id);
  }

  const blockNameForMention = getBlockNameFromEntity(item);
  const itemName = entity.name ?? (item.bucket === 'email' ? 'No Subject' : '');

  if (item.bucket === 'email') {
    onEmailMention?.(entity as unknown as EmailEntity);
  } else {
    onDocumentMention?.(entity as unknown as any);
  }

  editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
    documentId: entity.id,
    documentName: itemName,
    blockName: blockNameForMention,
    mentionUuid: mentionId,
    channelType:
      item.bucket === 'channel' || item.bucket === 'dm'
        ? (entity as ChannelEntity).channelType
        : undefined,
  });
}

/**
 * Handle date mention from DateOption.
 */
export async function handleDateMentionFromOption(
  dateOption: DateOption,
  dependencies: HandlerDependencies
): Promise<void> {
  const { editor } = dependencies;
  editor.dispatchCommand(INSERT_DATE_MENTION_COMMAND, {
    date: dateOption.date.toISOString(),
    displayFormat: dateOption.displayText,
  });
}

/**
 * Handle group mention (e.g., @here).
 */
export async function handleGroupMentionItem(
  group: { id: string; groupAlias: string },
  dependencies: HandlerDependencies
): Promise<void> {
  const { editor } = dependencies;
  editor.dispatchCommand(INSERT_GROUP_MENTION_COMMAND, {
    groupAlias: group.groupAlias,
  });
}

/**
 * Creates a handler for MentionItem selection.
 */
export function createItemHandler(dependencies: HandlerDependencies) {
  return async (item: MentionItem): Promise<void> => {
    if (!item) return;
    dependencies.editor.dispatchCommand(
      REMOVE_INLINE_SEARCH_COMMAND,
      undefined
    );
    switch (item.kind) {
      case 'user':
        return await handleUserMention(item.data, dependencies);
      case 'date':
        return await handleDateMentionFromOption(item.data, dependencies);
      case 'group':
        return await handleGroupMentionItem(item.data, dependencies);
      case 'entity':
        return await handleEntityMention(item, dependencies);
      case 'command':
        return;
    }
  };
}
