import type { UserItem } from '@core/context/quickAccess';
import type { QuickAccessListOptions } from '@core/context/quickAccess/types';
import type { IUser } from '@core/user';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sortMobileMentions } from '../utils/mobileSort';
import { useUsersMention } from './useUsersMention';

const mocks = vi.hoisted(() => ({
  users: (): UserItem[] => [],
  loadMore: vi.fn<() => Promise<void>>(),
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: (options: QuickAccessListOptions) => ({
      items: () => (options.enabled?.() === false ? [] : mocks.users()),
      windowKey: () => 'window',
      hasMore: () => true,
      isLoading: () => false,
      isLoadingMore: () => false,
      loadMore: mocks.loadMore,
    }),
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

it('lists you, then people, then Macro and the other agents while browsing', () => {
  createRoot((dispose) => {
    const scoped = useUsersMention({
      searchTerm: () => '',
      users: () => [reviewCodex, sean, macroAgent, viewer, seamus],
    });
    expect(scoped.users().map((item) => item.id)).toEqual([
      viewer.id,
      seamus.id,
      sean.id,
      macroAgent.id,
      reviewCodex.id,
    ]);

    mocks.users = () => [
      { ...userItem(reviewCodex, new Date()), personOrder: 0 },
      { ...userItem(sean), personOrder: 1 },
      { ...userItem(seamus), personOrder: 2 },
      { ...userItem(viewer), personOrder: 3 },
      userItem(macroAgent),
    ];
    const directory = useUsersMention({ searchTerm: () => '' });
    expect(directory.users().map((item) => item.id)).toEqual([
      viewer.id,
      sean.id,
      seamus.id,
      macroAgent.id,
      reviewCodex.id,
    ]);
    dispose();
  });
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
    const mackenzie: IUser = {
      id: 'macro|mackenzie@example.com',
      name: 'Mackenzie Hale',
      email: 'mackenzie@example.com',
    };
    const scoped = useUsersMention({
      searchTerm: () => 'mac',
      users: () => [sean, macroAgent, mackenzie],
    });
    expect(scoped.users().map((item) => item.id)).toEqual([
      mackenzie.id,
      macroAgent.id,
      sean.id,
    ]);
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
