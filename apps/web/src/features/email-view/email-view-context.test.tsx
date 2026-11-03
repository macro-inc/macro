import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { cleanup, render } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type EmailViewContext,
  EmailViewProvider,
  useEmailView,
} from './email-view-context';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useRouteParams: vi.fn(),
  useEmailLinksQuery: vi.fn(),
  /** Whether the remote flag with this PostHog key is on. */
  flag: (_key: string): boolean => true,
  tab: (): string => 'important',
  savedView: (): string | undefined => undefined,
  tagSets: (): TagSetResponse[] => [],
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag:
    ({ key }: { key: string }) =>
    () => ({ enabled: mocks.flag(key), loading: false }),
}));
vi.mock('@app/components/list', () => ({
  createListController: () => ({}),
  listOwnedSlotName: (name: string) => name,
}));
vi.mock('@app/components/view-shell', () => ({}));
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
  useNavigate: () => mocks.navigate,
  useRouteParams: () => mocks.useRouteParams(),
  createSearchParams: () => [
    {
      get tab() {
        return mocks.tab();
      },
      get savedView() {
        return mocks.savedView();
      },
    },
  ],
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
vi.mock('@components/app/createPreviewSelectionGuard', () => ({
  createPreviewSelectionGuard: () =>
    Object.assign(() => true, { canSelect: () => true }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { id: 'mail-panel' } }),
  withSplitPanelOwner: (_slot: string, create: () => unknown) => create(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@property/tags/tag-sets-context', () => ({
  useTagSets: () => () => mocks.tagSets(),
  useTagSetsReady: () => () => true,
}));
vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => mocks.useEmailLinksQuery(),
}));
vi.mock('./persistence', () => ({ createEmailViewPersistence: () => ({}) }));
vi.mock('./queries/use-email-query', () => ({
  useEmailDataSource: () => ({ items: () => [] }),
}));
vi.mock('./route', () => ({
  emailSplitRoute: { id: 'view-mail' },
  emailThreadRoute: { id: 'mail-thread' },
}));
vi.mock('./email-route', () => ({
  emailTabSearch: { namespace: 'mail' },
  emailDetailSearch: { namespace: 'email-detail' },
  emailTabSearchCodec: { serialize: (value: unknown) => value },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.flag = () => true;
  mocks.tab = () => 'important';
  mocks.savedView = () => undefined;
  mocks.tagSets = () => [];
});

function mount() {
  const [linksQuery, setLinksQuery] = createStore({
    isSuccess: false,
    data: { links: [] as { id: string }[] },
  });
  const [params, setParams] = createStore<{ threadId?: string }>({
    threadId: 'open-thread',
  });
  mocks.useEmailLinksQuery.mockReturnValue(linksQuery);
  mocks.useRouteParams.mockReturnValue(params);
  mocks.navigate.mockImplementation(
    (target: { params: { threadId?: string } }) =>
      setParams('threadId', target.params.threadId)
  );
  let view!: EmailViewContext;
  function ReadContext() {
    view = useEmailView();
    return null;
  }
  render(() => (
    <EmailViewProvider initialState={{ inboxIds: ['saved-inbox'] }}>
      <ReadContext />
    </EmailViewProvider>
  ));
  return { view, setLinksQuery };
}

describe('email view inbox reconciliation', () => {
  it('selects an alias atomically without clearing it or navigating twice', () => {
    const { view } = mount();
    view.setAliasFilter({
      inboxId: 'saved-inbox',
      emailAddress: 'Resident@Example.com',
    });
    expect(view.state.aliasFilter).toEqual({
      inboxId: 'saved-inbox',
      emailAddress: 'resident@example.com',
    });
    expect(view.state.inboxIds).toEqual(['saved-inbox']);
    expect(mocks.navigate).toHaveBeenCalledOnce();
    view.setInboxIds(undefined);
    expect(view.state.aliasFilter).toBeUndefined();
    expect(view.state.inboxIds).toBeUndefined();
  });
  it.each([{ links: [] }, { links: [{ id: 'remaining-inbox' }] }])(
    'preserves the thread when loaded accounts invalidate the saved scope: %j',
    ({ links }) => {
      const { view, setLinksQuery } = mount();
      expect(view.state.inboxIds).toEqual(['saved-inbox']);
      expect(view.selectedThread()?.id).toBe('open-thread');

      setLinksQuery({ isSuccess: true, data: { links } });

      expect(view.state.inboxIds).toBeUndefined();
      expect(view.selectedThread()?.id).toBe('open-thread');
      expect(mocks.navigate).not.toHaveBeenCalled();
    }
  );

  it('still closes the thread when the user explicitly selects All inboxes', () => {
    const { view, setLinksQuery } = mount();
    setLinksQuery({
      isSuccess: true,
      data: { links: [{ id: 'saved-inbox' }] },
    });

    view.setInboxIds(undefined);

    expect(view.state.inboxIds).toBeUndefined();
    expect(view.selectedThread()).toBeUndefined();
    expect(mocks.navigate).toHaveBeenCalledOnce();
  });
});

it('clears persisted text search when entering and leaving Email Reminders', () => {
  const { view } = mount();
  view.setState('search', 'prior inbox search');
  view.setTab('reminders');
  expect(view.state.search).toBe('');
  view.setState('search', 'stale restored search');
  view.setTab('all');
  expect(view.state.search).toBe('');
});

describe('tag view title', () => {
  const qaTag = '019a1f40-2c7e-7d10-9a4b-6f2b0c1d2e40';
  const userTags = (): TagSetResponse[] => [
    {
      scope: 'user',
      options: [
        {
          id: qaTag,
          displayOrder: 0,
          propertyDefinitionId: 'user-tags',
          value: { type: 'string', value: 'QA test tag' },
        },
      ],
    },
  ];

  it('names the view after the tag chosen in the sidebar', () => {
    mocks.tagSets = userTags;
    const { view } = mount();
    view.showTags([qaTag]);
    expect(view.tagViewTitle()).toBe('QA test tag');
  });

  it('keeps the tab name when a tag only filters a tab', () => {
    mocks.tagSets = userTags;
    const { view } = mount();
    view.filterByTag(qaTag);
    expect(view.state.tab).toBe('important');
    expect(view.tagViewTitle()).toBeUndefined();
  });
});

it('normalizes restored and route-driven Reminders when the rollout is disabled', () => {
  const [flag, setFlag] = createStore({ enabled: true });
  mocks.flag = (key) => key !== 'enable-reminders' || flag.enabled;
  mocks.tab = () => 'reminders';
  const { view } = mount();
  expect(view.state.tab).toBe('reminders');
  setFlag('enabled', false);
  expect(view.state.tab).toBe('important');
  expect(view.state.search).toBe('');
  view.setTab('reminders');
  expect(view.state.tab).toBe('important');
});

it('leaves a restored Focus tab when Focus or GraphQL Soup turns off', () => {
  for (const off of ['enable-email-focus', 'enable-graphql-soup']) {
    const [flag, setFlag] = createStore({ enabled: true });
    mocks.flag = (key) => key !== off || flag.enabled;
    mocks.tab = () => 'focus';
    const { view } = mount();
    expect(view.state.tab).toBe('focus');
    setFlag('enabled', false);
    expect(view.state.tab).toBe('important');
    view.setTab('focus');
    expect(view.state.tab).toBe('important');
    cleanup();
  }
});

describe('saved views', () => {
  const VIEW_ID = '0199a1b2-0000-7000-8000-0000000000f1';
  const OTHER_INBOX = '0199a1b2-0000-7000-8000-0000000000e1';
  const record = {
    id: VIEW_ID,
    ownerId: 'user',
    name: 'Principals',
    sharedTeamId: null,
    revision: 1,
    config: {
      kind: 'email',
      version: 1,
      filters: {
        inboxIds: [OTHER_INBOX],
        participants: [{ type: 'domain', domain: 'example.com' }],
        participantFields: ['from', 'to', 'cc'],
        subject: [],
        starred: false,
        read: 'unread',
        attachments: [],
        calendarInvite: false,
        tags: [],
      },
    },
  };

  /** The URL follows navigation; the detail source knows one view. */
  function mountSavedViews(options: { known: boolean }) {
    const [search, setSearch] = createStore<{
      tab: string;
      savedView?: string;
    }>({ tab: 'important' });
    mocks.tab = () => search.tab;
    mocks.savedView = () => search.savedView;
    mocks.useEmailLinksQuery.mockReturnValue({
      isSuccess: true,
      data: { links: [{ id: 'saved-inbox', email_address: 'me@example.com' }] },
    });
    mocks.useRouteParams.mockReturnValue({});
    mocks.navigate.mockImplementation(
      (
        _target: unknown,
        navigation: { search: { mail: { tab: string; savedView?: string } } }
      ) => setSearch({ ...navigation.search.mail })
    );
    let view!: EmailViewContext;
    function ReadContext() {
      view = useEmailView();
      return null;
    }
    render(() => (
      <EmailViewProvider
        initialState={{ inboxIds: ['saved-inbox'] }}
        savedViewsEnabled={() => true}
        savedViewSource={(id) => ({
          data: () => {
            if (!id()) return undefined;
            return options.known && id() === VIEW_ID ? record : null;
          },
          viewerId: () => 'user',
          error: () => undefined,
          loading: () => false,
          refresh: async () => {},
        })}
      >
        <ReadContext />
      </EmailViewProvider>
    ));
    return view;
  }

  it('opens a view on All with its filters, tracks edits, and returns to the prior tab', () => {
    const view = mountSavedViews({ known: true });

    view.selectSavedView(VIEW_ID);

    expect(view.savedViewActive()).toBe(true);
    expect(view.state.tab).toBe('all');
    expect(view.state.inboxIds).toEqual([OTHER_INBOX]);
    expect(view.state.facets.read).toEqual(['unread']);
    expect(view.state.conditions?.participants).toEqual([
      { type: 'domain', domain: 'example.com' },
    ]);
    expect(view.savedViews?.view()).toMatchObject({
      kind: 'saved',
      dirty: false,
    });

    view.setFacets({ read: [] });
    expect(view.savedViews?.view()).toMatchObject({ dirty: true });
    view.savedViews?.reset();
    expect(view.state.facets.read).toEqual(['unread']);
    expect(view.savedViews?.view()).toMatchObject({ dirty: false });

    view.setTab('noise');

    expect(view.savedViewActive()).toBe(false);
    expect(view.state.tab).toBe('noise');
    expect(view.state.conditions).toBeUndefined();
    expect(view.state.inboxIds).toEqual(['saved-inbox']);
    expect(view.state.facets).toEqual({});
  });

  it('keeps a view scoped to an inbox that is no longer linked', () => {
    const view = mountSavedViews({ known: true });

    view.selectSavedView(VIEW_ID);

    expect(view.state.inboxIds).toEqual([OTHER_INBOX]);
  });

  it('shows a missing view as unavailable instead of listing all mail', () => {
    const view = mountSavedViews({ known: false });

    view.selectSavedView(VIEW_ID);

    expect(view.savedViews?.view().kind).toBe('unavailable');
    expect(view.state.conditions).toBeUndefined();

    view.leaveSavedView();
    expect(view.state.tab).toBe('important');
    expect(view.savedViewActive()).toBe(false);
  });
});
