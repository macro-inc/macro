/** @vitest-environment jsdom */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiscoverView } from './DiscoverView';
import { ConnectionsViewProvider } from './view-state';

const sheets = {
  app_slug: 'Sheets',
  display_name: 'Sheets',
  description: 'Read spreadsheets',
  categories: ['Productivity'],
};
const airtable = {
  app_slug: 'Airtable',
  display_name: 'Airtable',
  description: 'Read databases',
  categories: ['Databases'],
};
const calendar = {
  app_slug: 'Calendar',
  display_name: 'Calendar',
  description: 'Read events',
  categories: ['Productivity'],
};
const [state, setState] = createStore({
  entries: [sheets, airtable],
  isFetching: false,
  hasNextPage: true,
  isError: false,
  isFetchNextPageError: false,
});
const fetchNextPage = vi.fn();
const observations: Array<{ intersect: () => void; node: Element }> = [];

vi.mock('@core/pipedream/catalog', () => ({
  createPipedreamCatalogSearch: () => {
    const [search, setSearch] = createSignal('');
    return {
      search,
      searchInput: search,
      onSearchInput: setSearch,
      entries: () => state.entries,
      query: {
        get isFetching() {
          return state.isFetching;
        },
        get hasNextPage() {
          return state.hasNextPage;
        },
        get isError() {
          return state.isError;
        },
        get isFetchNextPageError() {
          return state.isFetchNextPageError;
        },
        fetchNextPage,
        refetch: vi.fn(),
      },
    };
  },
  createPipedreamCatalogConnect: () => ({
    connect: vi.fn(),
    busy: () => false,
  }),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { success: vi.fn() } }));
vi.mock('@core/pipedream/ConnectorIcon', () => ({
  PipedreamConnectorIcon: () => null,
}));
vi.mock('./add-custom-mcp-dialog', () => ({ AddCustomMcpDialog: () => null }));

beforeEach(() => {
  observations.length = 0;
  fetchNextPage.mockReset();
  setState({
    entries: [sheets, airtable],
    isFetching: false,
    hasNextPage: true,
    isError: false,
    isFetchNextPageError: false,
  });
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(
        private callback: (entries: { isIntersecting: boolean }[]) => void
      ) {}
      observe(node: Element) {
        observations.push({
          node,
          intersect: () => this.callback([{ isIntersecting: true }]),
        });
      }
      disconnect() {}
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

function showCatalog() {
  return render(() => (
    <ConnectionsViewProvider>
      <DiscoverView
        model={{ capabilities: [], leftovers: [], providers: [] }}
      />
    </ConnectionsViewProvider>
  ));
}

it('loads successive pages on intersection and pauses while fetching or exhausted', async () => {
  showCatalog();
  await waitFor(() => expect(observations.length).toBeGreaterThan(0));
  observations.at(-1)?.intersect();
  expect(fetchNextPage).toHaveBeenCalledTimes(1);
  setState('isFetching', true);
  observations.at(-1)?.intersect();
  expect(fetchNextPage).toHaveBeenCalledTimes(1);
  setState('entries', [...state.entries, calendar]);
  setState('isFetching', false);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Connect Calendar' })
    ).toBeTruthy()
  );
  observations.at(-1)?.intersect();
  expect(fetchNextPage).toHaveBeenCalledTimes(2);
  expect(
    within(screen.getByRole('region', { name: 'Productivity' })).getAllByRole(
      'button'
    )
  ).toHaveLength(2);
  setState('hasNextPage', false);
  observations.at(-1)?.intersect();
  expect(fetchNextPage).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});

it('keeps loaded apps on a page failure and retries only on request', async () => {
  showCatalog();
  setState({ isError: true, isFetchNextPageError: true });
  expect(screen.getByRole('button', { name: 'Connect Sheets' })).toBeTruthy();
  observations.at(-1)?.intersect();
  expect(fetchNextPage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(fetchNextPage).toHaveBeenCalledTimes(1);
});

it('searches only the apps catalog and keeps featured integrations visible', () => {
  showCatalog();
  fireEvent.input(screen.getByRole('searchbox', { name: 'Search apps' }), {
    target: { value: 'Airtable' },
  });
  expect(screen.queryByRole('button', { name: 'Connect Sheets' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Connect Airtable' })).toBeTruthy();
  expect(
    within(
      screen.getByRole('region', { name: 'Featured integrations' })
    ).getByText('GitHub')
  ).toBeTruthy();
});
