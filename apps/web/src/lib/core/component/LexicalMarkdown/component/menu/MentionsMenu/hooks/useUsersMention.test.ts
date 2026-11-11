import type { UserItem } from '@core/context/quickAccess';
import type { QuickAccessListOptions } from '@core/context/quickAccess/types';
import type { IUser } from '@core/user';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
