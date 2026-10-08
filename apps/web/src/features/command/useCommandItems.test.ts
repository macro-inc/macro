import type {
  Bucket,
  QuickAccessItem,
  QuickAccessList,
  QuickAccessListOptions,
} from '@core/context/quickAccess/types';
import type { CommandWithInfo } from '@core/hotkey/getCommands';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CategoryFilter } from './types';
import { useCommandItems } from './useCommandItems';

const mocks = vi.hoisted(() => ({
  list: undefined as QuickAccessList | undefined,
  requestedBuckets: [] as Bucket[],
  entityMode: (): boolean => false,
  scope: (): CommandWithInfo[] => [],
}));
// These tests exercise entity loading independently of Projects and its providers.
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false, loading: false }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'owner',
}));
vi.mock('../projects/project-search', () => ({
  useProjectSearchQuery: () => ({
    rows: () => undefined,
    error: () => undefined,
  }),
}));
vi.mock('@app/constants/hotkeys', () => ({
  GO_TO_COMMAND_SCOPE: 'go-to',
  GO_TO_LEADER_KEY: 'g',
}));
vi.mock('@core/context/quickAccess', () => ({
  exclude: () => ['note', 'channel'],
  useQuickAccess: () => ({
    useList: (options: QuickAccessListOptions) => {
      mocks.requestedBuckets = [...options.buckets];
      if (!mocks.list) throw new Error('Missing test list');
      return mocks.list;
    },
    usesRecordSelection: () => false,
    usesSearchProjection: () => true,
  }),
}));
vi.mock('@core/hotkey/getCommands', () => ({
  getActiveCommandsFromScope: (scope: string) =>
    scope === 'go-to'
      ? []
      : [
          {
            scopeId: 'global',
            description: 'Create',
            runWithInputFocused: true,
            scopeLevel: 0,
            hotkeyIsShadowed: false,
          },
        ],
}));
vi.mock('@core/hotkey/state', () => ({
  activeScope: () => 'global',
  hotkeyScopeTree: new Map(),
}));
vi.mock('./recency', () => ({ getCommandLastUsedAt: () => undefined }));
vi.mock('./state', () => ({
  CommandState: {
    commandScopeCommands: () => mocks.scope(),
    isEntityActionMode: () => mocks.entityMode(),
  },
}));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
});
function setup() {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [items, setItems] = createSignal<QuickAccessItem[]>([]);
    const [loading, setLoading] = createSignal(true);
    const [category, setCategory] = createSignal<CategoryFilter>('all');
    const [entityMode, setEntityMode] = createSignal(false);
    const [scope, setScope] = createSignal<CommandWithInfo[]>([]);
    mocks.entityMode = entityMode;
    mocks.scope = scope;
    mocks.list = {
      items,
      isLoading: loading,
      totalCount: () => items().length,
      hasMore: () => false,
      isLoadingMore: () => false,
      loadMore: async () => {},
    };
    const result = useCommandItems(() => '', category, {
      searchActive: () => true,
    });
    return {
      result,
      setItems,
      setLoading,
      setCategory,
      setEntityMode,
      setScope,
    };
  });
}

const entity: QuickAccessItem = {
  id: 'document',
  kind: 'entity',
  bucket: 'note',
  searchText: 'Document',
  sortTimestamp: 1,
  timestamps: {},
  data: {
    id: 'document',
    type: 'document',
    fileType: 'md',
    name: 'Document',
    ownerId: 'owner',
  },
};

describe('command menu entity loading', () => {
  it('keeps commands available while entities load, then shows arriving results', () => {
    const { result, setItems, setLoading } = setup();
    expect(result.items().map((item) => item.kind)).toEqual(['command']);
    expect(result.isLoadingEntities()).toBe(true);
    setItems([entity]);
    expect(result.items().map((item) => item.kind)).toEqual([
      'command',
      'entity',
    ]);
    // A dirty follow-up may still be fetching; available entities remove the notice.
    expect(result.isLoadingEntities()).toBe(false);
    setLoading(false);
    expect(result.isLoadingEntities()).toBe(false);
  });

  it('distinguishes loading from a settled empty entity category', () => {
    const { result, setCategory, setLoading } = setup();
    setCategory('documents');
    expect(result.items()).toEqual([]);
    expect(result.isLoadingEntities()).toBe(true);
    setLoading(false);
    expect(result.items()).toEqual([]);
    expect(result.isLoadingEntities()).toBe(false);
  });

  it('does not report entity loading in commands, entity actions, or nested command scopes', () => {
    const { result, setCategory, setEntityMode, setScope } = setup();
    setCategory('commands');
    expect(result.isLoadingEntities()).toBe(false);
    setCategory('all');
    setEntityMode(true);
    expect(result.isLoadingEntities()).toBe(false);
    setEntityMode(false);
    setScope([
      {
        scopeId: 'nested',
        description: 'Nested',
        runWithInputFocused: true,
        scopeLevel: 0,
        hotkeyIsShadowed: false,
      },
    ]);
    expect(result.isLoadingEntities()).toBe(false);
  });
});

describe('command menu database categories', () => {
  it('keeps databases discoverable in All and Documents without view history', () => {
    const { result, setItems, setLoading, setCategory } = setup();
    const database: QuickAccessItem = {
      id: 'book-organizer',
      kind: 'entity',
      bucket: 'database',
      searchText: 'Book Organizer',
      sortTimestamp: 1,
      timestamps: { createdAt: '2026-09-01T00:00:00Z' },
      data: {
        type: 'database',
        id: 'book-organizer',
        name: 'Book Organizer',
        ownerId: 'owner',
        grant: 'owner',
        createdAt: '2026-09-01T00:00:00Z',
      },
    };
    setItems([database]);
    setLoading(false);
    for (const category of ['all', 'documents'] as const) {
      setCategory(category);
      expect(result.items()).toContain(database);
      expect(mocks.requestedBuckets).toContain('database');
    }
  });
});
