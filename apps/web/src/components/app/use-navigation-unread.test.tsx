import type { InboxUnreadCount } from '@app/features/notifications-inbox/core/inbox-unread';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNavigationUnread } from './use-navigation-unread';

type Flag = { enabled: boolean; loading: boolean; payload: undefined };

const mocks = vi.hoisted(() => ({
  unified: undefined as unknown as () => Flag,
  passwords: undefined as unknown as () => Flag,
  numbersEnabled: true,
  counts: undefined as unknown as () => readonly InboxUnreadCount[] | undefined,
  countStreams: 0,
  presenceSources: 0,
  presence: ((_id: string) => false) as (id: string) => boolean,
}));

vi.mock('@core/constant/featureFlags', () => ({
  enableNavigationUnreadCounts: 'navigation-unread-counts',
  enableUnifiedNotifications: 'unified',
  enablePasswords: 'passwords',
  isFeatureEnabled: (flag: string) =>
    flag === 'navigation-unread-counts' && mocks.numbersEnabled,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: string) =>
    flag === 'unified' ? mocks.unified : mocks.passwords,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
  subscribeGraphqlSoupReconnected: () => () => {},
}));
vi.mock('@app/features/notifications-inbox/queries/inbox-unread', () => ({
  createInboxUnread: () => {
    mocks.countStreams += 1;
    return () => mocks.counts();
  },
}));
vi.mock('./use-presence-unread', () => ({
  usePresenceUnread: () => {
    mocks.presenceSources += 1;
    return (id: string) => mocks.presence(id);
  },
}));

const flag = (enabled: boolean, loading = false): Flag => ({
  enabled,
  loading,
  payload: undefined,
});

let dispose: VoidFunction;
afterEach(() => {
  dispose?.();
  mocks.countStreams = 0;
  mocks.presenceSources = 0;
  mocks.presence = () => false;
});

function setup(options: {
  unified: Flag;
  passwords?: boolean;
  numbersEnabled?: boolean;
  counts?: readonly InboxUnreadCount[];
  homeIsNotifications?: boolean;
}) {
  return createRoot((disposer) => {
    dispose = disposer;
    const [unified, setUnified] = createSignal(options.unified);
    const [counts, setCounts] = createSignal(options.counts);
    mocks.unified = unified;
    mocks.passwords = () => flag(options.passwords ?? false);
    mocks.numbersEnabled = options.numbersEnabled ?? true;
    mocks.counts = counts;
    return {
      unread: useNavigationUnread({
        homeIsNotifications: options.homeIsNotifications,
      }),
      setUnified,
      setCounts,
    };
  });
}

const row = (
  type: InboxUnreadCount['type'],
  count: number,
  passwordRequests = false
): InboxUnreadCount => ({ type, passwordRequests, count });

const channelRow = (
  type: 'channel_mention' | 'channel_messages' | 'channel_thread',
  counts: { count: number; chatCount: number }
): InboxUnreadCount => ({ type, passwordRequests: false, ...counts });

describe('useNavigationUnread with the unified Notifications view', () => {
  it.each([false, true])(
    'keeps live dots with numbers off (Home is Notifications: %s)',
    (homeIsNotifications) => {
      const { unread, setCounts } = setup({
        unified: flag(true),
        numbersEnabled: false,
        counts: [row('email', 4), row('channel_mention', 1)],
        homeIsNotifications,
      });

      for (const section of ['home', 'notifications', 'channels', 'mail']) {
        expect(unread.has(section)).toBe(true);
        expect(unread.count(section)).toBeUndefined();
      }
      expect(mocks.countStreams).toBe(1);
      expect(mocks.presenceSources).toBe(0);

      setCounts([]);
      expect(unread.has('home')).toBe(false);
      expect(unread.has('mail')).toBe(false);
    }
  );

  it('counts each section from its kinds of inbox row', () => {
    const { unread } = setup({
      unified: flag(true),
      counts: [
        row('email', 4),
        channelRow('channel_mention', { count: 1, chatCount: 1 }),
        channelRow('channel_messages', { count: 2, chatCount: 2 }),
        channelRow('channel_thread', { count: 3, chatCount: 1 }),
        row('task', 5),
        row('other', 1),
      ],
    });

    expect(unread.count('notifications')).toBe(16);
    expect(unread.count('channels')).toBe(4);
    expect(unread.count('mail')).toBe(4);
    expect(unread.has('channels')).toBe(true);
    // Home shares the inbox's dot without repeating its number.
    expect(unread.has('home')).toBe(true);
    expect(unread.count('home')).toBeUndefined();
    // Sections with no rows of their own show nothing.
    expect(unread.has('documents')).toBe(false);
    expect(unread.count('documents')).toBeUndefined();
    expect(mocks.presenceSources).toBe(0);
  });

  it('leaves Chat dark for a thread reply, which its sidebar does not show', () => {
    const { unread, setCounts } = setup({
      unified: flag(true),
      counts: [channelRow('channel_thread', { count: 1, chatCount: 0 })],
    });

    expect(unread.has('channels')).toBe(false);
    expect(unread.count('channels')).toBe(0);
    expect(unread.has('home')).toBe(true);
    expect(unread.has('notifications')).toBe(true);
    expect(unread.count('notifications')).toBe(1);

    // A reply in the thread mentions the viewer.
    setCounts([channelRow('channel_thread', { count: 1, chatCount: 1 })]);
    expect(unread.has('channels')).toBe(true);

    // The viewer reads the mention; a reaction to their message is left.
    setCounts([channelRow('channel_messages', { count: 1, chatCount: 0 })]);
    expect(unread.has('channels')).toBe(false);
    expect(unread.has('notifications')).toBe(true);
  });

  it.each(['channel_messages', 'channel_mention', 'channel_thread'] as const)(
    'lights Chat for a %s row its sidebar shows',
    (type) => {
      const { unread } = setup({
        unified: flag(true),
        counts: [channelRow(type, { count: 1, chatCount: 1 })],
      });
      expect(unread.has('channels')).toBe(true);
      expect(unread.count('channels')).toBe(1);
    }
  );

  it('counts every channel row in Chat from a server that does not tell them apart', () => {
    const { unread } = setup({
      unified: flag(true),
      counts: [row('channel_thread', 2), row('email', 1)],
    });
    expect(unread.has('channels')).toBe(true);
    expect(unread.count('channels')).toBe(2);
    expect(unread.has('home')).toBe(true);
    expect(unread.has('mail')).toBe(true);
  });

  it('puts the number on Home where Home stands in for Notifications', () => {
    const { unread } = setup({
      unified: flag(true),
      counts: [row('email', 4), row('task', 1)],
      homeIsNotifications: true,
    });

    expect(unread.count('home')).toBe(5);
    expect(unread.has('home')).toBe(true);
  });

  it('follows the counts as they change, section by section', () => {
    const { unread, setCounts } = setup({
      unified: flag(true),
      counts: [row('email', 1), row('channel_thread', 1)],
    });
    expect(unread.count('notifications')).toBe(2);

    // The viewer reads the channel thread: only mail is left.
    setCounts([row('email', 1)]);
    expect(unread.count('channels')).toBe(0);
    expect(unread.has('channels')).toBe(false);
    expect(unread.count('mail')).toBe(1);
    expect(unread.count('notifications')).toBe(1);

    setCounts([]);
    expect(unread.has('mail')).toBe(false);
    expect(unread.has('notifications')).toBe(false);
    expect(unread.has('home')).toBe(false);
  });

  it('shows nothing until the first counts arrive', () => {
    const { unread } = setup({ unified: flag(true), counts: undefined });

    expect(unread.has('notifications')).toBe(false);
    expect(unread.count('notifications')).toBe(0);
  });

  it('counts vault access requests only where the inbox lists them', () => {
    const counts = [row('access_requested', 2, true), row('task', 1)];

    expect(
      setup({ unified: flag(true), counts }).unread.count('notifications')
    ).toBe(1);
    dispose();
    expect(
      setup({ unified: flag(true), passwords: true, counts }).unread.count(
        'notifications'
      )
    ).toBe(3);
  });
});

describe('useNavigationUnread without the unified Notifications view', () => {
  it('keeps the presence dots and shows no numbers', () => {
    mocks.presence = (id) => id === 'mail';
    const { unread } = setup({ unified: flag(false) });

    expect(unread.has('mail')).toBe(true);
    expect(unread.has('channels')).toBe(false);
    expect(unread.count('mail')).toBeUndefined();
    expect(mocks.countStreams).toBe(0);
  });

  it('starts neither source while the flag is undecided, then exactly one', () => {
    mocks.presence = () => true;
    const { unread, setUnified } = setup({
      unified: flag(false, true),
      counts: [row('email', 2)],
    });
    expect(unread.has('mail')).toBe(false);
    expect(mocks.countStreams + mocks.presenceSources).toBe(0);

    setUnified(flag(true));
    expect(unread.count('mail')).toBe(2);
    expect(mocks.countStreams).toBe(1);
    expect(mocks.presenceSources).toBe(0);

    // The same decision delivered again starts nothing new.
    setUnified(flag(true));
    expect(mocks.countStreams).toBe(1);
  });
});
