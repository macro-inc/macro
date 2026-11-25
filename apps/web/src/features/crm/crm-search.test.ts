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
    return {
      data: undefined,
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

it('searches companies only once CRM access is proven, not while it is pending', () => {
  for (const [state, enabled] of [
    ['pending', false],
    ['allowed', true],
  ] as const) {
    access.state = state;
    queries.enabled = [];
    createRoot((dispose) => {
      useCrmCompanyPickerSearch(() => 'kept');
      dispose();
    });
    expect(queries.enabled, state).toEqual([enabled]);
  }
});
