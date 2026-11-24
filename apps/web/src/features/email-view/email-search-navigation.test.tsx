import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { For, type JSX, type ParentProps } from 'solid-js';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { EmailHeader } from './components/EmailHeader';
import { EmailNavigation } from './components/EmailSidebar';
import { EmailMobileLayout } from './email-view';
import {
  type EmailViewContext,
  EmailViewProvider,
  useEmailView,
} from './email-view-context';
import { createEmailSearchSuggestions } from './search/create-email-search-suggestions';
import { EmailMobileTabs } from './views/mobile/email-tabs';

const mocks = vi.hoisted(() => ({ touch: false }));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true, loading: false }),
}));
vi.mock('@app/components/list', () => ({
  createListController: () => ({}),
  listOwnedSlotName: (name: string) => name,
}));
vi.mock('@app/components/view-shell', () => {
  const Pass = (props: ParentProps) => <>{props.children}</>;
  return {
    useViewControlHotkeys: () => {},
    useViewTabHotkeys: () => {},
    ViewBreadcrumbs: {},
    ViewSwitchTrigger: Pass,
    ViewSidebar: {
      Section: Pass,
      SectionHeader: Pass,
      Nav: Pass,
      Icon: () => null,
      Toggle: () => null,
      Item: (
        props: ParentProps<{
          active?: boolean;
          onClick?: (event: MouseEvent) => void;
        }>
      ) => (
        <button
          type="button"
          aria-current={props.active ? 'page' : undefined}
          onClick={(event) => props.onClick?.(event)}
        >
          {props.children}
        </button>
      ),
    },
  };
});
vi.mock('@app/components/view-shell/ListHeader', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@app/components/view-shell/ListHeader')
  >()),
  ListHeader: (props: ParentProps<{ title: JSX.Element }>) => (
    <header>
      {props.title}
      {props.children}
    </header>
  ),
}));
vi.mock('@app/components/view-shell/ViewCreateButton', () => ({
  ViewCreateButton: () => null,
}));
vi.mock('@app/components/view-shell/SidebarCreateButton', () => ({
  SidebarCreateButton: () => null,
}));
vi.mock('@app/features/routine-suggestions/routine-suggestions', () => ({
  SidebarRoutineSuggestions: () => null,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: () => {} }),
}));
vi.mock('@core/signal/create-label-collapse', () => ({
  createLabelCollapse: () => () => false,
}));
vi.mock('./compose-email', () => ({ composeEmail: () => {} }));
vi.mock('./components/EmailControls', () => ({ EmailControls: () => null }));
vi.mock('./components/EmailInboxSelector', () => ({
  EmailInboxList: () => null,
}));
vi.mock('./views/email-saved-views', () => ({
  EmailSavedViewActions: () => null,
  EmailSavedViewMenu: () => null,
  EmailSavedViewsSection: () => null,
  EmailSaveViewButton: () => null,
  useEmailSavedViewTitle: () => () => undefined,
}));
vi.mock('./components/EmailFilterDrawer', () => ({
  EmailFilterDrawer: () => null,
}));
vi.mock('./components/EmailList', () => ({ EmailList: () => null }));
vi.mock('./components/EmailReader', () => ({
  EmailReader: () => null,
  EmailReaderEmpty: () => null,
}));
vi.mock('@app/features/tours/ViewTour', () => ({ ViewTour: () => null }));
vi.mock('@app/features/saved-views/queries/saved-views', () => ({
  useSavedView: () => ({}),
  useSavedViews: () => ({}),
}));
vi.mock('@app/features/saved-views/views/saved-view-draft-host', () => ({
  SavedViewDraftHost: () => null,
}));
vi.mock('@app/observability/flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/observability/flow')>()),
  TraceFlow: (props: ParentProps) => <>{props.children}</>,
}));
vi.mock('@components/app/split-panel', () => ({ SplitPanel: {} }));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: ParentProps) => <>{props.children}</>,
  })
);
vi.mock('@entity', () => ({
  ListEntityMetadataQueryProvider: (props: ParentProps) => (
    <>{props.children}</>
  ),
}));
vi.mock('@components/app/mobile/PillTabs', () => ({
  PillButton: (props: ParentProps<{ onClick?: () => void }>) => (
    <button
      type="button"
      aria-label="Search email"
      onClick={() => props.onClick?.()}
    />
  ),
  PillTabs: (props: {
    items: { value: string; label: string }[];
    value?: string;
    onChange: (value: string) => void;
    trailing?: JSX.Element;
  }) => (
    <div role="tablist">
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            role="tab"
            aria-selected={item.value === props.value}
            onClick={() => props.onChange(item.value)}
          >
            {item.label}
          </button>
        )}
      </For>
      <div data-testid="pill-strip-title">{props.trailing}</div>
    </div>
  ),
}));
vi.mock('@components/app/mobile-header/mobile-header', () => ({
  MobileHeader: {
    Island: (props: ParentProps) => <>{props.children}</>,
  },
}));
vi.mock('@app/features/soup', async () => ({
  ...(await import('../soup/filters/facets/selection')),
  ...(await import('../soup/filters/facets/tag-facet')),
}));
vi.mock('@app/features/soup/collection/list-navigation-source', () => ({
  registerListNavigationSource: () => {},
}));
vi.mock('@app/lib/persistence', () => ({
  makePersistedState: <T,>(store: T) => store,
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  useNavigate: () => async () => {},
  useRouteParams: () => ({}),
  useMatches: () => () => [],
  createSearchParams: () => [{ tab: 'important' }],
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({}),
}));
vi.mock('@notifications/mark-row-seen', () => ({
  markRowNotificationsSeenOnOpen: vi.fn(),
}));
vi.mock('@components/app/createPreviewSelectionGuard', () => ({
  createPreviewSelectionGuard: () =>
    Object.assign(() => true, { canSelect: () => true }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
  useSplitPanelOrThrow: () => ({
    handle: { id: 'mail-panel' },
    splitHotkeyScope: 'mail-panel',
    isPanelActive: () => true,
  }),
  withSplitPanelOwner: (_slot: string, create: () => unknown) => create(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@property/tags/tag-sets-context', () => ({
  useTagSets: () => () => [],
  useTagSetsReady: () => () => true,
}));
vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({ isSuccess: false, data: { links: [] } }),
}));
vi.mock('./persistence', () => ({ createEmailViewPersistence: () => ({}) }));
vi.mock('./queries/use-email-query', () => ({
  useEmailDataSource: () => ({ items: () => [] }),
}));
vi.mock('./queries/use-email-search-values', () => ({
  useEmailSearchValues: () => ({ people: () => [], labels: () => [] }),
}));
vi.mock('./email-route', () => ({
  emailTabSearch: { namespace: 'mail' },
  emailDetailSearch: { namespace: 'email-detail' },
  emailTabSearchCodec: { serialize: (value: unknown) => value },
}));

// jsdom has no ResizeObserver; the phone layout measures its header with one.
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  mocks.touch = false;
});

/** Queries that keep a search of the Inbox or one of its views open. */
const INBOX_SEARCHES = [
  { search: 'in:inbox invoice', title: 'Inbox' },
  { search: 'in:focus invoice', title: 'Focus' },
  { search: 'in:signal invoice', title: 'Signal' },
  { search: 'in:noise invoice', title: 'Noise' },
];

const UNFINISHED_SEARCHES = ['in:', 'in:f', 'in:focus '];

function mount(content: () => JSX.Element) {
  let view!: EmailViewContext;
  function Contents() {
    view = useEmailView();
    return <>{content()}</>;
  }
  render(() => (
    <EmailViewProvider initialState={{}}>
      <Contents />
    </EmailViewProvider>
  ));
  return view;
}

const searchField = () => screen.queryByRole<HTMLInputElement>('searchbox');
const press = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));
const openSearch = () => press('Search email');
const type = (search: string) => {
  if (!searchField()) openSearch();
  searchField()!.focus();
  fireEvent.input(searchField()!, { target: { value: search } });
};
const selectedTab = () =>
  screen
    .getAllByRole<HTMLInputElement>('radio')
    .find((tab) => tab.checked)
    ?.closest('label, div')?.textContent;
const inboxTabs = () =>
  screen.queryByRole('radiogroup', { name: 'Inbox view' });
const headerTitle = () =>
  within(screen.getByRole('banner')).getByRole('heading').textContent;
const selectedFolders = () =>
  screen
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-current') === 'page')
    .map((button) => button.textContent);

/** The header with its wide field, which lists recent searches. */
function WideSearchHeader() {
  const { state, setState } = useEmailView();
  const suggestions = createEmailSearchSuggestions({
    userId: () => 'user',
    search: () => state.search,
    setSearch: (search) => setState('search', search),
    scopeAvailable: () => true,
  });
  return <EmailHeader tabOnly searchSuggestions={suggestions} />;
}

describe('desktop header and sidebar', () => {
  const desktop = (wide = true) =>
    mount(() => (
      <>
        {wide ? <WideSearchHeader /> : <EmailHeader tabOnly />}
        <EmailNavigation />
      </>
    ));

  describe.each([
    { field: 'wide', wide: true },
    { field: 'compact', wide: false },
  ])('the $field search field', ({ wide }) => {
    const openEmptyFromNoise = () => {
      desktop(wide);
      fireEvent.click(screen.getByRole('radio', { name: 'Noise' }));
      openSearch();
    };

    it('hides the Inbox tabs as it opens, and names the view still on screen', () => {
      openEmptyFromNoise();
      expect(searchField()?.value).toBe('');
      expect(inboxTabs()).toBeNull();
      expect(headerTitle()).toBe('Noise');
      expect(selectedFolders()).toEqual(['Inbox']);

      type('invoice');
      expect(headerTitle()).toBe('Search');
      type('');
      expect(inboxTabs()).toBeNull();
      expect(headerTitle()).toBe('Noise');
    });

    it.each([
      { how: 'its X', close: () => press('Close search') },
      {
        how: 'Escape',
        close: () => fireEvent.keyDown(searchField()!, { key: 'Escape' }),
      },
    ])(
      'brings the tabs back on the earlier tab once $how closes it',
      ({ close }) => {
        openEmptyFromNoise();
        close();
        expect(searchField()).toBeNull();
        expect(selectedTab()).toBe('Noise');
        expect(headerTitle()).toBe('Inbox');

        openSearch();
        type('invoice');
        press('Close search');
        expect(searchField()).toBeNull();
        expect(selectedTab()).toBe('Noise');
      }
    );

    it('closes for a view picked before a word is typed', () => {
      openEmptyFromNoise();
      press('Sent');
      expect(searchField()).toBeNull();
      expect(headerTitle()).toBe('Sent');

      openSearch();
      press('Inbox');
      expect(searchField()).toBeNull();
      expect(inboxTabs()).not.toBeNull();
    });
  });

  it.each(INBOX_SEARCHES)(
    'shows no Inbox tabs and the view’s name for $search',
    ({ search, title }) => {
      desktop();
      expect(inboxTabs()).not.toBeNull();

      type(search);
      expect(inboxTabs()).toBeNull();
      expect(headerTitle()).toBe(title);
      expect(selectedFolders()).toEqual(['Inbox']);
    }
  );

  it('names and selects the view of a search in Sent', () => {
    desktop();
    type('in:sent invoice');
    expect(inboxTabs()).toBeNull();
    expect(headerTitle()).toBe('Sent');
    expect(selectedFolders()).toEqual(['Sent']);
  });

  it.each(UNFINISHED_SEARCHES)(
    'stays on the search of all mail while %s is typed',
    (search) => {
      desktop();
      type('in');
      expect(headerTitle()).toBe('Search');
      expect(selectedFolders()).toEqual([]);

      type(search);
      expect(inboxTabs()).toBeNull();
      expect(headerTitle()).toBe('Search');
      expect(selectedFolders()).toEqual([]);
    }
  );

  it('brings back the tabs, on the tab open before the search, once it is cleared', () => {
    desktop();
    fireEvent.click(screen.getByRole('radio', { name: 'Noise' }));
    expect(selectedTab()).toBe('Noise');

    type('in:focus invoice');
    expect(inboxTabs()).toBeNull();

    press('Close search');
    expect(inboxTabs()).not.toBeNull();
    expect(headerTitle()).toBe('Inbox');
    expect(selectedFolders()).toEqual(['Inbox']);
    expect(selectedTab()).toBe('Noise');

    fireEvent.click(screen.getByRole('radio', { name: 'Signal' }));
    expect(selectedTab()).toBe('Signal');
    expect(searchField()).toBeNull();
  });
});

describe('phone tab strip', () => {
  const pills = () =>
    screen.queryAllByRole('tab').map((pill) => pill.textContent);
  const stripTitle = () => screen.getByTestId('pill-strip-title').textContent;

  it.each([
    ...INBOX_SEARCHES,
    { search: 'invoice', title: 'Search' },
    { search: 'in:', title: 'Noise' },
  ])(
    'shows the search’s view in place of the pills for $search',
    ({ search, title }) => {
      mocks.touch = true;
      const view = mount(() => <EmailMobileTabs />);
      fireEvent.click(screen.getByRole('tab', { name: 'Noise' }));
      expect(pills()).toEqual(['Focus', 'Signal', 'Noise']);

      view.setState('search', search);
      expect(pills()).toEqual([]);
      expect(stripTitle()).toBe(title);

      view.setState('search', '');
      expect(pills()).toEqual(['Focus', 'Signal', 'Noise']);
      expect(
        screen.getByRole('tab', { name: 'Noise' }).getAttribute('aria-selected')
      ).toBe('true');
    }
  );

  it('gives way to the search page as it opens, and comes back on the earlier tab', () => {
    mocks.touch = true;
    const view = mount(() => <EmailMobileLayout />);
    fireEvent.click(screen.getByRole('tab', { name: 'Noise' }));

    openSearch();
    expect(searchField()?.value).toBe('');
    expect(view.showsInboxTabs()).toBe(false);
    expect(pills()).toEqual([]);

    press('Cancel');
    expect(view.showsInboxTabs()).toBe(true);
    expect(pills()).toEqual(['Focus', 'Signal', 'Noise']);
    expect(
      screen.getByRole('tab', { name: 'Noise' }).getAttribute('aria-selected')
    ).toBe('true');
  });

  it('ends the search page for a view picked before a word is typed', () => {
    mocks.touch = true;
    const view = mount(() => <EmailMobileLayout />);
    openSearch();

    view.setTab('sent');
    expect(searchField()).toBeNull();
    expect(stripTitle()).toBe('Sent');
  });
});
