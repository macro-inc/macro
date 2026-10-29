import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { pipelineTab } from './core/navigation';
import { encodeCrmViewParam } from './queries/saved-view-codec';
import { CompaniesRouteView } from './route-views';

const fixture = vi.hoisted(() => ({
  setTab: vi.fn(),
  search: undefined as unknown as () => string,
}));

vi.mock('@components/app/split-layout/split-router/app-route-shell', () => ({
  withAuth: (component: () => JSX.Element) => component,
  usePageViewTracking: () => {},
  RedirectSplit: () => null,
}));
vi.mock('@components/app/split-layout/view-restoration', () => ({
  useViewRestoration: () => {},
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableCrm: 'crm',
  isFeatureEnabled: () => true,
}));
vi.mock('./route-adapter', () => ({
  createCrmRoute: () => ({ setTab: fixture.setTab }),
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
  fixture.setTab.mockReset();
});

const pipelineId = '01a1212c-74e5-79bd-8767-0d4943d55b15';
const link = (activeTab: string) =>
  `?crmView=${encodeCrmViewParam({ kind: 'crm', activeTab })}`;

it('opens an older shared pipeline link followed while Customers is open', () => {
  const [search, setSearch] = createSignal('?s0.crm.tab=people');
  fixture.search = search;
  render(() => <CompaniesRouteView />);

  setSearch(link(pipelineTab(pipelineId)));
  expect(fixture.setTab).toHaveBeenCalledExactlyOnceWith(
    pipelineTab(pipelineId),
    { replace: true }
  );

  // Moving between Customers tabs keeps the link in the URL.
  setSearch(`${link(pipelineTab(pipelineId))}&s0.crm.tab=people`);
  setSearch(link(pipelineTab(pipelineId)));
  expect(fixture.setTab).toHaveBeenCalledOnce();
});

it('leaves links to other Customers views alone', () => {
  const [search, setSearch] = createSignal('');
  fixture.search = search;
  render(() => <CompaniesRouteView />);

  setSearch(link('people'));
  expect(fixture.setTab).not.toHaveBeenCalled();
});
