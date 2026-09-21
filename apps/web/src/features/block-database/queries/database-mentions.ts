import {
  type Bucket,
  type QuickAccessItem,
  useQuickAccess,
} from '@core/context/quickAccess';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import type { DatabaseEntityType } from '../core/column-inference';
import type {
  DatabaseMentionCandidate,
  DatabaseMentionSource,
} from '../core/database-mentions';

function mentionBuckets(type?: DatabaseEntityType): readonly Bucket[] {
  return match(type)
    .with('USER', () => ['person'] as const)
    .with('DOCUMENT', () => ['document', 'note'] as const)
    .with('TASK', () => ['task'] as const)
    .with('CHANNEL', () => ['channel', 'dm'] as const)
    .with('PROJECT', () => ['project'] as const)
    .with('CHAT', () => ['chat'] as const)
    .with('THREAD', () => ['email'] as const)
    .with('COMPANY', () => ['crm_company'] as const)
    .with('CALL_RECORD', 'CALENDAR_EVENT', () => [] as const)
    .with(
      undefined,
      () =>
        [
          'person',
          'document',
          'note',
          'task',
          'channel',
          'dm',
          'project',
          'chat',
          'email',
        ] as const
    )
    .exhaustive();
}

export function toDatabaseMention(
  item: QuickAccessItem
): DatabaseMentionCandidate | undefined {
  if (item.kind === 'user') {
    return {
      id: item.data.id,
      entityType: 'USER',
      label: item.data.name || item.data.email,
      description:
        item.data.name && item.data.name !== item.data.email
          ? item.data.email
          : undefined,
    };
  }
  const entity = item.data;
  const entityType = match(entity)
    .with({ type: 'document' }, (document) =>
      document.subType?.type === 'task'
        ? ('TASK' as const)
        : ('DOCUMENT' as const)
    )
    .with({ type: 'channel' }, () => 'CHANNEL' as const)
    .with({ type: 'project' }, () => 'PROJECT' as const)
    .with({ type: 'chat' }, () => 'CHAT' as const)
    .with({ type: 'email' }, () => 'THREAD' as const)
    .with({ type: 'crm_company' }, () => 'COMPANY' as const)
    .otherwise(() => undefined);
  if (!entityType) return;
  return { id: entity.id, entityType, label: entity.name || 'Untitled' };
}

/** Search belongs to this picker and never changes another Quick Access list. */
export function useDatabaseMentions(
  specificEntityType: Accessor<DatabaseEntityType | undefined>,
  search: Accessor<string>
): DatabaseMentionSource {
  const source = useQuickAccess();
  const list = source.useList({
    get buckets() {
      return mentionBuckets(specificEntityType());
    },
    searchTerm: search,
    enabled: () => mentionBuckets(specificEntityType()).length > 0,
  });
  const items = createMemo(() => {
    const type = specificEntityType();
    const seen = new Set<string>();
    return list.items().flatMap((item) => {
      const mention = toDatabaseMention(item);
      if (!mention || (type && mention.entityType !== type)) return [];
      const key = `${mention.entityType}:${mention.id}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [mention];
    });
  });
  return {
    items,
    loading: list.isLoading,
    loadingMore: list.isLoadingMore,
    hasMore: list.hasMore,
    loadMore: list.loadMore,
  };
}
