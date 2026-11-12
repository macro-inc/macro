import type { ContactDirectoryPage } from '@queries/contacts/directory';
import type { ContactIdFilterSource } from '@queries/contacts/filter-source';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createContactFilterOptions } from './contact-filter-options';

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

it('keeps off-page selections and self without reordering clicked rows or retaining old pages', () => {
  createRoot((dispose) => {
    const me = {
      id: 'macro|viewer@example.com',
      email: 'viewer@example.com',
      name: 'Viewer',
    };
    const first = {
      id: 'macro|first@example.com',
      email: 'first@example.com',
      name: 'First',
    };
    const second = {
      id: 'macro|second@example.com',
      email: 'second@example.com',
      name: 'Second',
    };
    const [selected, setSelected] = createSignal<readonly string[]>([]);
    const [query, setQuery] = createSignal('');
    const [page, setPage] = createSignal<ContactDirectoryPage>({
      users: [first, second],
      query: '',
      source: 'cache',
      sync: 'snapshot',
      offline: false,
      nextCursor: null,
    });
    const input: ContactIdFilterSource = {
      viewer: () => me.id,
      suggestions: {
        inputKey: query,
        windowKey: () => 'window',
        continued: () => false,
        data: page,
        search: query,
        setSearch: setQuery,
        loading: () => false,
        error: () => null,
        next: () => {},
        loadNext: async () => {},
        restart: () => {},
        retry: vi.fn(),
      },
      selection: {
        data: () => ({
          users: [me, second],
          unresolved: [],
          source: 'server',
          offline: false,
        }),
        loading: () => false,
        error: () => null,
        retry: vi.fn(),
      },
    };
    const options = createContactFilterOptions(input, selected);
    expect(options.options().map((option) => option.id)).toEqual([
      me.id,
      first.id,
      second.id,
    ]);
    setSelected([second.id]);
    expect(options.options().map((option) => option.id)).toEqual([
      me.id,
      first.id,
      second.id,
    ]);
    setPage({ ...page(), users: [] });
    expect(options.options().map((option) => option.id)).toEqual([
      second.id,
      me.id,
    ]);
    expect(options.options().some((option) => option.id === first.id)).toBe(
      false
    );
    setSelected([second.id, 'unavailable-person']);
    setQuery('zxq');
    setPage({
      ...page(),
      query: 'zxq',
      users: [
        {
          id: 'macro|match@example.com',
          email: 'match@example.com',
          name: 'Broader match',
        },
      ],
    });
    expect(options.visibleIds()).toEqual(['macro|match@example.com']);
    expect(options.options().map((option) => option.id)).toContain(
      'unavailable-person'
    );
    expect(options.options().map((option) => option.id)).toContain(second.id);
    dispose();
  });
});
