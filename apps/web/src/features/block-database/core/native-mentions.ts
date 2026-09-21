import type { MentionBucketId } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenuController';
import type { MentionItem } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import type { EntityBucket } from '@core/context/quickAccess';
import type { DatabaseEntityType, DatabaseMention } from './column-inference';

export function databaseMentionFromItem(
  item: MentionItem
): DatabaseMention | undefined {
  if (item.kind === 'user')
    return {
      id: item.data.id,
      entityType: 'USER',
      label: item.data.name || item.data.email,
    };
  if (item.kind !== 'entity') return;
  const type: Partial<Record<EntityBucket, DatabaseEntityType>> = {
    task: 'TASK',
    note: 'DOCUMENT',
    snippet: 'DOCUMENT',
    document: 'DOCUMENT',
    project: 'PROJECT',
    chat: 'CHAT',
    channel: 'CHANNEL',
    dm: 'CHANNEL',
    email: 'THREAD',
    crm_company: 'COMPANY',
  };
  const entityType = type[item.bucket];
  if (entityType)
    return { id: item.data.id, entityType, label: item.data.name || 'Unnamed' };
}

export function databaseMentionScope(type?: DatabaseEntityType): {
  sources: MentionBucketId[];
  documentBuckets?: EntityBucket[];
} {
  if (!type) return { sources: ['users', 'documents', 'channels', 'emails'] };
  if (type === 'USER') return { sources: ['users'] };
  if (type === 'CHANNEL') return { sources: ['channels'] };
  if (type === 'THREAD') return { sources: ['emails'] };
  if (type === 'COMPANY') return { sources: ['companies'] };
  const buckets: Partial<Record<DatabaseEntityType, EntityBucket[]>> = {
    TASK: ['task'],
    DOCUMENT: ['note', 'snippet', 'document'],
    PROJECT: ['project'],
    CHAT: ['chat'],
  };
  return {
    sources: buckets[type] ? ['documents'] : [],
    documentBuckets: buckets[type],
  };
}
