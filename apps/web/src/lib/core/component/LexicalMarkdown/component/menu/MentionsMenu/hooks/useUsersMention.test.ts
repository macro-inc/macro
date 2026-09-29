import type { UserItem } from '@core/context/quickAccess';
import type { IUser } from '@core/user';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useUsersMention } from './useUsersMention';

const mocks = vi.hoisted(() => ({
  users: (): UserItem[] => [],
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({ useList: () => ({ items: () => mocks.users() }) }),
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
