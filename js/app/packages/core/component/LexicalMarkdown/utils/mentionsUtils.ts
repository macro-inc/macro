import type { BlockAlias, BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { QuickAccessItem } from '@core/context/quickAccess';
import { trackMention } from '@core/signal/mention';
import type { ChannelWithParticipants, IUser } from '@core/user';
import type { ParsedDate } from '@core/util/dateParser';
import type { DateOption } from '@core/util/dateSearch/useDateSearch';
import type { EmailEntity } from '@entity';
import type { HistoryItem as Item } from '@queries/history/history';
import { waitBulkUploadStatus } from '@service-connection/bulkUpload';
import type { DocumentMentionMetadata } from '@service-notification/client';
import type { UploadSuccess } from '@service-storage/util/upload';
import type { LexicalEditor } from 'lexical';
import { v7 } from 'uuid';
import {
  INSERT_DATE_MENTION_COMMAND,
  INSERT_DOCUMENT_MENTION_COMMAND,
  INSERT_GROUP_MENTION_COMMAND,
  INSERT_USER_MENTION_COMMAND,
} from '../plugins/mentions';

type GroupItem = {
  id: string;
  groupAlias: string;
};

/**
 * Creates a group mention entity from an alias.
 * Use this to define new group aliases (e.g., @here, @team, @online).
 */
function _createGroupAlias(alias: string): Entity<'group'> {
  return {
    kind: 'group',
    id: alias,
    data: {
      id: alias,
      groupAlias: alias,
    },
  };
}

type EntityMap = {
  item: Item;
  user: IUser;
  channel: ChannelWithParticipants;
  date: DateItem;
  email: EmailEntity;
  group: GroupItem;
};

type Entity<T extends keyof EntityMap> = {
  kind: T;
  id: EntityMap[T]['id'];
  data: EntityMap[T];
};

type PickEntity<K extends keyof EntityMap> = {
  [P in K]: Entity<P>;
}[K];

type CombinedEntity<K extends keyof EntityMap = keyof EntityMap> =
  PickEntity<K>;

// mapper fn that converts  entity data to its entity type
type EntityMapper<K extends keyof EntityMap> = (
  data: EntityMap[K]
) => PickEntity<K>;

function entityMapper<K extends keyof EntityMap>(kind: K): EntityMapper<K> {
  return (data: EntityMap[K]) => ({ kind, data, id: data.id });
}

type DateItem = ParsedDate & {
  id: string;
};

export type UserMentionRecord = {
  documentId: string;
  mentions: string[];
  email: string;
  metadata: DocumentMentionMetadata;
};

const getCombinedEntityBlockName = (
  item: CombinedEntity<'item' | 'channel' | 'email'>,
  icon?: boolean
): BlockName | BlockAlias => {
  switch (item.kind) {
    case 'item':
      if (item.data.type === 'document')
        return fileTypeToBlockName(
          (item.data.subType?.type as string | undefined) ?? item.data.fileType,
          icon
        );
      if (item.data.type === 'chat') return 'chat';
      if (item.data.type === 'project') return 'project';
      return 'unknown';
    case 'email':
      return 'email';
    case 'channel':
      return 'channel';
  }
};

const getUserName = (item: IUser): string => {
  const { email, name } = item;
  if (name === email) return email;
  return `${name} | ${email}`;
};

const getItemName = (item: CombinedEntity): string => {
  switch (item.kind) {
    case 'item':
      return item.data.name;
    case 'user':
      return getUserName(item.data);
    case 'channel':
      return item.data.name ?? '';
    case 'email':
      return item.data.name ?? 'No Subject';
    case 'date':
      return item.data.displayFormat;
    case 'group':
      return `@${item.data.groupAlias}`;
  }
};

/**
 * These are the stateful utils needed to handle an item of a given type. I have opted
 * to implement the handlers as smaller helpers rather than 1 giant function. So these
 * dependencies have to be injected via the component.
 */
export type HandlerDependencies = {
  editor: LexicalEditor;
  blockName?: BlockName;
  blockId?: string;
  onUserMention?: (record: UserMentionRecord) => void;
  onDocumentMention?: (item: Item | ChannelWithParticipants) => void;
  disableMentionTracking?: boolean;
  onEmailMention?: (item: EmailEntity) => void;
};

/**
 * Handles user mentions by lexical inserting and potentially up-serting to the notification service.
 * @param user The user to mention.
 * @param dependencies The dependencies required to handle the user mention.
 */
export async function handleUserMention(
  user: IUser,
  dependencies: HandlerDependencies
) {
  const { editor, blockName, blockId, onUserMention, disableMentionTracking } =
    dependencies;
  let mentionId: string | undefined;

  if (blockName !== 'channel') {
    const record: UserMentionRecord = {
      documentId: blockId ?? '',
      mentions: [user.id],
      email: user.email,
      metadata: {
        mention_id: v7(),
      },
    };
    if (onUserMention) {
      onUserMention(record);
    }
    if (blockId && !disableMentionTracking) {
      mentionId = await trackMention(blockId, 'user', user.id);
    }
  }

  editor.dispatchCommand(INSERT_USER_MENTION_COMMAND, {
    userId: user.id,
    email: user.email,
    mentionUuid: mentionId,
  });
}

/**
 * Inserts a date mention.
 * @param date
 * @param dependencies
 */
async function _handleDateMention(
  date: DateItem,
  dependencies: HandlerDependencies
) {
  const { editor } = dependencies;
  editor.dispatchCommand(INSERT_DATE_MENTION_COMMAND, {
    date: date.date.toISOString(),
    displayFormat: date.displayFormat,
  });
}

async function _handleGroupMention(
  group: GroupItem,
  dependencies: HandlerDependencies
) {
  const { editor } = dependencies;
  editor.dispatchCommand(INSERT_GROUP_MENTION_COMMAND, {
    groupAlias: group.groupAlias,
  });
}

async function _handleEmailMention(
  email: EmailEntity,
  dependencies: HandlerDependencies
) {
  const {
    editor,
    blockName: parentBlockName,
    blockId,
    onEmailMention,
    disableMentionTracking,
  } = dependencies;
  let mentionId: string | undefined;
  if (
    blockId &&
    parentBlockName !== 'channel' &&
    parentBlockName !== 'chat' &&
    !disableMentionTracking
  ) {
    mentionId = await trackMention(blockId, 'document', email.id);
  }
  const itemName = email.name ?? 'No Subject';

  onEmailMention?.(email);

  editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
    documentId: email.id,
    documentName: itemName,
    blockName: 'email',
    mentionUuid: mentionId,
  });
}

/**
 * Converts a UploadSuccess to an Item. Folder UploadSuccesses contain a promise for the projectId, so we need to wait for that to resolve.
 */
export async function documentUploadToItem(upload: UploadSuccess) {
  const now = new Date();

  if (upload.type === 'document') {
    return {
      id: upload.documentId,
      name: upload.name,
      type: 'document' as const,
      fileType: upload.fileType,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      documentVersionId: 0,
      ownerId: '',
    };
  }

  const projectId = await waitBulkUploadStatus(upload.requestId);
  if (!projectId) return;

  return {
    id: projectId,
    name: upload.name,
    type: 'project' as const,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ownerId: '',
  };
}

/**
 * Insert a document mentions and track it.
 * @param item
 * @param dependencies
 */
export async function handleBasicMention(
  item: Item,
  dependencies: HandlerDependencies
) {
  const {
    editor,
    blockName: parentBlockName,
    blockId,
    onDocumentMention,
    disableMentionTracking,
  } = dependencies;
  let mentionId: string | undefined;
  if (
    blockId &&
    parentBlockName !== 'channel' &&
    parentBlockName !== 'chat' &&
    !disableMentionTracking
  ) {
    mentionId = await trackMention(blockId, 'document', item.id);
  }
  const itemEntity = entityMapper('item')(item);
  const itemBlock = getCombinedEntityBlockName(itemEntity);
  const itemName = getItemName(itemEntity);
  onDocumentMention?.(item);
  editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
    documentId: item.id,
    documentName: itemName,
    blockName: itemBlock,
    mentionUuid: mentionId,
  });
}

/**
 * Insert a channel mention and track it.
 * @param channel
 * @param dependencies
 */
async function _handleChannelMention(
  channel: ChannelWithParticipants,
  dependencies: HandlerDependencies
) {
  const {
    editor,
    blockName: parentBlockName,
    blockId,
    onDocumentMention,
    disableMentionTracking,
  } = dependencies;
  let mentionId: string | undefined;
  if (
    blockId &&
    parentBlockName !== 'channel' &&
    parentBlockName !== 'chat' &&
    !disableMentionTracking
  ) {
    mentionId = await trackMention(blockId, 'channel', channel.id);
  }
  const channelEntity = entityMapper('channel')(channel);
  const itemBlock = getCombinedEntityBlockName(channelEntity);
  const itemName = getItemName(channelEntity);

  onDocumentMention?.(channel);

  editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
    documentId: channel.id,
    documentName: itemName,
    blockName: itemBlock,
    mentionUuid: mentionId,
    channelType: channel.channel_type,
  });
}

// ============================================================================
// MentionItem Types
// ============================================================================
// These types extend QuickAccessItem to support dates and groups in the
// mentions menu, which aren't part of the standard quick access system.

/**
 * Date mention item using DateOption from useDateSearch.
 */
export type DateMentionItem = {
  kind: 'date';
  id: string;
  data: DateOption;
};

/**
 * Group mention item (e.g., @here).
 */
export type GroupMentionItem = {
  kind: 'group';
  id: string;
  data: {
    id: string;
    groupAlias: string;
  };
};

/**
 * MentionItem = QuickAccessItem + Date + Group.
 * Used in MentionsMenu to unify all mentionable item types.
 */
export type MentionItem = QuickAccessItem | DateMentionItem | GroupMentionItem;

/**
 * Type guard for DateMentionItem.
 */
function _isDateMentionItem(item: MentionItem): item is DateMentionItem {
  return item.kind === 'date';
}

/**
 * Type guard for GroupMentionItem.
 */
function _isGroupMentionItem(item: MentionItem): item is GroupMentionItem {
  return item.kind === 'group';
}
