import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { For, type JSX, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailHeader } from './components/EmailHeader';
import { EmailNavigation } from './components/EmailSidebar';
import {
  type EmailViewContext,
  EmailViewProvider,
  useEmailView,
} from './email-view-context';
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
        props: ParentProps<{ active?: boolean; onClick?: () => void }>
      ) => (
        <button
          type="button"
          aria-current={props.active ? 'page' : undefined}
          onClick={() => props.onClick?.()}
        >
          {props.children}
        </button>
      ),
    },
  };
});
vi.mock('@app/components/view-shell/ListHeader', () => ({
  ListHeader: (props: ParentProps<{ title: JSX.Element }>) => (
    <header>
      {props.title}
      {props.children}
    </header>
  ),
  ListHeaderSearch: (props: {
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <input
      type="search"
      aria-label="Search email"
      value={props.value}
      onInput={(event) => props.onValueChange(event.currentTarget.value)}
    />
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
vi.mock('@components/app/mobile/PillTabs', () => ({
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
vi.mock('./email-route', () => ({
  emailTabSearch: { namespace: 'mail' },
  emailDetailSearch: { namespace: 'email-detail' },
  emailTabSearchCodec: { serialize: (value: unknown) => value },
}));

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

const searchField = () => screen.getByRole<HTMLInputElement>('searchbox');
const type = (search: string) =>
  fireEvent.input(searchField(), { target: { value: search } });
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

describe('desktop header and sidebar', () => {
  const desktop = () =>
    mount(() => (
      <>
        <EmailHeader tabOnly />
        <EmailNavigation />
      </>
    ));

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

    type('');
    expect(inboxTabs()).not.toBeNull();
    expect(headerTitle()).toBe('Inbox');
    expect(selectedFolders()).toEqual(['Inbox']);
    expect(selectedTab()).toBe('Noise');

    fireEvent.click(screen.getByRole('radio', { name: 'Signal' }));
    expect(selectedTab()).toBe('Signal');
    expect(searchField().value).toBe('');
  });
});

describe('phone tab strip', () => {
  const pills = () =>
    screen.queryAllByRole('tab').map((pill) => pill.textContent);
  const stripTitle = () => screen.getByTestId('pill-strip-title').textContent;

  it.each([
    ...INBOX_SEARCHES,
    { search: 'invoice', title: 'Search' },
    { search: 'in:', title: 'Search' },
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
});
