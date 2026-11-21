import type { IUser } from '@core/user';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createEditor, type LexicalEditor } from 'lexical';
import { batch, createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createMenuOperations } from '../../../shared/inlineMenu';
import type { MentionItem } from '../../../utils/mentionsUtils';
import { useEmailSearchMention } from './hooks/useEmailSearchMention';
import { MentionsMenu } from './MentionsMenu';
import type { MentionBucketId } from './MentionsMenuController';
import { createItemHandler } from './utils/mentionHandlers';
import * as mobileSort from './utils/mobileSort';

const mocks = vi.hoisted(() => ({
  crmEnabled: false,
  whatsappEnabled: false,
  whatsappUserIds: [] as string[],
  mobile: false,
  requestedBuckets: [] as string[],
  searchedLists: [] as { buckets: string[]; enabled?: () => boolean }[],
  contacts: [] as import('@core/context/quickAccess').EntityItem[],
  contactSourceEnabled: undefined as (() => boolean) | undefined,
  setContactSearchDisabled: (_value: boolean) => {},
  hasMoreContacts: false,
  peopleLoading: (): boolean => false,
  people: (): import('@core/context/quickAccess').UserItem[] => [],
  peopleError: (): unknown => undefined,
  bookingLinks:
    (): import('../../../utils/mentionsUtils').BookingLinkMentionItem[] => [],
  retryPeople: vi.fn(async () => {}),
  contactsLoadingMore: (): boolean => false,
  loadMoreContacts: vi.fn(async () => {}),
  calendarEvents:
    [] as import('../../../utils/mentionsUtils').CalendarEventMentionItem[],
}));

vi.mock('@app/features/crm/record-adapter', () => ({
  useCrmContactMentionSource: (
    _search: () => string,
    enabled: () => boolean
  ) => {
    mocks.requestedBuckets.push('crm_contact');
    mocks.contactSourceEnabled = enabled;
    return {
      entities: () => mocks.contacts,
      users: () => [],
      totalCount: () => mocks.contacts.length,
      hasMore: () => mocks.hasMoreContacts,
      isLoadingMore: () => mocks.contactsLoadingMore(),
      loadMore: mocks.loadMoreContacts,
    };
  },
}));

vi.mock('@app/features/routines/routine-mentions', () => ({
  useRoutineMentionSource:
    (_searchTerm: () => string, enabled: () => boolean) => () =>
      enabled()
        ? [
            {
              kind: 'routine',
              id: 'routine-1',
              data: { id: 'routine-1', name: 'Weekly digest' },
            },
          ]
        : [],
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/lib/analytics/posthog', async () => {
  const { createSignal } = await import('solid-js');
  const [disabled, setDisabled] = createSignal(false);
  mocks.setContactSearchDisabled = setDisabled;
  return {
    useFeatureFlag: () => () => ({ enabled: disabled(), loading: false }),
  };
});
vi.mock('@app/signal/splitLayout', () => ({ globalSplitManager: () => null }));
vi.mock('@core/block', () => ({
  useMaybeBlockId: () => undefined,
  useMaybeBlockName: () => undefined,
}));
vi.mock('@core/constant/featureFlags', () => {
  const disableCrmContactSearch = { name: 'disable-crm-contact-search' };
  const enableCrm = { name: 'crm' };
  const enableWhatsappLinked = { name: 'whatsapp' };
  return {
    disableCrmContactSearch,
    enableContactLists: { name: 'enable-contact-lists' },
    enableCrm,
    enableWhatsappLinked,
    isFeatureEnabled: (flag: unknown) => {
      if (flag === enableWhatsappLinked) return mocks.whatsappEnabled;
      return mocks.crmEnabled;
    },
    ENABLE_BEARER_TOKEN_AUTH: false,
  };
});
vi.mock('@app/features/external-chat/queries/production-api', () => ({
  externalChatApi: {},
}));
vi.mock('@queries/gate', () => ({
  queryReadyGate: (query: { isSuccess: boolean }) => query.isSuccess,
}));
vi.mock('@queries/external-chats', () => ({
  useExternalChatsQuery: (_api: unknown, userId: () => string) => ({
    get isSuccess() {
      mocks.whatsappUserIds.push(userId());
      return userId() !== '';
    },
    data: [
      {
        id: 'group-1',
        name: 'Design Crit',
        ownerId: 'macro|gab@macro.com',
        unreadCount: 0,
        canSend: true,
      },
      {
        id: 'group-2',
        name: 'Launch Room',
        ownerId: 'macro|gab@macro.com',
        unreadCount: 0,
        canSend: true,
      },
      // Shared with the viewer: only its owner may share it on.
      {
        id: 'group-3',
        name: 'Design Review',
        ownerId: 'macro|ana@macro.com',
        unreadCount: 0,
        canSend: false,
      },
    ],
  }),
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    interactionForUser: () => undefined,
    usesRecordSelection: () => false,
    usesSearchProjection: () => false,
    useList: (...args: unknown[]) => {
      const [first] = args;
      const options =
        first && typeof first === 'object'
          ? (first as { buckets: string[]; enabled?: () => boolean })
          : undefined;
      if (options) {
        mocks.requestedBuckets.push(...options.buckets);
        mocks.searchedLists.push(options);
      }
      return {
        items: () =>
          options?.buckets.includes('person') && options.enabled?.() !== false
            ? mocks.people()
            : [],
        totalCount: () => 0,
        hasMore: () => false,
        isLoading: () => mocks.peopleLoading(),
        error: () =>
          options?.buckets.includes('person') ? mocks.peopleError() : undefined,
        retry: mocks.retryPeople,
        isLoadingMore: () => false,
        loadMore: async () => {},
      };
    },
  }),
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'gab@macro.com',
  useUserId: () => () => 'macro|gab@macro.com',
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: () => 'md',
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.mobile }));
vi.mock('@core/util/dateSearch/useDateSearch', () => ({
  useDateSearch: () => () => [],
}));
vi.mock('@core/component/ScopedPortal', () => ({
  ScopedPortal: (props: ParentProps) => props.children,
}));
vi.mock('../../../directive/floatWithSelection', () => ({
  floatWithSelection: vi.fn(),
}));
vi.mock('../../../directive/floatWithElement', () => ({
  floatWithElement: vi.fn(),
}));
vi.mock('../../../plugins', () => ({ CLOSE_INLINE_SEARCH_COMMAND: {} }));
vi.mock('./utils/mentionHandlers', () => ({ createItemHandler: vi.fn() }));
vi.mock('./hooks/useEmailSearchMention', () => ({
  useEmailSearchMention: vi.fn(),
}));
vi.mock('./hooks/useBookingLinkMention', () => ({
  useBookingLinkMention: () => ({
    bookingLinks: () => mocks.bookingLinks(),
    isLoading: () => false,
  }),
}));
vi.mock('./hooks/useCalendarEventMention', () => ({
  useCalendarEventMention: () => ({ events: () => mocks.calendarEvents }),
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@ui', () => ({
  Surface: (props: ParentProps) => <div>{props.children}</div>,
  Button: (
    props: ParentProps<{ onClick?: () => void; disabled?: boolean }>
  ) => (
    <button onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  ),
  cn: (...classes: unknown[]) =>
    classes.filter((c) => typeof c === 'string').join(' '),
}));

const originalScrollIntoView = Element.prototype.scrollIntoView;
const mockNoEmails = () =>
  vi.mocked(useEmailSearchMention).mockReturnValue({
    emails: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
  });
const manyUsers: IUser[] = Array.from({ length: 20 }, (_, i) => ({
  id: `macro|person${i}@macro.com`,
  name: `Person ${i}`,
  email: `person${i}@macro.com`,
}));

afterEach(() => {
  mocks.crmEnabled = false;
  mocks.whatsappEnabled = false;
  mocks.whatsappUserIds = [];
  mocks.mobile = false;
  mocks.requestedBuckets = [];
  mocks.searchedLists = [];
  mocks.contacts = [];
  mocks.contactSourceEnabled = undefined;
  mocks.setContactSearchDisabled(false);
  mocks.hasMoreContacts = false;
  mocks.peopleLoading = () => false;
  mocks.people = () => [];
  mocks.peopleError = () => undefined;
  mocks.bookingLinks = () => [];
  mocks.retryPeople.mockClear();
  mocks.contactsLoadingMore = () => false;
  mocks.loadMoreContacts.mockReset();
  mocks.loadMoreContacts.mockImplementation(async () => {});
  mocks.calendarEvents = [];
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

it('keeps matching category and row nodes mounted across typing and updated people', async () => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn();
  const seamus: IUser = {
    id: 'macro|seamus@macro.com',
    name: 'Seamus Edson',
    email: 'seamus@macro.com',
  };
  const [users, setUsers] = createSignal([seamus]);
  const menu = createMenuOperations();
  menu.setSearchTerm('sea');
  menu.openMenu();
  const onPick = vi.fn();
  render(() => (
    <MentionsMenu
      menu={menu}
      entities={() => []}
      users={users}
      sources={['users']}
      anchor={document.createElement('div')}
      onPick={onPick}
    />
  ));
  const heading = screen.getByText('People');
  const row = screen.getByTitle('Seamus Edson seamus@macro.com');
  for (const term of ['seam', 'seamu', 'seam', 'sea']) {
    menu.setSearchTerm(term);
    await vi.advanceTimersByTimeAsync(100);
    expect(screen.getByText('People')).toBe(heading);
    expect(screen.getByTitle('Seamus Edson seamus@macro.com')).toBe(row);
  }
  const updated = { ...seamus, name: 'Seamus Updated' };
  setUsers([updated]);
  expect(screen.getByText('People')).toBe(heading);
  expect(screen.getByTitle('Seamus Updated seamus@macro.com')).toBe(row);
  fireEvent.click(row);
  expect(onPick).toHaveBeenCalledWith(
    expect.objectContaining({ data: updated })
  );
  expect(menu.isOpen()).toBe(false);
});

it.each([false, true])(
  'leaves closed mention sources idle and refreshes them on reopen (mobile: %s)',
  async (mobile) => {
    mocks.mobile = mobile;
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    const sort = vi.spyOn(mobileSort, 'sortMobileMentions');
    const seamus: IUser = {
      id: 'macro|seamus@macro.com',
      name: 'Seamus Edson',
      email: 'seamus@macro.com',
    };
    const [users, setUsers] = createSignal([seamus]);
    const readUsers = vi.fn(users);
    const readEntities = vi.fn(() => []);
    const menu = createMenuOperations();
    const onPick = vi.fn();
    render(() => (
      <MentionsMenu
        menu={menu}
        users={readUsers}
        entities={readEntities}
        sources={['users', 'documents', 'channels']}
        anchor={document.createElement('div')}
        onPick={onPick}
      />
    ));

    expect(readUsers).not.toHaveBeenCalled();
    expect(readEntities).not.toHaveBeenCalled();
    expect(sort).not.toHaveBeenCalled();
    menu.setSearchTerm('sea');
    await vi.advanceTimersByTimeAsync(100);
    expect(readUsers).not.toHaveBeenCalled();
    expect(readEntities).not.toHaveBeenCalled();
    expect(sort).not.toHaveBeenCalled();

    menu.openMenu();
    expect(screen.getByTitle('Seamus Edson seamus@macro.com')).toBeTruthy();
    expect(readUsers).toHaveBeenCalled();
    expect(readEntities).toHaveBeenCalled();
    if (mobile) expect(sort).toHaveBeenCalled();

    menu.closeMenu();
    readUsers.mockClear();
    readEntities.mockClear();
    sort.mockClear();
    const updated = { ...seamus, name: 'Seamus Updated' };
    setUsers([updated]);
    menu.setSearchTerm('updated');
    await vi.advanceTimersByTimeAsync(100);
    expect(readUsers).not.toHaveBeenCalled();
    expect(readEntities).not.toHaveBeenCalled();
    expect(sort).not.toHaveBeenCalled();

    menu.openMenu();
    expect(screen.getByTitle('Seamus Updated seamus@macro.com')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Enter' });
    await vi.advanceTimersByTimeAsync(0);
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ data: updated })
    );
    expect(menu.isOpen()).toBe(false);
  }
);

it('closes the mobile menu on the first Escape', () => {
  mocks.mobile = true;
  Element.prototype.scrollIntoView = vi.fn();
  mockNoEmails();
  const menu = createMenuOperations();
  render(() => (
    <MentionsMenu
      menu={menu}
      editor={createEditor()}
      users={() => manyUsers}
      sources={['users']}
    />
  ));

  menu.openMenu();
  expect(menu.isOpen()).toBe(true);
  expect(screen.queryByText(/View all/)).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(menu.isOpen()).toBe(false);
  expect(screen.queryByText(/View all/)).toBeNull();
});

it('leaves a category list on the first desktop Escape and closes on the second', () => {
  Element.prototype.scrollIntoView = vi.fn();
  mockNoEmails();
  const menu = createMenuOperations();
  render(() => (
    <MentionsMenu
      menu={menu}
      editor={createEditor()}
      users={() => manyUsers}
      sources={['users']}
    />
  ));

  menu.openMenu();
  fireEvent.keyDown(document, { key: 'ArrowRight' });
  expect(screen.getByText('Back to everything')).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(menu.isOpen()).toBe(true);
  expect(screen.queryByText('Back to everything')).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(menu.isOpen()).toBe(false);
});

it('reads past an empty continuation without a button and keeps the editor menu open', async () => {
  mocks.crmEnabled = true;
  mocks.hasMoreContacts = true;
  mockNoEmails();
  const [loadingMore, setLoadingMore] = createSignal(false);
  mocks.contactsLoadingMore = loadingMore;
  const page = Promise.withResolvers<void>();
  mocks.loadMoreContacts.mockImplementationOnce(async () => {
    setLoadingMore(true);
    await page.promise;
    setLoadingMore(false);
  });
  const menu = createMenuOperations();
  const editor = createEditor();
  render(() => (
    <MentionsMenu
      menu={menu}
      editor={editor}
      users={() => []}
      sources={['crm']}
    />
  ));

  menu.openMenu();
  expect(screen.queryByText('No results')).toBeNull();
  fireEvent.click(screen.getByText('View all'));

  // The empty window reads its next page by itself, one page at a time.
  expect(mocks.loadMoreContacts).toHaveBeenCalledTimes(1);
  page.resolve();
  await page.promise;
  await Promise.resolve();
  expect(mocks.loadMoreContacts).toHaveBeenCalledTimes(2);
  expect(menu.isOpen()).toBe(true);
});

it('keeps every search source idle while the menu is closed', () => {
  mocks.crmEnabled = true;
  mockNoEmails();
  const menu = createMenuOperations();
  render(() => (
    <MentionsMenu menu={menu} editor={createEditor()} users={() => []} />
  ));
  // Each composer mounts a closed menu; an enabled list would re-run its
  // cache search on every cache change.
  expect(mocks.searchedLists.map((list) => list.buckets)).toEqual(
    expect.arrayContaining([['channel', 'dm'], ['crm_company']])
  );
  const emailSearch = vi.mocked(useEmailSearchMention).mock.calls[0][0];
  expect(mocks.searchedLists.map((list) => list.enabled?.())).not.toContain(
    true
  );
  expect(mocks.searchedLists.every((list) => list.enabled)).toBe(true);
  expect(emailSearch.enabled?.()).toBe(false);

  menu.openMenu();
  const entityLists = mocks.searchedLists.filter(
    (list) => !list.buckets.includes('person')
  );
  expect(entityLists.map((list) => list.enabled?.())).not.toContain(false);
  expect(emailSearch.enabled?.()).toBe(true);
});

it('only paginates an open mobile menu and resumes on reopen', async () => {
  mocks.mobile = true;
  mocks.crmEnabled = true;
  mocks.hasMoreContacts = true;
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(useEmailSearchMention).mockReturnValue({
    emails: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
  });
  const menu = createMenuOperations();
  const editor = createEditor();
  render(() => (
    <MentionsMenu
      menu={menu}
      editor={editor}
      users={() => []}
      sources={['crm']}
    />
  ));
  expect(mocks.loadMoreContacts).not.toHaveBeenCalled();

  menu.openMenu();
  await Promise.resolve();
  const whileOpen = mocks.loadMoreContacts.mock.calls.length;
  expect(whileOpen).toBeGreaterThan(0);

  menu.closeMenu();
  await Promise.resolve();
  expect(mocks.loadMoreContacts).toHaveBeenCalledTimes(whileOpen);

  menu.openMenu();
  await Promise.resolve();
  expect(mocks.loadMoreContacts.mock.calls.length).toBeGreaterThan(whileOpen);
});

it('offers CRM companies and contacts', () => {
  mocks.crmEnabled = true;
  vi.mocked(useEmailSearchMention).mockReturnValue({
    emails: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
  } as unknown as ReturnType<typeof useEmailSearchMention>);
  const menu = createMenuOperations();
  menu.openMenu();
  render(() => (
    <MentionsMenu
      menu={menu}
      users={() => []}
      anchor={document.createElement('div')}
      onPick={vi.fn()}
    />
  ));
  expect(mocks.requestedBuckets).toContain('crm_company');
  expect(mocks.requestedBuckets).toContain('crm_contact');
});

it('stops contact queries and results when the kill switch turns on while open', () => {
  Element.prototype.scrollIntoView = vi.fn();
  mocks.crmEnabled = true;
  mocks.contacts = [
    {
      kind: 'entity',
      bucket: 'crm_contact',
      id: 'contact-1',
      searchText: 'Acme contact',
      sortTimestamp: 0,
      timestamps: {},
      data: {
        type: 'crm_contact',
        id: 'contact-1',
        ownerId: 'team',
        companyId: 'company',
        name: 'Acme contact',
        email: 'contact@example.com',
        hidden: false,
        lastInteraction: '2026-01-01T00:00:00Z',
      },
    },
  ];
  mockNoEmails();
  const menu = createMenuOperations();
  menu.openMenu();
  render(() => (
    <MentionsMenu
      menu={menu}
      users={() => []}
      sources={['crm']}
      anchor={document.createElement('div')}
      onPick={vi.fn()}
    />
  ));
  expect(screen.getByText('Acme contact')).toBeTruthy();
  expect(mocks.contactSourceEnabled?.()).toBe(true);

  mocks.setContactSearchDisabled(true);

  expect(menu.isOpen()).toBe(true);
  expect(mocks.contactSourceEnabled?.()).toBe(false);
  expect(screen.queryByText('Acme contact')).toBeNull();
});

it('offers calendar events and picks one', () => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(useEmailSearchMention).mockReturnValue({
    emails: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
  } as unknown as ReturnType<typeof useEmailSearchMention>);
  mocks.calendarEvents = [
    {
      kind: 'calendarEvent',
      id: 'event-1',
      data: { eventId: 'event-1', title: 'Planning', when: 'Mon, Oct 26' },
    },
  ];
  const onPick = vi.fn();
  const menu = createMenuOperations();
  menu.openMenu();
  render(() => (
    <MentionsMenu
      menu={menu}
      users={() => []}
      anchor={document.createElement('div')}
      onPick={onPick}
    />
  ));
  expect(screen.getByText('Calendar events')).toBeTruthy();
  fireEvent.click(screen.getByText('Planning'));
  expect(onPick).toHaveBeenCalledWith(mocks.calendarEvents[0]);
});

it('opens cell pickers without replaying the menu entrance animation', () => {
  const menu = createMenuOperations();
  menu.openMenu();
  const { container } = render(() => (
    <MentionsMenu
      menu={menu}
      entities={() => []}
      users={() => []}
      sources={['users']}
      anchor={document.createElement('div')}
      onPick={vi.fn()}
      animate={false}
    />
  ));
  expect(screen.getByText('No results')).toBeTruthy();
  expect(container.querySelector('.menu-open-animation')).toBeNull();
});

it('records mentions against the editing source outside a legacy block', () => {
  vi.mocked(useEmailSearchMention).mockReturnValue({
    emails: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
  } as unknown as ReturnType<typeof useEmailSearchMention>);
  const editor = {
    dispatchCommand: vi.fn(),
    getRootElement: () => null,
  } as unknown as LexicalEditor;
  render(() => (
    <MentionsMenu
      menu={createMenuOperations()}
      users={() => []}
      editor={editor}
      sourceDocumentId="doc-1"
    />
  ));
  expect(createItemHandler).toHaveBeenCalledWith(
    expect.objectContaining({ blockId: 'doc-1' })
  );
});

it("offers the viewer's own WhatsApp chats to share by mention, only in channel composers", () => {
  mocks.whatsappEnabled = true;
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(useEmailSearchMention).mockReturnValue({
    emails: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
  } as unknown as ReturnType<typeof useEmailSearchMention>);
  const menu = createMenuOperations();
  menu.openMenu();
  menu.setSearchTerm('design');
  render(() => (
    <MentionsMenu
      menu={menu}
      users={() => []}
      block="channel"
      anchor={document.createElement('div')}
      onPick={vi.fn()}
    />
  ));
  expect(screen.getByText('WhatsApp chats')).toBeTruthy();
  expect(screen.getByText('Design Crit')).toBeTruthy();
  expect(screen.queryByText('Launch Room')).toBeNull();
  expect(screen.queryByText('Design Review')).toBeNull();
  cleanup();

  mocks.whatsappUserIds = [];
  render(() => (
    <MentionsMenu
      menu={menu}
      users={() => []}
      anchor={document.createElement('div')}
      onPick={vi.fn()}
    />
  ));
  expect(screen.queryByText('WhatsApp chats')).toBeNull();
  expect(mocks.whatsappUserIds.every((id) => id === '')).toBe(true);
});

it("offers the viewer's routines to share by mention, only in channel composers", () => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(useEmailSearchMention).mockReturnValue({
    emails: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
  } as unknown as ReturnType<typeof useEmailSearchMention>);
  const menu = createMenuOperations();
  menu.openMenu();
  render(() => (
    <MentionsMenu
      menu={menu}
      users={() => []}
      block="channel"
      anchor={document.createElement('div')}
      onPick={vi.fn()}
    />
  ));
  expect(screen.getByText('Routines')).toBeTruthy();
  expect(screen.getByText('Weekly digest')).toBeTruthy();
  cleanup();

  render(() => (
    <MentionsMenu
      menu={menu}
      users={() => []}
      anchor={document.createElement('div')}
      onPick={vi.fn()}
    />
  ));
  expect(screen.queryByText('Routines')).toBeNull();
});

it('marks an offline agent and refuses to mention it', () => {
  Element.prototype.scrollIntoView = vi.fn();
  const offlineAgent: IUser = {
    id: 'bot|agent-1',
    name: 'Dev box agent',
    email: 'Dev box agent',
    offline: true,
  };
  const menu = createMenuOperations();
  menu.openMenu();
  const onPick = vi.fn();
  render(() => (
    <MentionsMenu
      menu={menu}
      entities={() => []}
      users={() => [offlineAgent]}
      sources={['users']}
      anchor={document.createElement('div')}
      onPick={onPick}
    />
  ));

  expect(screen.getByText('Offline')).toBeTruthy();
  fireEvent.click(screen.getByTitle('Dev box agent — offline'));
  expect(onPick).not.toHaveBeenCalled();
  expect(menu.isOpen()).toBe(true);
});

it('says it is searching only for a slow search, and never that there are no results before sources answer', async () => {
  vi.useFakeTimers();
  mockNoEmails();
  const [loading, setLoading] = createSignal(true);
  mocks.peopleLoading = loading;
  const menu = createMenuOperations();
  menu.setSearchTerm('jacob');
  menu.openMenu();
  render(() => (
    <MentionsMenu
      menu={menu}
      entities={() => []}
      sources={['users']}
      anchor={document.createElement('div')}
      onPick={vi.fn()}
    />
  ));
  // A quick answer shows neither label.
  await vi.advanceTimersByTimeAsync(200);
  expect(screen.queryByText('Searching…')).toBeNull();
  expect(screen.queryByText('No results')).toBeNull();

  await vi.advanceTimersByTimeAsync(300);
  expect(screen.getByText('Searching…')).toBeTruthy();
  expect(screen.queryByText('No results')).toBeNull();

  // Once shown it stays long enough to read, then gives the answer.
  setLoading(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(screen.getByText('Searching…')).toBeTruthy();
  await vi.advanceTimersByTimeAsync(500);
  expect(screen.getByText('No results')).toBeTruthy();
  expect(screen.queryByText('Searching…')).toBeNull();
});

const acmeContacts = Array.from(
  { length: 8 },
  (_, index) =>
    ({
      kind: 'entity',
      bucket: 'crm_contact',
      id: `contact-${index + 1}`,
      searchText: `Acme contact ${index + 1}`,
      sortTimestamp: 0,
      timestamps: {},
      data: {
        type: 'crm_contact',
        id: `contact-${index + 1}`,
        ownerId: 'team',
        companyId: 'company',
        name: `Acme contact ${index + 1}`,
        email: `contact${index + 1}@example.com`,
        hidden: false,
        lastInteraction: '2026-01-01T00:00:00Z',
      },
    }) as import('@core/context/quickAccess').EntityItem
);
const macroAgent: IUser = {
  id: 'bot|00000000-0000-0000-0000-00000000a2a2',
  name: 'Macro',
  email: 'Macro',
};
const codex: IUser = {
  id: 'bot|00000000-0000-0000-0000-000000000101',
  name: 'Review Desk Codex',
  email: '@review-desk-codex',
};
const directoryPeople: import('@core/context/quickAccess').UserItem[] = [
  {
    id: 'macro|ana@example.com',
    kind: 'user',
    bucket: 'person',
    searchText: 'Ana Lima | ana@example.com',
    sortTimestamp: 0,
    timestamps: {},
    personOrder: 0,
    data: {
      id: 'macro|ana@example.com',
      name: 'Ana Lima',
      email: 'ana@example.com',
    },
  },
  {
    id: 'macro|bo@example.com',
    kind: 'user',
    bucket: 'person',
    searchText: 'Bo Chen | bo@example.com',
    sortTimestamp: 0,
    timestamps: {},
    personOrder: 1,
    data: {
      id: 'macro|bo@example.com',
      name: 'Bo Chen',
      email: 'bo@example.com',
    },
  },
];

/** A Discussion menu over the directory, opened while its people load. */
function openWhilePeopleLoad(options: {
  agents: IUser[];
  phone?: boolean;
  term?: string;
  sources?: MentionBucketId[];
  onPick?: (item: MentionItem) => void;
}) {
  mocks.crmEnabled = true;
  mockNoEmails();
  Element.prototype.scrollIntoView = vi.fn();
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<unknown>();
  const [people, setPeople] = createSignal<
    import('@core/context/quickAccess').UserItem[]
  >([]);
  mocks.peopleLoading = loading;
  mocks.peopleError = error;
  mocks.people = people;
  mocks.contacts = acmeContacts;
  const menu = createMenuOperations();
  menu.setSearchTerm(options.term ?? '');
  menu.openMenu();
  const transformUsers = (users: readonly IUser[]) => [
    ...users,
    ...options.agents,
  ];
  render(() =>
    options.phone ? (
      <MentionsMenu
        menu={menu}
        sources={options.sources ?? ['users', 'crm']}
        transformUsers={transformUsers}
        editor={createEditor()}
      />
    ) : (
      <MentionsMenu
        menu={menu}
        sources={options.sources ?? ['users', 'crm']}
        transformUsers={transformUsers}
        anchor={document.createElement('div')}
        onPick={options.onPick ?? vi.fn()}
      />
    )
  );
  return {
    land: () => {
      setPeople(directoryPeople);
      setError(undefined);
      setLoading(false);
    },
    // The person list drops its rows when a read fails.
    fail: () =>
      batch(() => {
        setPeople([]);
        setError(new Error('cache worker timeout: read'));
        setLoading(false);
      }),
    // A refetch with no data clears the failed read's error as it starts.
    read: () =>
      batch(() => {
        setLoading(true);
        setError(undefined);
      }),
  };
}
const placeholderRows = (label: string) =>
  (screen
    .queryByRole('status', { name: label })
    ?.querySelectorAll('.skeleton-shimmer').length ?? 0) / 2;
const contactRows = () => screen.queryAllByText(/^Acme contact \d$/).length;

it.each([
  ['Macro and Codex', [codex, macroAgent]],
  ['Macro alone', [macroAgent]],
])(
  'keeps the People rows for people still loading, so nothing moves under the highlight when they land (%s)',
  (_, agents) => {
    const onPick = vi.fn();
    const people = openWhilePeopleLoad({ agents, onPick });

    // Codex will follow the people: it waits instead of taking their rows.
    expect(screen.getByText('Macro')).toBeTruthy();
    expect(screen.queryByText('Review Desk Codex')).toBeNull();
    expect(placeholderRows('Loading people')).toBe(2);
    expect(contactRows()).toBe(5);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    const contact = screen.getByText('Acme contact 1');

    people.land();
    expect(placeholderRows('Loading people')).toBe(0);
    expect(contactRows()).toBe(5);
    const text = document.body.textContent ?? '';
    const order = ['Macro', 'Ana Lima', 'Bo Chen', 'Acme contact 1'].map(
      (name) => text.indexOf(name)
    );
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(screen.getByText('Acme contact 1')).toBe(contact);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'contact-1' })
    );
  }
);

it('lists nothing below Macro on phones until the people it pins arrive, at the height it will have', () => {
  mocks.mobile = true;
  // jsdom lays nothing out; give the virtual list a viewport to fill.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(256);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(384);
  const people = openWhilePeopleLoad({
    agents: [codex, macroAgent],
    phone: true,
  });
  const listed = () =>
    Number.parseInt(
      document.querySelector<HTMLElement>('[style*="position: relative"]')
        ?.style.height ?? '0',
      10
    );
  const filler = () =>
    Number.parseInt(
      screen.queryByRole('status', { name: 'Loading…' })?.parentElement?.style
        .height ?? '0',
      10
    );

  expect(screen.getByText('Macro')).toBeTruthy();
  expect(screen.queryByText('Review Desk Codex')).toBeNull();
  expect(contactRows()).toBe(0);
  expect(listed() + filler()).toBe(256);

  people.land();
  expect(screen.queryByRole('status', { name: 'Loading…' })).toBeNull();
  expect(screen.getByText('Ana Lima')).toBeTruthy();
  expect(contactRows()).toBeGreaterThan(0);
  expect(listed()).toBeGreaterThanOrEqual(256);
});

it('keeps the highlighted row while people land above it', () => {
  const onPick = vi.fn();
  // Macro holds the letter but not at the start: it waits with Codex, so
  // People lists nobody yet and the first contact is highlighted.
  const people = openWhilePeopleLoad({
    agents: [codex, macroAgent],
    term: 'c',
    onPick,
  });
  expect(screen.queryByText('Macro')).toBeNull();
  expect(placeholderRows('Loading people')).toBe(3);

  people.land();
  expect(screen.getByText('Ana Lima')).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(onPick).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'contact-1' })
  );
});

it('waits for the re-read when a later read fails, instead of moving the rows below up', () => {
  const people = openWhilePeopleLoad({ agents: [codex, macroAgent] });
  people.land();
  expect(screen.getByText('Ana Lima')).toBeTruthy();

  // The directory reads again (a contact changed) and the cache times it out.
  people.read();
  people.fail();
  expect(mocks.retryPeople).toHaveBeenCalledOnce();
  expect(screen.queryByText('Review Desk Codex')).toBeNull();
  expect(placeholderRows('Loading people')).toBe(2);
  expect(contactRows()).toBe(5);

  people.read();
  people.land();
  expect(screen.getByText('Ana Lima')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps People in place while its first answer loads even when no agent matches, holding the highlighted row', () => {
  const onPick = vi.fn();
  const people = openWhilePeopleLoad({
    agents: [codex, macroAgent],
    term: 'te',
    onPick,
  });
  expect(placeholderRows('Loading people')).toBe(3);
  expect(contactRows()).toBe(5);
  const contact = screen.getByText('Acme contact 1');

  people.land();
  expect(screen.getByText('Ana Lima')).toBeTruthy();
  expect(screen.getByText('Acme contact 1')).toBe(contact);
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(onPick).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'contact-1' })
  );
});

it('lists booking links that arrive late below People, leaving the highlighted row in place', () => {
  const onPick = vi.fn();
  const [links, setLinks] = createSignal<
    import('../../../utils/mentionsUtils').BookingLinkMentionItem[]
  >([]);
  mocks.bookingLinks = links;
  const people = openWhilePeopleLoad({
    agents: [macroAgent],
    sources: ['users', 'bookingLinks', 'crm'],
    onPick,
  });
  people.land();
  const macro = screen.getByText('Macro');

  setLinks([
    {
      kind: 'bookingLink',
      id: 'profile-1:intro',
      data: {
        profileId: 'profile-1',
        slug: 'intro',
        title: 'Intro call',
        durationMinutes: 30,
        owner: 'Personal',
      },
    },
  ]);
  const text = document.body.textContent ?? '';
  const order = ['Macro', 'Ana Lima', 'Bo Chen', 'Intro call'].map((name) =>
    text.indexOf(name)
  );
  expect(order).toEqual([...order].sort((left, right) => left - right));
  expect(screen.getByText('Macro')).toBe(macro);
});

it('reads a failed people window again by itself, holding the People rows meanwhile', () => {
  const people = openWhilePeopleLoad({ agents: [codex, macroAgent] });

  // A busy cache timed the read out: the menu reads it again and keeps waiting.
  people.fail();
  expect(mocks.retryPeople).toHaveBeenCalledOnce();
  people.read();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('Review Desk Codex')).toBeNull();
  expect(placeholderRows('Loading people')).toBe(2);

  people.land();
  const text = document.body.textContent ?? '';
  const order = ['Macro', 'Ana Lima', 'Bo Chen'].map((name) =>
    text.indexOf(name)
  );
  expect(order).toEqual([...order].sort((left, right) => left - right));
  expect(mocks.retryPeople).toHaveBeenCalledOnce();
});

it('offers Retry when the people read fails again, and waits for the retried read as on opening', async () => {
  const people = openWhilePeopleLoad({ agents: [codex, macroAgent] });

  people.fail();
  await Promise.resolve();
  await Promise.resolve();
  expect(mocks.retryPeople).toHaveBeenCalledOnce();
  expect(screen.getByText('Review Desk Codex')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain(
    "Couldn't load people"
  );

  fireEvent.click(screen.getByText('Retry'));
  expect(mocks.retryPeople).toHaveBeenCalledTimes(2);
  people.read();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('Review Desk Codex')).toBeNull();
  expect(placeholderRows('Loading people')).toBe(2);

  people.land();
  const text = document.body.textContent ?? '';
  const order = ['Macro', 'Ana Lima', 'Bo Chen'].map((name) =>
    text.indexOf(name)
  );
  expect(order).toEqual([...order].sort((left, right) => left - right));
});

it('says it is searching while People loads when the other sections cannot answer the query', async () => {
  vi.useFakeTimers();
  mockNoEmails();
  mocks.peopleLoading = () => true;
  const menu = createMenuOperations();
  menu.setSearchTerm('jacob');
  menu.openMenu();
  render(() => (
    <MentionsMenu
      menu={menu}
      sources={['users', 'bookingLinks']}
      anchor={document.createElement('div')}
      onPick={vi.fn()}
    />
  ));
  // Booking Links answer only an empty query, so there is nothing below
  // People to keep in place.
  expect(screen.queryByRole('status', { name: 'Loading people' })).toBeNull();
  await vi.advanceTimersByTimeAsync(500);
  expect(screen.getByText('Searching…')).toBeTruthy();
});

it('picks the highlighted mention on Enter at once, even while typing continues', async () => {
  vi.useFakeTimers();
  mockNoEmails();
  Element.prototype.scrollIntoView = vi.fn();
  const ana: IUser = {
    id: 'macro|ana@macro.com',
    name: 'Ana Lima',
    email: 'ana@macro.com',
  };
  const bo: IUser = {
    id: 'macro|bo@macro.com',
    name: 'Bo Chen',
    email: 'bo@macro.com',
  };
  const menu = createMenuOperations();
  menu.setSearchTerm('bo');
  menu.openMenu();
  const onPick = vi.fn();
  render(() => (
    <MentionsMenu
      menu={menu}
      entities={() => []}
      users={() => [ana, bo]}
      sources={['users']}
      anchor={document.createElement('div')}
      onPick={onPick}
    />
  ));
  await vi.advanceTimersByTimeAsync(100);
  expect(screen.getByTitle('Bo Chen bo@macro.com')).toBeTruthy();

  // Typed past the listed term and pressed Enter within the debounce, then
  // kept typing: the pick is for the typed text and is not lost.
  menu.setSearchTerm('ana');
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(onPick).toHaveBeenCalledOnce();
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ data: ana }));
  menu.setSearchTerm('ana!');
  await vi.advanceTimersByTimeAsync(200);
  expect(onPick).toHaveBeenCalledOnce();
});
