import type { UserItem } from '@core/context/quickAccess';
import type { QuickAccessListOptions } from '@core/context/quickAccess/types';
import type { IUser } from '@core/user';
import { MENTION_LIST_PRIORITY } from '@queries/contacts/list-priority';
import { batch, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sortMobileMentions } from '../utils/mobileSort';
import { useUsersMention } from './useUsersMention';

const mocks = vi.hoisted(() => ({
  users: (): UserItem[] => [],
  loading: (): boolean => false,
  error: (): unknown => undefined,
  retry: vi.fn<() => Promise<void>>(),
  loadMore: vi.fn<() => Promise<void>>(),
  listOptions: [] as QuickAccessListOptions[],
  contactLists: (): boolean => false,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.contactLists() }),
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: (options: QuickAccessListOptions) => {
      mocks.listOptions.push(options);
      return {
        items: () => (options.enabled?.() === false ? [] : mocks.users()),
        windowKey: () => 'window',
        hasMore: () => true,
        isLoading: () => mocks.loading(),
        error: () => mocks.error(),
        retry: mocks.retry,
        isLoadingMore: () => false,
        loadMore: mocks.loadMore,
      };
    },
    interactionForUser: (id: string) =>
      mocks.users().find((user) => user.id === id)?.timestamps
        .lastInteraction ?? undefined,
  }),
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'gab@macro.com',
  useUserId: () => () => 'macro|morgan@macro.com',
}));

const seamus: IUser = {
  id: 'macro|seamus@macro.com',
  name: 'Seamus Edson',
  email: 'seamus@macro.com',
};
const alias: IUser = {
  id: 'macro|seamus+05@macro.com',
  name: 'seamus+05',
  email: 'seamus+05@macro.com',
};
const sean: IUser = {
  id: 'macro|sean@macro.com',
  name: 'Sean Aye',
  email: 'sean@macro.com',
};
const viewer: IUser = {
  id: 'macro|morgan@macro.com',
  name: 'Morgan Reyes',
  email: 'morgan@macro.com',
};
const macroAgent: IUser = {
  id: 'bot|00000000-0000-0000-0000-00000000a2a2',
  name: 'Macro',
  email: 'Macro',
};
const reviewCodex: IUser = {
  id: 'bot|00000000-0000-0000-0000-000000000101',
  name: 'Review Desk Codex',
  email: '@review-desk-codex',
};
const releaseCodex: IUser = {
  id: 'bot|00000000-0000-0000-0000-000000000102',
  name: 'Release Verifier Codex',
  email: '@release-verifier-codex',
};
const esteban: IUser = {
  id: 'macro|esteban@macro.com',
  name: 'Esteban Valdez',
  email: 'esteban.valdez@macro.com',
};
const eve: IUser = {
  id: 'macro|eve@macro.com',
  name: 'Eve Hart',
  email: 'eve@macro.com',
};
const userItem = (user: IUser, lastInteraction?: Date): UserItem => ({
  id: user.id,
  data: user,
  kind: 'user',
  bucket: 'person',
  searchText: `${user.name} | ${user.email}`,
  sortTimestamp: lastInteraction?.getTime() ?? 0,
  timestamps: { lastInteraction },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
  mocks.loadMore.mockReset();
  mocks.loadMore.mockResolvedValue(undefined);
  mocks.loading = () => false;
  mocks.error = () => undefined;
  mocks.retry.mockReset();
  mocks.listOptions = [];
  mocks.contactLists = () => false;
  mocks.retry.mockResolvedValue(undefined);
  mocks.users = () => [
    userItem(sean),
    userItem(alias),
    userItem(seamus, new Date()),
  ];
});
afterEach(() => vi.useRealTimers());

it('ranks shared people identically in body and discussion mention searches', () => {
  createRoot((dispose) => {
    const [searchTerm, setSearchTerm] = createSignal('sea');
    const body = useUsersMention({ searchTerm });
    const discussion = useUsersMention({
      searchTerm,
      users: () => [sean, alias, seamus],
    });
    for (const term of ['sea', 'seam', 'seamus']) {
      setSearchTerm(term);
      expect(discussion.users().map((item) => item.id)).toEqual(
        body.users().map((item) => item.id)
      );
      expect(discussion.users()[0].id).toBe(seamus.id);
    }
    dispose();
  });
});

it('lists Macro, then you, then people, then the other agents while browsing', () => {
  createRoot((dispose) => {
    const scoped = useUsersMention({
      searchTerm: () => '',
      users: () => [reviewCodex, sean, macroAgent, viewer, seamus],
    });
    expect(scoped.users().map((item) => item.id)).toEqual([
      macroAgent.id,
      viewer.id,
      seamus.id,
      sean.id,
      reviewCodex.id,
    ]);
    // Channel composers keep @here on top. Phones pin the first two rows of
    // the same list above the blended results, as MentionsMenu does.
    const channel = useUsersMention({
      searchTerm: () => '',
      users: () => [reviewCodex, sean, macroAgent, viewer, seamus],
      isChannelBlock: true,
    });
    const pinned = (mention: typeof scoped) =>
      sortMobileMentions(
        mention.usersAndGroups(),
        '',
        mention.usersAndGroups(),
        true
      )
        .slice(0, 2)
        .map((item) => item.id);
    expect(pinned(scoped)).toEqual([macroAgent.id, viewer.id]);
    expect(pinned(channel)).toEqual(['here', macroAgent.id]);

    mocks.users = () => [
      { ...userItem(reviewCodex, new Date()), personOrder: 0 },
      { ...userItem(sean), personOrder: 1 },
      { ...userItem(seamus), personOrder: 2 },
      { ...userItem(viewer), personOrder: 3 },
    ];
    const directory = useUsersMention({
      searchTerm: () => '',
      transformUsers: (users) => [...users, macroAgent],
    });
    expect(directory.users().map((item) => item.id)).toEqual([
      macroAgent.id,
      viewer.id,
      sean.id,
      seamus.id,
      reviewCodex.id,
    ]);
    dispose();
  });
});

it('lists only the rows that lead the people until the directory first answers', () => {
  const [loading, setLoading] = createSignal(true);
  const [people, setPeople] = createSignal<UserItem[]>([]);
  const [open, setOpen] = createSignal(true);
  mocks.loading = loading;
  mocks.users = people;
  const [searchTerm, setSearchTerm] = createSignal('');
  const { directory, macroOnly, scoped, dispose } = createRoot((dispose) => ({
    directory: useUsersMention({
      searchTerm,
      enabled: open,
      transformUsers: (users) => [...users, reviewCodex, macroAgent],
    }),
    macroOnly: useUsersMention({
      searchTerm,
      enabled: open,
      transformUsers: (users) => [...users, macroAgent],
    }),
    scoped: useUsersMention({
      searchTerm,
      users: () => [reviewCodex, sean, macroAgent],
    }),
    dispose,
  }));
  const ids = () => directory.users().map((item) => item.id);

  // Codex will follow the people, who have not arrived: it waits rather
  // than take a row a person is about to take. Macro's People rows wait for
  // the people whether or not other agents do.
  expect(ids()).toEqual([macroAgent.id]);
  expect(directory.holdsRows()).toBe(true);
  expect(macroOnly.users().map((item) => item.id)).toEqual([macroAgent.id]);
  expect(macroOnly.holdsRows()).toBe(true);
  setSearchTerm('rev');
  expect(ids()).toEqual([]);
  expect(directory.holdsRows()).toBe(true);
  expect(macroOnly.holdsRows()).toBe(false);
  setSearchTerm('mac');
  expect(ids()).toEqual([macroAgent.id]);

  // A scoped roster is complete as given.
  setSearchTerm('');
  expect(scoped.users().map((item) => item.id)).toEqual([
    macroAgent.id,
    sean.id,
    reviewCodex.id,
  ]);
  expect(scoped.waitingForPeople()).toBe(false);

  setPeople([
    { ...userItem(sean), personOrder: 0 },
    { ...userItem(viewer), personOrder: 1 },
  ]);
  expect(ids()).toEqual([macroAgent.id, viewer.id, sean.id, reviewCodex.id]);
  expect(directory.waitingForPeople()).toBe(false);

  // Once the directory has answered, a term no one matches lists its agents
  // while the directory reads it.
  setPeople([]);
  setSearchTerm('rev');
  expect(ids()).toEqual([reviewCodex.id]);
  expect(directory.waitingForPeople()).toBe(false);

  // Reopening waits again, until other menus would stop saying the cache is
  // searching.
  setOpen(false);
  setOpen(true);
  setSearchTerm('');
  expect(ids()).toEqual([macroAgent.id]);
  vi.advanceTimersByTime(11_999);
  expect(ids()).toEqual([macroAgent.id]);
  vi.advanceTimersByTime(1);
  expect(ids()).toEqual([macroAgent.id, reviewCodex.id]);
  expect(directory.holdsRows()).toBe(false);

  // A directory that answers without anyone ends the wait too.
  setOpen(false);
  setOpen(true);
  expect(directory.waitingForPeople()).toBe(true);
  setLoading(false);
  expect(directory.waitingForPeople()).toBe(false);
  expect(ids()).toEqual([macroAgent.id, reviewCodex.id]);
  dispose();
});

it('never drops People without a word while its read is pending or restarts', async () => {
  const [people, setPeople] = createSignal<UserItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<unknown>();
  mocks.users = people;
  mocks.loading = loading;
  mocks.error = error;
  const { directory, dispose } = createRoot((dispose) => ({
    directory: useUsersMention({ searchTerm: () => '' }),
    dispose,
  }));

  // The held rows stay blank for as long as a healthy cache takes to answer.
  expect(directory.waitingForPeople()).toBe(true);
  expect(directory.showsLoading()).toBe(false);
  vi.advanceTimersByTime(499);
  expect(directory.showsLoading()).toBe(false);
  vi.advanceTimersByTime(1);
  expect(directory.showsLoading()).toBe(true);

  // A read still pending when the wait ends is reported like a failed one.
  expect(directory.peopleFailed()).toBe(false);
  vi.advanceTimersByTime(11_500);
  expect(directory.waitingForPeople()).toBe(false);
  expect(directory.peopleFailed()).toBe(true);

  // Retry waits for it again.
  await directory.retryPeople();
  expect(directory.waitingForPeople()).toBe(true);
  expect(directory.peopleFailed()).toBe(false);

  // A read that fails, and fails again when re-read, offers Retry.
  setError(new Error('cache reads unavailable after owner handoff timeout'));
  setLoading(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.retry).toHaveBeenCalledTimes(2);
  expect(directory.waitingForPeople()).toBe(false);
  expect(directory.peopleFailed()).toBe(true);

  // The cache changing owner restarts the read: the menu waits for it as it
  // does on opening, and keeps saying so if that read outlasts the wait too.
  batch(() => {
    setError(undefined);
    setLoading(true);
  });
  expect(directory.waitingForPeople()).toBe(true);
  expect(directory.peopleFailed()).toBe(false);
  vi.advanceTimersByTime(12_000);
  expect(directory.waitingForPeople()).toBe(false);
  expect(directory.peopleFailed()).toBe(true);

  setPeople([{ ...userItem(sean), personOrder: 0 }]);
  setLoading(false);
  expect(directory.peopleFailed()).toBe(false);
  expect(directory.users().map((item) => item.id)).toEqual([sean.id]);

  // A later read that fails twice says so as well, after people were listed.
  batch(() => {
    setPeople([]);
    setError(new Error('cache worker timeout: read'));
  });
  expect(directory.waitingForPeople()).toBe(false);
  expect(directory.peopleFailed()).toBe(true);
  dispose();
});

it('lists an agent only when it holds the typed words, never above a person who matches as well', () => {
  createRoot((dispose) => {
    const [searchTerm, setSearchTerm] = createSignal('eve');
    // Every row holds e…v…e in order; only Eve Hart has the word itself.
    mocks.users = () => [
      userItem(esteban, new Date()),
      userItem(eve, new Date('2026-09-15T12:00:00Z')),
    ];
    const scoped = useUsersMention({
      searchTerm,
      users: () => [reviewCodex, releaseCodex, esteban, eve],
    });
    expect(scoped.users().map((item) => item.data.name)).toEqual([
      'Eve Hart',
      'Esteban Valdez',
    ]);
    setSearchTerm('codex');
    expect(scoped.users().map((item) => item.data.name)).toEqual([
      'Review Desk Codex',
      'Release Verifier Codex',
    ]);

    // The directory's window is the server's match for the query.
    setSearchTerm('eve');
    mocks.users = () => [
      { ...userItem(eve), personOrder: 0 },
      { ...userItem(esteban, new Date()), personOrder: 1 },
      userItem(reviewCodex, new Date()),
      userItem(releaseCodex, new Date()),
    ];
    const directory = useUsersMention({ searchTerm });
    expect(directory.users().map((item) => item.data.name)).toEqual([
      'Eve Hart',
      'Esteban Valdez',
    ]);
    dispose();
  });
});

it('puts an agent ahead of only the people it matches better than', () => {
  createRoot((dispose) => {
    const reva: IUser = {
      id: 'macro|reva@example.com',
      name: 'Reva Lind',
      email: 'reva@example.com',
    };
    const drew: IUser = {
      id: 'macro|drew@example.com',
      name: 'Drew Evans',
      email: 'drevans@example.com',
    };
    const scoped = useUsersMention({
      searchTerm: () => 'rev',
      users: () => [drew, reviewCodex, reva],
    });
    expect(scoped.users().map((item) => item.id)).toEqual([
      reva.id,
      reviewCodex.id,
      drew.id,
    ]);
    dispose();
  });
});

it('keeps Macro first while its name starts with the query', () => {
  createRoot((dispose) => {
    const mackenzie: IUser = {
      id: 'macro|mackenzie@example.com',
      name: 'Mackenzie Hale',
      email: 'mackenzie@example.com',
    };
    const mac: IUser = {
      id: 'macro|mac@macro.com',
      name: 'Mac Ito',
      email: 'mac@macro.com',
    };
    const [searchTerm, setSearchTerm] = createSignal('');
    const people = [sean, mackenzie, viewer, mac];
    const scoped = useUsersMention({
      searchTerm,
      users: () => [reviewCodex, ...people, macroAgent],
    });
    const peopleOnly = useUsersMention({ searchTerm, users: () => people });
    mocks.users = () =>
      people.map((user, index) => ({
        ...userItem(user),
        personOrder: index,
      }));
    const directory = useUsersMention({
      searchTerm,
      transformUsers: (users) => [...users, macroAgent],
    });
    const ids = (mention: typeof scoped) =>
      mention.users().map((item) => item.id);

    // Mac Ito's first name is the query itself, a closer match than Macro's.
    for (const term of ['m', 'ma', 'mac', 'macr', 'macro']) {
      setSearchTerm(term);
      expect(ids(scoped)).toEqual([macroAgent.id, ...ids(peopleOnly)]);
      expect(ids(directory)[0]).toBe(macroAgent.id);
    }

    // Letters inside its name are an ordinary match, after the people who
    // match as well.
    setSearchTerm('cro');
    expect(ids(scoped)).toEqual([...ids(peopleOnly), macroAgent.id]);
    expect(ids(directory).at(-1)).toBe(macroAgent.id);
    dispose();
  });
});

it('keeps custom participant scope and display data when workspace data refreshes', () => {
  createRoot((dispose) => {
    const [workspace, setWorkspace] = createSignal<UserItem[]>([]);
    mocks.users = workspace;
    const customUser = {
      ...seamus,
      name: 'Custom Seamus',
      photoUrl: 'avatar.png',
    };
    const mention = useUsersMention({
      searchTerm: () => 'sea',
      users: () => [customUser],
    });
    expect(mention.users().map((item) => item.id)).toEqual([seamus.id]);
    setWorkspace([userItem(sean), userItem(seamus, new Date())]);
    expect(mention.users().map((item) => item.id)).toEqual([seamus.id]);
    expect(mention.users()[0].data).toBe(customUser);
    expect(mention.users()[0].timestamps.lastInteraction).toEqual(new Date());
    dispose();
  });
});

it('uses supplied interaction history for people absent from the workspace list', () => {
  mocks.users = () => [];
  createRoot((dispose) => {
    const mention = useUsersMention({
      searchTerm: () => 'sea',
      users: () => [sean, alias, { ...seamus, lastInteraction: new Date() }],
    });
    expect(mention.users()[0].id).toBe(seamus.id);
    dispose();
  });
});

it.each([undefined, new Date('2026-01-01')])(
  'ranks a first-name match before recent prefix, contains and subsequence matches with history %s',
  (lastInteraction) => {
    mocks.users = () => [];
    createRoot((dispose) => {
      const users: IUser[] = [
        {
          id: 'macro|alina@example.com',
          name: 'Alina Ellis',
          email: 'alina@example.com',
          lastInteraction: new Date(),
        },
        {
          id: 'macro|sam@example.com',
          name: 'Sam Alexson',
          email: 'sam@example.com',
          lastInteraction: new Date(),
        },
        {
          id: 'macro|alexandra@example.com',
          name: 'Alexandra Rowan',
          email: 'alexandra@example.com',
          lastInteraction: new Date(),
        },
        {
          id: 'macro|first@example.com',
          name: 'Alex First',
          email: 'first@example.com',
          lastInteraction: new Date(),
        },
        {
          id: 'macro|other@example.com',
          name: 'Alex Other',
          email: 'other@example.com',
          lastInteraction: new Date(),
        },
        {
          id: 'macro|alex@example.com',
          name: 'Alex Rowan',
          email: 'alex@example.com',
          lastInteraction,
        },
      ];
      const mention = useUsersMention({
        searchTerm: () => 'alex',
        users: () => users,
      });
      expect(mention.users().map((item) => item.id)).toEqual([
        'macro|first@example.com',
        'macro|other@example.com',
        'macro|alex@example.com',
        'macro|alexandra@example.com',
        'macro|sam@example.com',
        'macro|alina@example.com',
      ]);
      expect(
        sortMobileMentions(mention.users(), 'alex', mention.users()).map(
          (item) => item.id
        )
      ).toEqual([
        'macro|first@example.com',
        'macro|other@example.com',
        'macro|alex@example.com',
        'macro|alexandra@example.com',
        'macro|sam@example.com',
        'macro|alina@example.com',
      ]);
      dispose();
    });
  }
);

it('preserves explicitly empty participant lists', () => {
  createRoot((dispose) => {
    const mention = useUsersMention({ searchTerm: () => '', users: () => [] });
    expect(mention.users()).toEqual([]);
    dispose();
  });
});

it('decorates only the current window and never widens an empty or explicit roster', async () => {
  await createRoot(async (dispose) => {
    try {
      const person: IUser = {
        id: 'macro|person@example.com',
        name: 'Directory person',
        email: 'person@example.com',
      };
      const agent: IUser = {
        id: 'macro|agent@example.com',
        name: 'Available agent',
        email: 'agent@example.com',
      };
      const item = userItem(person, new Date('2026-01-01'));
      const [window, setWindow] = createSignal([item]);
      mocks.users = window;
      const [scope, setScope] = createSignal<IUser[] | undefined>(undefined);
      const mention = useUsersMention({
        searchTerm: () => '',
        users: scope,
        transformUsers: (users) => [...users, agent],
      });
      expect(new Set(mention.users().map((row) => row.id))).toEqual(
        new Set([person.id, agent.id])
      );
      expect(mention.users().find((row) => row.id === person.id)).toBe(item);
      expect(mention.hasMore()).toBe(true);
      await mention.loadMore();
      expect(mocks.loadMore).toHaveBeenCalledOnce();
      setWindow([
        userItem({
          id: 'macro|next@example.com',
          name: 'Next window',
          email: 'next@example.com',
        }),
      ]);
      expect(new Set(mention.users().map((row) => row.id))).toEqual(
        new Set(['macro|next@example.com', agent.id])
      );
      setScope([]);
      expect(mention.users().map((row) => row.id)).toEqual([agent.id]);
      expect(mention.hasMore()).toBe(false);
      expect(mention.windowKey()).toBeUndefined();
      await mention.loadMore();
      expect(mocks.loadMore).toHaveBeenCalledOnce();
      setScope([person]);
      expect(new Set(mention.users().map((row) => row.id))).toEqual(
        new Set([person.id, agent.id])
      );
      setScope(undefined);
      expect(new Set(mention.users().map((row) => row.id))).toEqual(
        new Set(['macro|next@example.com', agent.id])
      );
    } finally {
      dispose();
    }
  });
});

it('offers @here to channel composers without a block context', () => {
  createRoot((dispose) => {
    const [searchTerm, setSearchTerm] = createSignal('');
    const mention = useUsersMention({
      searchTerm,
      users: () => [sean],
      isChannelBlock: true,
    });
    expect(mention.groups().map((item) => item.id)).toEqual(['here']);
    expect(mention.usersAndGroups().map((item) => item.id)).toEqual([
      'here',
      sean.id,
    ]);
    setSearchTerm('he');
    expect(mention.groups().map((item) => item.id)).toEqual(['here']);
    setSearchTerm('sea');
    expect(mention.groups()).toEqual([]);
    dispose();
  });
});

it('keeps @here out of composers that do not post to a channel', () => {
  createRoot((dispose) => {
    const mention = useUsersMention({
      searchTerm: () => '',
      users: () => [sean],
    });
    expect(mention.groups()).toEqual([]);
    expect(mention.usersAndGroups().map((item) => item.id)).toEqual([sean.id]);
    dispose();
  });
});

it('lists people before @here for a partial alias and @here first once it is typed in full', () => {
  createRoot((dispose) => {
    const helen: IUser = {
      id: 'macro|helen@macro.com',
      name: 'Helen Park',
      email: 'helen@macro.com',
    };
    const [searchTerm, setSearchTerm] = createSignal('he');
    const mention = useUsersMention({
      searchTerm,
      users: () => [helen, sean],
      isChannelBlock: true,
    });
    expect(mention.usersAndGroups().map((item) => item.id)).toEqual([
      helen.id,
      'here',
    ]);
    setSearchTerm('here');
    expect(mention.usersAndGroups()[0].id).toBe('here');
    dispose();
  });
});

it('orders the personal mention window by contact list only while enable-contact-lists is on', () => {
  createRoot((dispose) => {
    const [enabled, setEnabled] = createSignal(false);
    mocks.contactLists = enabled;
    useUsersMention({ searchTerm: () => '' });
    const options = mocks.listOptions.at(-1);
    expect(options?.peopleMode).toBe('mention');
    expect(options?.peopleListPriority?.()).toBeUndefined();
    setEnabled(true);
    expect(options?.peopleListPriority?.()).toEqual([
      ['teammates'],
      ['interacted', 'invited'],
      ['gmail', 'outlook', 'imap'],
    ]);
    expect(options?.peopleListPriority?.()).toBe(MENTION_LIST_PRIORITY);
    dispose();
  });
});
