import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ONBOARDING_PRIORITY_TOOLS } from '../core/tools';
import { orderOnboardingTools } from '../primitives/tools';
import { createOnboardingToolCatalog } from './tool-catalog';

const mocks = vi.hoisted(() => ({ catalog: vi.fn(), query: vi.fn() }));
vi.mock('@core/pipedream/catalog', () => ({
  createPipedreamCatalogSearch: mocks.catalog,
}));
vi.mock('@queries/pipedream-connectors', () => ({
  usePipedreamCatalogQuery: mocks.query,
}));

const entry = (slug: string, name = slug) => ({
  app_slug: slug,
  display_name: name,
  icon_url: `https://example.com/${slug}.png`,
});

afterEach(() => vi.clearAllMocks());

describe('onboarding directory adapter', () => {
  it('shows stable featured apps without extra requests and keeps live search and pagination', () => {
    createRoot((dispose) => {
      const [search, setSearch] = createSignal('');
      const [page, setPage] = createSignal([entry('mysql'), entry('stripe')]);
      const fetchNextPage = vi.fn();
      mocks.catalog.mockReturnValue({
        search,
        searchInput: search,
        onSearchInput: setSearch,
        entries: page,
        query: {
          isFetching: false,
          isError: false,
          hasNextPage: true,
          fetchNextPage,
        },
      });
      const catalog = createOnboardingToolCatalog();
      expect(
        orderOnboardingTools(catalog.entries()).map((tool) => tool.slug)
      ).toEqual([...ONBOARDING_PRIORITY_TOOLS.map(([slug]) => slug), 'mysql']);
      expect(
        catalog.entries().find((tool) => tool.slug === 'posthog')?.iconUrl
      ).toBe('https://assets.pipedream.net/s.v0/app_mo7h7A/logo/orig');
      catalog.loadMore();
      expect(fetchNextPage).toHaveBeenCalledOnce();
      expect(catalog.hasMore()).toBe(true);
      setPage([
        ...page(),
        entry('posthog'),
        entry('slack'),
        entry('google_drive'),
        entry('google_sheets'),
      ]);
      expect(
        orderOnboardingTools(catalog.entries()).map((tool) => tool.slug)
      ).toEqual([
        ...ONBOARDING_PRIORITY_TOOLS.map(([slug]) => slug),
        'mysql',
        'google_drive',
        'google_sheets',
      ]);
      catalog.setSearch('obscure');
      setPage([entry('obscure_app')]);
      expect(catalog.entries().map((tool) => tool.slug)).toEqual([
        'obscure_app',
      ]);
      expect(mocks.query).not.toHaveBeenCalled();
      expect(mocks.catalog).toHaveBeenCalledOnce();
      catalog.setSearch('github');
      setPage([entry('github', 'Pipedream GitHub')]);
      expect(catalog.entries()).toEqual([
        { slug: 'github', name: 'GitHub', iconUrl: null },
      ]);
      expect(
        mocks.query.mock.calls.some((call) => call[0]() === 'GitHub')
      ).toBe(false);
      dispose();
    });
  });
});
