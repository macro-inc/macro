import type {
  Bucket,
  EntityItem,
  QuickAccessItem,
  QuickAccessList,
  UserItem,
} from '@core/context/quickAccess/types';
import type { CrmContactEntity } from '@entity';
import { type Accessor, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CategoryFilter } from './types';
import { type CommandContactSource, useCommandItems } from './useCommandItems';

const VIEWER = 'macro|viewer@macro.com';

const mocks = vi.hoisted(() => ({
  lists: {} as Record<string, () => QuickAccessItem[]>,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false, loading: false }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|viewer@macro.com',
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
  useQuickAccess: () => ({
    useList: (first: Bucket | { buckets: readonly Bucket[] }) => {
      const key = typeof first === 'string' ? first : 'category';
      const items = () => mocks.lists[key]?.() ?? [];
      return {
        items,
        totalCount: () => items().length,
        hasMore: () => false,
        isLoading: () => false,
        isLoadingMore: () => false,
        loadMore: async () => {},
      } satisfies QuickAccessList;
    },
    usesRecordSelection: () => false,
    usesSearchProjection: () => false,
  }),
}));
vi.mock('@core/context/quickAccess/types', () => ({
  exclude: () => ['dm', 'note'],
}));
vi.mock('@core/hotkey/getCommands', () => ({
  getActiveCommandsFromScope: () => [],
}));
vi.mock('@core/hotkey/state', () => ({
  activeScope: () => 'global',
  hotkeyScopeTree: new Map(),
}));
vi.mock('./recency', () => ({ getCommandLastUsedAt: () => undefined }));
vi.mock('./state', () => ({
  CommandState: {
    commandScopeCommands: () => [],
    isEntityActionMode: () => false,
  },
}));

const contact = (
  id: string,
  name: string,
  email: string
): CrmContactEntity => ({
  type: 'crm_contact',
  id,
  ownerId: 'team',
  companyId: 'company',
  name,
  email,
  hidden: false,
  lastInteraction: '2026-09-01T00:00:00Z',
});

const user = (email: string, name: string): UserItem => ({
  kind: 'user',
  bucket: 'person',
  id: `macro|${email}`,
  searchText: `${name} | ${email}`,
  sortTimestamp: 0,
  timestamps: {},
  data: { id: `macro|${email}`, email, name },
});

const directMessage = (
  id: string,
  name: string,
  other: string
): EntityItem => ({
  kind: 'entity',
  bucket: 'dm',
  id,
  searchText: name,
  sortTimestamp: 1,
  timestamps: {},
  data: {
    type: 'channel',
    id,
    name,
    ownerId: VIEWER,
    channelType: 'direct_message',
    participantIds: [VIEWER, other],
  },
});

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  mocks.lists = {};
});

function setup(initialCategory: CategoryFilter = 'dms') {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [query, setQuery] = createSignal('');
    const [category, setCategory] = createSignal(initialCategory);
    const [contacts, setContacts] = createSignal<CrmContactEntity[]>([]);
    const [users, setUsers] = createSignal<UserItem[]>([]);
    const [dms, setDms] = createSignal<EntityItem[]>([]);
    const [hasMore, setHasMore] = createSignal(false);
    const [loading, setLoading] = createSignal(false);
    mocks.lists = { person: users, dm: dms };
    const discovery = {
      search: undefined as Accessor<string> | undefined,
      active: undefined as Accessor<boolean> | undefined,
      loadMore: vi.fn(async () => {}),
    };
    const result = useCommandItems(query, category, {
      searchActive: () => true,
      contactDiscovery: (search, active): CommandContactSource => {
        discovery.search = search;
        discovery.active = active;
        return {
          contacts: () => (active() ? contacts() : []),
          isLoading: loading,
          hasMore,
          isLoadingMore: () => false,
          loadMore: discovery.loadMore,
        };
      },
    });
    return {
      result,
      discovery,
      ids: () => result.items().map((item) => item.id),
      setQuery,
      setCategory,
      setContacts,
      setUsers,
      setDms,
      setHasMore,
      setLoading,
    };
  });
}

describe('command menu contact discovery', () => {
  it('lists contacts beyond the cached seed under People for a typed query', () => {
    const t = setup('dms');
    t.setContacts([
      contact('crm-asher', 'Asher at HackerNoon', 'asher@hackernoon.com'),
    ]);
    expect(t.discovery.active?.()).toBe(false);
    expect(t.ids()).toEqual([]);

    t.setQuery('asher');
    expect(t.discovery.active?.()).toBe(true);
    expect(t.discovery.search?.()).toBe('asher');
    expect(t.ids()).toEqual(['search:dms:asher', 'crm-asher']);
  });

  it('adds contacts to a typed All search but keeps blank All on recency', () => {
    const t = setup('all');
    t.setContacts([contact('crm-pat', 'Pat Doe', 'pat@acme.com')]);
    expect(t.discovery.active?.()).toBe(false);
    expect(t.ids()).not.toContain('crm-pat');
    t.setQuery('pat doe');
    expect(t.ids()).toContain('crm-pat');
  });

  it('keeps contacts out of unrelated categories', () => {
    const t = setup('documents');
    t.setQuery('asher');
    t.setContacts([contact('crm-asher', 'Asher', 'asher@x.com')]);
    expect(t.discovery.active?.()).toBe(false);
    expect(t.ids()).not.toContain('crm-asher');
    t.setCategory('people');
    expect(t.discovery.active?.()).toBe(true);
  });

  it('prefers the Macro user sharing the email even when only the CRM name matched', () => {
    const t = setup('dms');
    const asher = user('asher@macro.com', 'Asher Smith');
    t.setUsers([asher]);
    t.setContacts([
      contact('crm-asher', 'Asher at HackerNoon', ' Asher@Macro.com'),
      contact('crm-plus', 'Asher Press', 'asher+press@macro.com'),
    ]);
    t.setQuery('hackernoon');
    const items = t.result.items();
    // The plus alias is a different address, so it stays a contact.
    expect(items.map((item) => item.id)).toEqual([
      'search:dms:hackernoon',
      asher.id,
      'crm-plus',
    ]);
    expect(items[1].kind).toBe('user');
    expect(items.some((item) => item.id === 'crm-asher')).toBe(false);
  });

  it("opens the person's existing conversation instead of a second row", () => {
    const t = setup('dms');
    const asher = user('asher@macro.com', 'Asher Smith');
    const dm = directMessage('dm-asher', 'Asher Smith', asher.id);
    // People already lists the conversation; only the CRM name matches.
    mocks.lists.category = () => [dm];
    t.setUsers([asher]);
    t.setDms([dm]);
    t.setContacts([
      contact('crm-asher', 'Asher at HackerNoon', asher.data.email),
    ]);
    t.setQuery('hackernoon');
    expect(t.ids()).toEqual(['search:dms:hackernoon', 'dm-asher']);

    t.setQuery('asher');
    expect(t.ids().filter((id) => id === 'dm-asher')).toHaveLength(1);
  });

  it('pages contacts with the rest of the menu and reports their loading', async () => {
    const t = setup('dms');
    t.setQuery('pat');
    expect(t.result.pagination.hasMore()).toBe(false);
    t.setHasMore(true);
    expect(t.result.pagination.hasMore()).toBe(true);
    await t.result.pagination.loadMore();
    expect(t.discovery.loadMore).toHaveBeenCalledOnce();
    t.setLoading(true);
    expect(t.result.isLoadingEntities()).toBe(true);
  });
});
