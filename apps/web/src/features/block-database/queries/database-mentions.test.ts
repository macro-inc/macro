import type {
  EntityItem,
  QuickAccessItem,
  UserItem,
} from '@core/context/quickAccess';
import type { QuickAccessListOptions } from '@core/context/quickAccess/types';
import type { EntityData } from '@entity';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseEntityType } from '../core/column-inference';
import { toDatabaseMention, useDatabaseMentions } from './database-mentions';

const useList = vi.hoisted(() => vi.fn());
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({ useList }),
}));

const person: UserItem = {
  kind: 'user',
  bucket: 'person',
  id: 'search-user-index',
  data: { id: 'macro|ada@example.com', name: 'Ada', email: 'ada@example.com' },
  searchText: 'Ada ada@example.com',
  sortTimestamp: 0,
  timestamps: {},
};
function entity(data: EntityData, bucket: EntityItem['bucket']): EntityItem {
  return {
    kind: 'entity',
    id: `index-${data.id}`,
    data,
    bucket,
    searchText: data.name,
    sortTimestamp: 0,
    timestamps: {},
  };
}
const document = entity(
  {
    type: 'document',
    id: 'doc',
    name: 'Plan',
    ownerId: 'owner',
    fileType: 'md',
  },
  'note'
);
const task = entity(
  {
    type: 'document',
    id: 'task',
    name: 'Build it',
    ownerId: 'owner',
    fileType: 'md',
    subType: { type: 'task' },
  },
  'task'
);
const email = entity(
  {
    type: 'email',
    id: 'thread',
    name: 'Welcome',
    ownerId: 'owner',
    isDraft: false,
    isRead: true,
    isImportant: false,
    done: false,
  },
  'email'
);

beforeEach(() => useList.mockReset());

describe('database mention source', () => {
  it('uses canonical entity IDs and maps documents, tasks, and email threads', () => {
    expect(toDatabaseMention(person)).toEqual({
      id: 'macro|ada@example.com',
      entityType: 'USER',
      label: 'Ada',
      description: 'ada@example.com',
    });
    expect(toDatabaseMention(document)).toEqual({
      id: 'doc',
      entityType: 'DOCUMENT',
      label: 'Plan',
    });
    expect(toDatabaseMention(task)).toEqual({
      id: 'task',
      entityType: 'TASK',
      label: 'Build it',
    });
    expect(toDatabaseMention(email)).toEqual({
      id: 'thread',
      entityType: 'THREAD',
      label: 'Welcome',
    });
    expect(
      toDatabaseMention({ ...person, data: { ...person.data, name: '' } })
    ).toMatchObject({ label: 'ada@example.com' });
  });

  it('scopes search to the picker, filters exact entity types, and deduplicates canonical identities', () => {
    createRoot((dispose) => {
      const [type, setType] = createSignal<DatabaseEntityType | undefined>();
      const [search, setSearch] = createSignal('Ada');
      const [items, setItems] = createSignal<QuickAccessItem[]>([
        person,
        { ...person, id: 'other-index' },
        document,
        task,
      ]);
      useList.mockReturnValue({
        items,
        isLoading: () => false,
        isLoadingMore: () => false,
        hasMore: () => false,
        loadMore: vi.fn(),
      });
      const source = useDatabaseMentions(type, search);
      const options = useList.mock.calls[0][0] as QuickAccessListOptions;
      expect(options.searchTerm?.()).toBe('Ada');
      expect(options.buckets).toContain('person');
      expect(source.items().map((item) => item.id)).toEqual([
        'macro|ada@example.com',
        'doc',
        'task',
      ]);
      setType('DOCUMENT');
      expect(options.buckets).toEqual(['document', 'note']);
      expect(source.items().map((item) => item.id)).toEqual(['doc']);
      setType('TASK');
      expect(source.items().map((item) => item.id)).toEqual(['task']);
      setSearch('Build');
      expect(options.searchTerm?.()).toBe('Build');
      setItems([email]);
      expect(source.items()).toEqual([]);
      setType('THREAD');
      expect(source.items()[0].id).toBe('thread');
      dispose();
    });
  });

  it.each(['CALL_RECORD', 'CALENDAR_EVENT'] as const)(
    'disables unsupported %s lists so empty buckets cannot expose all items',
    (type) => {
      createRoot((dispose) => {
        useList.mockReturnValue({
          items: () => [person, document],
          isLoading: () => false,
          isLoadingMore: () => false,
          hasMore: () => false,
          loadMore: vi.fn(),
        });
        const source = useDatabaseMentions(
          () => type,
          () => ''
        );
        const options = useList.mock.calls[0][0] as QuickAccessListOptions;
        expect(options.buckets).toEqual([]);
        expect(options.enabled?.()).toBe(false);
        expect(source.items()).toEqual([]);
        dispose();
      });
    }
  );
});
