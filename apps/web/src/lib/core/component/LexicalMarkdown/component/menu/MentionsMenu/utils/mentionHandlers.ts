import type { EntityItem } from '@core/context/quickAccess';
import { trackMention } from '@core/signal/mention';
import type { DateOption } from '@core/util/dateSearch/useDateSearch';
import type { ChannelEntity, CrmCompanyEntity, EmailEntity } from '@entity';
import { REMOVE_INLINE_SEARCH_COMMAND } from '../../../../plugins';
import {
  INSERT_AGENT_SESSION_MENTION_COMMAND,
  INSERT_DATE_MENTION_COMMAND,
  INSERT_DOCUMENT_MENTION_COMMAND,
  INSERT_GROUP_MENTION_COMMAND,
} from '../../../../plugins/mentions';
import type {
  HandlerDependencies,
  MentionItem,
} from '../../../../utils/mentionsUtils';
import { handleUserMention } from '../../../../utils/mentionsUtils';
import { getBlockNameFromEntity } from './entityUtils';

// Resolve the display name for a mention insert. `entity.name` is the
// happy path; falls back per-bucket so the inserted mention is never
// blank — empty string here would render an invisible mention until the
// preview fetch lands and re-triggers a Lexical render (typically only
// after the next keystroke).
function entityDisplayName(item: EntityItem): string {
  const name = item.data.name;
  if (name) return name;
  if (item.bucket === 'email') return 'No Subject';
  if (item.bucket === 'crm_company') {
    const domain = (item.data as CrmCompanyEntity).domains?.[0]?.domain;
    return domain ?? 'Unknown company';
  }
  return '';
}

/** Whether a mention inserted into this editor is recorded as a document reference. */
function tracksMentions(dependencies: HandlerDependencies): boolean {
  const { blockId, blockName, disableMentionTracking } = dependencies;
  return Boolean(
    blockId &&
      blockName !== 'channel' &&
      blockName !== 'chat' &&
      !disableMentionTracking
  );
}

/**
 * Insert an agent session chip. It is a reference, not a bot invocation, so
 * it skips the document/user attachment callbacks — but it is tracked like
 * any other entity mention so the session's References panel lists the doc.
 */
async function handleAgentSessionMention(
  session: { id: string; name?: string },
  dependencies: HandlerDependencies
): Promise<void> {
  const { editor, blockId } = dependencies;
  const mentionUuid =
    blockId && tracksMentions(dependencies)
      ? await trackMention(blockId, 'agent_session', session.id)
      : undefined;
  editor.dispatchCommand(INSERT_AGENT_SESSION_MENTION_COMMAND, {
    id: session.id,
    label: session.name,
    ...(mentionUuid ? { mentionUuid } : {}),
  });
}

/**
 * Handle entity mention (documents, channels, emails, etc.).
 */
async function handleEntityMention(
  item: EntityItem,
  dependencies: HandlerDependencies
): Promise<void> {
  const { editor, blockId, onDocumentMention, onEmailMention } = dependencies;

  const entity = item.data;
  if (entity.type === 'agent_session') {
    return await handleAgentSessionMention(entity, dependencies);
  }

  const blockNameForMention = getBlockNameFromEntity(item);
  const itemName = entityDisplayName(item);

  let mentionId: string | undefined;
  if (blockId && tracksMentions(dependencies)) {
    const trackType =
      item.bucket === 'channel' || item.bucket === 'dm'
        ? 'channel'
        : 'document';
    mentionId = await trackMention(blockId, trackType, entity.id);
  }

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
async function handleDateMentionFromOption(
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
async function handleGroupMentionItem(
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
      case 'agentSession':
        return await handleAgentSessionMention(
          { id: item.id, name: item.data.name },
          dependencies
        );
      case 'entity':
        return await handleEntityMention(item, dependencies);
    }
  };
}
