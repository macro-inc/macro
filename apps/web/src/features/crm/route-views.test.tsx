import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { pipelineTab } from './core/navigation';
import { encodeCrmViewParam } from './queries/saved-view-codec';
import { CompaniesRouteView } from './route-views';

const fixture = vi.hoisted(() => ({
  setSearch: vi.fn(),
  search: undefined as unknown as () => string,
}));

vi.mock('@components/app/split-layout/split-router/app-route-shell', () => ({
  withAuth: (component: () => JSX.Element) => component,
  usePageViewTracking: () => {},
  RedirectSplit: () => null,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableCrm: 'crm',
  isFeatureEnabled: () => true,
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createSearchParams: () => [
    { tab: 'active', pipeline: '', seek: '' },
    fixture.setSearch,
  ],
}));
vi.mock('@solidjs/router', () => ({
  useLocation: () => ({
    get search() {
      return fixture.search();
    },
  }),
}));
vi.mock('./crm', () => ({ Crm: () => null }));

afterEach(() => {
  cleanup();
  fixture.setSearch.mockReset();
});

const pipelineId = '01a1212c-74e5-79bd-8767-0d4943d55b15';
const link = (activeTab: string) =>
  `?crmView=${encodeCrmViewParam({ kind: 'crm', activeTab })}`;

it('opens a shared pipeline link followed while Customers is open', () => {
  const [search, setSearch] = createSignal('?s0.crm.tab=people');
  fixture.search = search;
  render(() => <CompaniesRouteView />);

  setSearch(link(pipelineTab(pipelineId)));
  expect(fixture.setSearch).toHaveBeenCalledExactlyOnceWith(
    {
      tab: pipelineTab(pipelineId),
      pipeline: pipelineId,
      seek: expect.any(String),
    },
    { mode: 'merge', history: 'replace' }
  );

  // Moving between Customers tabs keeps the link in the URL.
  setSearch(`${link(pipelineTab(pipelineId))}&s0.crm.tab=people`);
  setSearch(link(pipelineTab(pipelineId)));
  expect(fixture.setSearch).toHaveBeenCalledOnce();
});

it('leaves links to other Customers views alone', () => {
  const [search, setSearch] = createSignal('');
  fixture.search = search;
  render(() => <CompaniesRouteView />);

  setSearch(link('people'));
  expect(fixture.setSearch).not.toHaveBeenCalled();
});
