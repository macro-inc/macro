import type { IUser } from '@core/user';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createEditor, type LexicalEditor } from 'lexical';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createMenuOperations } from '../../../shared/inlineMenu';
import { useEmailSearchMention } from './hooks/useEmailSearchMention';
import { MentionsMenu } from './MentionsMenu';
import { createItemHandler } from './utils/mentionHandlers';
import * as mobileSort from './utils/mobileSort';

const mocks = vi.hoisted(() => ({
  crmEnabled: false,
  whatsappEnabled: false,
  whatsappUserIds: [] as string[],
  mobile: false,
  requestedBuckets: [] as string[],
  contacts: [] as import('@core/context/quickAccess').EntityItem[],
  hasMoreContacts: false,
  loadMoreContacts: vi.fn(async () => {}),
  calendarEvents:
    [] as import('../../../utils/mentionsUtils').CalendarEventMentionItem[],
}));

vi.mock('@app/features/crm/record-adapter', () => ({
  useCrmContactMentionSource: () => {
    mocks.requestedBuckets.push('crm_contact');
    return {
      entities: () => mocks.contacts,
      totalCount: () => mocks.contacts.length,
      hasMore: () => mocks.hasMoreContacts,
      isLoadingMore: () => false,
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
vi.mock('@app/signal/splitLayout', () => ({ globalSplitManager: () => null }));
vi.mock('@core/block', () => ({
  useMaybeBlockId: () => undefined,
  useMaybeBlockName: () => undefined,
}));
vi.mock('@core/constant/featureFlags', () => {
  const enableCrm = { name: 'crm' };
  const enableWhatsappLinked = { name: 'whatsapp' };
  return {
    enableCrm,
    enableWhatsappLinked,
    isFeatureEnabled: (flag: unknown) =>
      flag === enableWhatsappLinked ? mocks.whatsappEnabled : mocks.crmEnabled,
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
    usesRecordSelection: () => false,
    usesSearchProjection: () => false,
    useList: (...args: unknown[]) => {
      const [first] = args;
      if (first && typeof first === 'object') {
        mocks.requestedBuckets.push(
          ...(first as { buckets: string[] }).buckets
        );
      }
      return {
        items: () => [],
        totalCount: () => 0,
        hasMore: () => false,
        isLoading: () => false,
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
    bookingLinks: () => [],
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
  mocks.contacts = [];
  mocks.hasMoreContacts = false;
  mocks.loadMoreContacts.mockClear();
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
      sources={['users']}
      includeContacts
    />
  ));
  expect(mocks.loadMoreContacts).not.toHaveBeenCalled();

  menu.openMenu();
  await Promise.resolve();
  expect(mocks.loadMoreContacts).toHaveBeenCalledTimes(1);

  menu.closeMenu();
  await Promise.resolve();
  expect(mocks.loadMoreContacts).toHaveBeenCalledTimes(1);

  menu.openMenu();
  await Promise.resolve();
  expect(mocks.loadMoreContacts).toHaveBeenCalledTimes(2);
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
