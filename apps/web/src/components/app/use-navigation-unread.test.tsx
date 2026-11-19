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
  mail: (() => 0) as () => number,
  channels: (() => 0) as () => number,
  countStreams: 0,
  viewSources: 0,
  presenceSources: 0,
  presence: ((_id: string) => false) as (id: string) => boolean,
  mailExact: undefined as boolean | undefined,
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
vi.mock('./view-unread', () => ({
  createMailUnread: (options: { exact: boolean }) => {
    mocks.viewSources += 1;
    mocks.mailExact = options.exact;
    return () => mocks.mail();
  },
  createChannelsUnread: () => {
    mocks.viewSources += 1;
    return () => mocks.channels();
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
  mocks.viewSources = 0;
  mocks.presenceSources = 0;
  mocks.presence = () => false;
  mocks.mailExact = undefined;
});

function setup(options: {
  unified: Flag;
  passwords?: boolean;
  numbersEnabled?: boolean;
  counts?: readonly InboxUnreadCount[];
  mail?: number;
  channels?: number;
  homeIsNotifications?: boolean;
}) {
  return createRoot((disposer) => {
    dispose = disposer;
    const [unified, setUnified] = createSignal(options.unified);
    const [counts, setCounts] = createSignal(options.counts);
    const [mail, setMail] = createSignal(options.mail ?? 0);
    const [channels, setChannels] = createSignal(options.channels ?? 0);
    mocks.unified = unified;
    mocks.passwords = () => flag(options.passwords ?? false);
    mocks.numbersEnabled = options.numbersEnabled ?? true;
    mocks.counts = counts;
    mocks.mail = mail;
    mocks.channels = channels;
    return {
      unread: useNavigationUnread({
        homeIsNotifications: options.homeIsNotifications,
      }),
      setUnified,
      setCounts,
      setMail,
      setChannels,
    };
  });
}

const row = (
  type: InboxUnreadCount['type'],
  count: number,
  passwordRequests = false
): InboxUnreadCount => ({ type, passwordRequests, count });

describe('useNavigationUnread with the unified Notifications view', () => {
  it.each([false, true])(
    'keeps live dots from the inbox rows with numbers off, running no view query (Home is Notifications: %s)',
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
      expect(mocks.viewSources).toBe(0);
      expect(mocks.presenceSources).toBe(0);

      setCounts([row('email', 1)]);
      expect(unread.has('mail')).toBe(true);
      expect(unread.has('channels')).toBe(false);
      setCounts([]);
      for (const section of ['home', 'notifications', 'channels', 'mail']) {
        expect(unread.has(section)).toBe(false);
      }
    }
  );

  it("counts Mail and Channels by their own views, not the inbox's rows", () => {
    const { unread } = setup({
      unified: flag(true),
      // Mail with no notification, and three unread threads of one
      // conversation: the inbox's rows say otherwise.
      counts: [
        row('email', 4),
        row('channel_mention', 1),
        row('channel_messages', 2),
        row('channel_thread', 3),
        row('task', 5),
        row('other', 1),
      ],
      mail: 7,
      channels: 2,
    });

    expect(unread.count('notifications')).toBe(16);
    expect(unread.count('mail')).toBe(7);
    expect(unread.count('channels')).toBe(2);
    expect(mocks.mailExact).toBe(true);
    // Home shares the inbox's dot without repeating its number.
    expect(unread.has('home')).toBe(true);
    expect(unread.count('home')).toBeUndefined();
    // Sections with no unread source show nothing.
    expect(unread.has('documents')).toBe(false);
    expect(unread.count('documents')).toBeUndefined();
    expect(mocks.viewSources).toBe(2);
    expect(mocks.presenceSources).toBe(0);
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

  it('follows each source as it changes', () => {
    const { unread, setCounts, setMail, setChannels } = setup({
      unified: flag(true),
      counts: [row('email', 1), row('channel_thread', 1)],
      mail: 1,
      channels: 1,
    });
    expect(unread.count('notifications')).toBe(2);

    // The viewer reads the conversation: Channels clears, mail is left.
    setChannels(0);
    setCounts([row('email', 1)]);
    expect(unread.count('channels')).toBe(0);
    expect(unread.has('channels')).toBe(false);
    expect(unread.count('mail')).toBe(1);
    expect(unread.count('notifications')).toBe(1);

    setMail(0);
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

  it('starts neither mode while the flag is undecided, then exactly one', () => {
    mocks.presence = () => true;
    const { unread, setUnified } = setup({
      unified: flag(false, true),
      counts: [row('email', 2)],
      mail: 3,
    });
    expect(unread.has('mail')).toBe(false);
    expect(mocks.countStreams + mocks.viewSources + mocks.presenceSources).toBe(
      0
    );

    setUnified(flag(true));
    expect(unread.count('mail')).toBe(3);
    expect(mocks.countStreams).toBe(1);
    expect(mocks.presenceSources).toBe(0);

    // The same decision delivered again starts nothing new.
    setUnified(flag(true));
    expect(mocks.countStreams).toBe(1);
    expect(mocks.viewSources).toBe(2);
  });
});
