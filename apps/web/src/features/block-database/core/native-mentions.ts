import type { MentionBucketId } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenuController';
import type { MentionItem } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import type { EntityBucket } from '@core/context/quickAccess';
import { match } from 'ts-pattern';
import type { DatabaseEntityType, DatabaseMention } from './column-inference';

const ENTITY_TYPE_OF_BUCKET: Partial<Record<EntityBucket, DatabaseEntityType>> =
  {
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
    crm_contact: 'CONTACT',
  };

export function databaseMentionFromItem(
  item: MentionItem
): DatabaseMention | undefined {
  return match(item)
    .returnType<DatabaseMention | undefined>()
    .with({ kind: 'user' }, ({ data }) => ({
      id: data.id,
      entityType: 'USER',
      label: data.name || data.email,
    }))
    .with({ kind: 'entity' }, ({ bucket, data }) => {
      const entityType = ENTITY_TYPE_OF_BUCKET[bucket];
      return entityType
        ? { id: data.id, entityType, label: data.name || 'Unnamed' }
        : undefined;
    })
    .otherwise(() => undefined);
}

type DatabaseMentionScope = {
  sources: MentionBucketId[];
  documentBuckets?: EntityBucket[];
};

function documentScope(documentBuckets: EntityBucket[]): DatabaseMentionScope {
  return { sources: ['documents'], documentBuckets };
}

export function databaseMentionScope(
  type?: DatabaseEntityType
): DatabaseMentionScope {
  return match(type)
    .returnType<DatabaseMentionScope>()
    .with(undefined, () => ({
      sources: ['users', 'documents', 'channels', 'emails'],
    }))
    .with('USER', () => ({ sources: ['users'] }))
    .with('CHANNEL', () => ({ sources: ['channels'] }))
    .with('THREAD', () => ({ sources: ['emails'] }))
    .with('COMPANY', () => ({ sources: ['companies'] }))
    .with('CONTACT', () => documentScope(['crm_contact']))
    .with('TASK', () => documentScope(['task']))
    .with('DOCUMENT', () => documentScope(['note', 'snippet', 'document']))
    .with('PROJECT', () => documentScope(['project']))
    .with('CHAT', () => documentScope(['chat']))
    .with(
      'CALENDAR_EVENT',
      'CALL_RECORD',
      'DATABASE_ROW',
      'INITIATIVE',
      () => ({ sources: [], documentBuckets: undefined })
    )
    .exhaustive();
}
