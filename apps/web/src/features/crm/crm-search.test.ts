import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCrmCompanyPickerSearch } from './crm-search';

const access = vi.hoisted(() => ({
  state: 'pending' as 'pending' | 'allowed' | 'denied',
}));
const queries = vi.hoisted(() => ({ enabled: [] as boolean[] }));

vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAllowed: () => access.state !== 'denied',
  crmAccessAuthority: { allowed: () => access.state === 'allowed' },
}));
vi.mock('@core/util/debounce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/debounce')>()),
  debouncedDependent: (source: () => string) => source,
}));
vi.mock('@tanstack/solid-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/solid-query')>()),
  useInfiniteQuery: (options: () => { enabled?: boolean }) => {
    queries.enabled.push(options().enabled ?? true);
    // A page from before, still cached whatever access is now.
    return {
      data: [{ id: 'kept', name: 'Kept Co', domains: [], teamId: 'team-1' }],
      isPending: false,
      isLoading: false,
      hasNextPage: false,
      isFetchNextPageError: false,
      isFetchingNextPage: false,
      error: null,
    };
  },
}));

beforeEach(() => {
  queries.enabled = [];
});

it('searches and lists companies only while CRM access is proven', () => {
  for (const [state, proven] of [
    ['pending', false],
    ['allowed', true],
  ] as const) {
    access.state = state;
    queries.enabled = [];
    createRoot((dispose) => {
      const search = useCrmCompanyPickerSearch(() => 'kept');
      expect(queries.enabled, state).toEqual([proven]);
      expect(search.companies().length, state).toBe(proven ? 1 : 0);
      expect(search.isLoading(), state).toBe(!proven);
      dispose();
    });
  }
});
