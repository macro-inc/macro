import type { SoupState } from '@app/features/next-soup/create-soup-state';
import type { CrmContactEntity } from '@entity';
import { type Accessor, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  contactSearch: undefined as (() => string) | undefined,
  contactActive: undefined as (() => boolean) | undefined,
  contacts: (() => []) as () => CrmContactEntity[],
  contactsLoading: (() => false) as () => boolean,
  contactRefresh: vi.fn(async () => {}),
  serviceRefresh: vi.fn(async () => {}),
}));

vi.mock('@app/features/crm/record-adapter', () => ({
  useCrmContactDiscovery: (search: () => string, active: () => boolean) => {
    fakes.contactSearch = search;
    fakes.contactActive = active;
    return {
      contacts: () => fakes.contacts(),
      isLoading: () => fakes.contactsLoading(),
      refresh: fakes.contactRefresh,
    };
  },
}));
vi.mock('@app/features/soup/search', async () => {
  const utils = await vi.importActual<
    typeof import('@app/features/soup/search/utils')
  >('@app/features/soup/search/utils');
  const shared = await vi.importActual<
    typeof import('@app/features/soup/search/create-search-state')
  >('@app/features/soup/search/create-search-state');
  return {
    ...utils,
    soupSearchMatchType: shared.soupSearchMatchType,
    useSearchContext: () => ({ entityPool: () => [] }),
    createSearchState: () => ({
      refresh: fakes.serviceRefresh,
      isSearchServiceLoading: () => false,
    }),
  };
});
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => undefined,
  validateSearchServiceText: () => true,
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@service-storage/websocket', () => ({ storageWS: {} }));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({}),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));

import { createSearchState } from './create-search-state';

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
});

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

function setup() {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [text, setText] = createSignal('');
    const [scope, setScope] = createSignal(true);
    const [paused, setPaused] = createSignal(false);
    const state = createSearchState({
      soup: {
        predicates: { activeIds: () => [], available: [] },
      } as unknown as SoupState,
      filters: () => ({ include: {}, exclude: {} }),
      assignees: () => [],
      searchPaused: paused,
      contactSearchScope: scope,
      searchText: text,
      setSearchText: setText,
    });
    return { state, setText, setScope, setPaused };
  });
}

const ids = (contacts: Accessor<{ id: string }[]>) =>
  contacts().map(({ id }) => id);

describe('global Search contact source', () => {
  it('searches the unquoted text of an exact query', () => {
    const t = setup();
    t.setText('  "asher hacker"  ');
    expect(fakes.contactSearch?.()).toBe('asher hacker');
    t.setText('asher');
    expect(fakes.contactSearch?.()).toBe('asher');
  });

  it('runs only in a contact scope and while search is not paused', () => {
    const t = setup();
    expect(fakes.contactActive?.()).toBe(true);
    t.setPaused(true);
    expect(fakes.contactActive?.()).toBe(false);
    t.setPaused(false);
    t.setScope(false);
    expect(fakes.contactActive?.()).toBe(false);
  });

  it('leads with name matches and places email-only matches after service results', () => {
    const t = setup();
    fakes.contacts = () => [
      contact('asher', 'Asher at HackerNoon', 'asher@hackernoon.com'),
      contact('unnamed', 'ops@hackernoon.com', 'ops@hackernoon.com'),
      contact('bob', 'Bob Smith', 'bob@hackernoon.com'),
    ];
    t.setText('hackernoon');
    const results = t.state.contactResults();
    expect(ids(() => results.byName)).toEqual(['asher']);
    expect(ids(() => results.byEmailOnly)).toEqual(['unnamed', 'bob']);
  });

  it('refreshes contacts with the search service and reports their loading', async () => {
    const t = setup();
    t.setText('asher');
    await t.state.refresh();
    expect(fakes.serviceRefresh).toHaveBeenCalledOnce();
    expect(fakes.contactRefresh).toHaveBeenCalledOnce();
    fakes.contactsLoading = () => true;
    expect(t.state.isSearchServiceLoading()).toBe(true);
  });
});
