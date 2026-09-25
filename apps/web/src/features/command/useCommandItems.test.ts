import type {
  QuickAccessItem,
  QuickAccessList,
} from '@core/context/quickAccess/types';
import type { CommandWithInfo } from '@core/hotkey/getCommands';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CategoryFilter } from './types';
import { useCommandItems } from './useCommandItems';

const mocks = vi.hoisted(() => ({
  list: undefined as QuickAccessList | undefined,
  entityMode: (): boolean => false,
  scope: (): CommandWithInfo[] => [],
}));
vi.mock('@app/constants/hotkeys', () => ({
  GO_TO_COMMAND_SCOPE: 'go-to',
  GO_TO_LEADER_KEY: 'g',
}));
vi.mock('@core/context/quickAccess', () => ({
  exclude: () => ['note', 'channel'],
  useQuickAccess: () => ({
    useList: () => {
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
