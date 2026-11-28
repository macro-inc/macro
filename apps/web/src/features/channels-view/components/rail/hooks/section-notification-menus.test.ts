import type { ChannelEntity } from '@entity';
import type { ChannelIdWindow } from '@queries/channel/window';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Conflict = { id: string; name: string };

const mocks = vi.hoisted(() => ({
  ownSettings: [] as { channelId: string; enabled: string[] }[],
  conflictDialogs: [] as { channels: readonly Conflict[] }[],
  sectionWrites: [] as unknown[],
  failures: [] as string[],
  window: undefined as (() => ChannelIdWindow) | undefined,
  session: undefined as (() => number) | undefined,
  setSession: (_session: number) => {},
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: (message: string) => mocks.failures.push(message) },
}));
vi.mock('@notifications/SectionConflictDialog', () => ({
  openSectionConflict: (props: { channels: readonly Conflict[] }) =>
    mocks.conflictDialogs.push(props),
}));
vi.mock('@notifications/SnoozeNotificationsDialog', () => ({
  openSectionSnooze: () => {},
}));
vi.mock('@queries/auth/account-scope', async () => {
  const { createSignal } = await import('solid-js');
  const [session, setSession] = createSignal(1);
  mocks.session = session;
  mocks.setSession = setSession;
  return { queryAccountSession: () => session() };
});
vi.mock('@queries/channel/window', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/channel/window')>()),
  useChannelWindow: (window: () => ChannelIdWindow) => {
    mocks.window = window;
    return { channels: () => [], retained: () => [] };
  },
}));
vi.mock('@queries/channel-labels/channel-labels', () => ({
  useChannelLabelsQuery: () => ({ data: undefined }),
}));
vi.mock('@queries/favorites/favorites', () => ({
  useFavoritesData: () => () => undefined,
}));
vi.mock('@queries/gate', () => ({ queryReadyGate: () => true }));
vi.mock('@queries/notification/notification-settings', () => ({
  useChannelNotificationSettingsQuery: () => ({
    get data() {
      return mocks.ownSettings;
    },
  }),
  useSectionNotificationSettingsQuery: () => ({ data: [] }),
  useChannelNotificationSettingsMutation: () => ({
    isPending: false,
    mutateAsync: async () => {},
  }),
  useSectionNotificationSettingsMutation: () => ({
    isPending: false,
    mutateAsync: async (change: unknown) => {
      mocks.sectionWrites.push(change);
    },
  }),
}));
vi.mock('@queries/notification/unsubscribes', () => ({
  useMutedEntitiesQuery: () => ({ data: [] }),
}));

import { CHANNEL_NOTIFICATION_KINDS } from '@notifications/core/channel-notification-settings';
import { createChannelNotificationSettings } from '@notifications/primitives/create-channel-notification-settings';
import { sectionNotificationMenus } from './section-notification-menus';

type Joined = { id: string; name: string | null; channelType: string };

const ids = Array.from({ length: 300 }, (_, index) => `own-${index}`);
const joined: Joined[] = ids.map((id) => ({
  id,
  name: `Channel ${id}`,
  channelType: 'team',
}));

let dispose = () => {};

/**
 * Section menus over channels that all have their own settings and none of
 * whose records the host holds, as before the directory has filled.
 */
function setup(
  readJoinedChannels: (signal: AbortSignal) => Promise<readonly Joined[]>,
  labels: { id: string; name: string; channelIds: string[] }[] = []
) {
  return createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const settings = createChannelNotificationSettings({
      labels: () => labels,
      favoriteChannelIds: () => new Set(),
      resolveConflictChannels: true,
      channelById: (): ChannelEntity | undefined => undefined,
      readJoinedChannels,
    });
    return { settings, menus: sectionNotificationMenus(settings) };
  });
}

/** Let every read and write started so far settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mocks.ownSettings = ids.map((channelId) => ({
    channelId,
    enabled: ['channel_mention'],
  }));
  mocks.conflictDialogs = [];
  mocks.sectionWrites = [];
  mocks.failures = [];
  mocks.setSession(1);
});
afterEach(() => dispose());

describe('section notification conflicts', () => {
  it('looks up only a window of the channels with their own settings', () => {
    setup(async () => joined);
    expect(mocks.window!().size).toBe(200);
  });

  it("reads the joined channels for the team section's types before asking", async () => {
    const read = vi.fn(async () => joined);
    const { settings, menus } = setup(read);
    menus('team_channels', 'Team')!.settings.onPreset('all');
    expect(settings.pending()).toBe(true);
    await settle();

    expect(read).toHaveBeenCalledOnce();
    expect(settings.pending()).toBe(false);
    expect(mocks.sectionWrites).toEqual([]);
    expect(mocks.conflictDialogs).toHaveLength(1);
    expect(mocks.conflictDialogs[0].channels).toHaveLength(300);
    expect(mocks.conflictDialogs[0].channels.at(-1)).toEqual({
      id: 'own-299',
      name: 'Channel own-299',
    });
  });

  it('saves a team section change when no joined channel conflicts', async () => {
    const read = vi.fn(async () =>
      joined.map((channel) => ({ ...channel, channelType: 'direct_message' }))
    );
    const { menus } = setup(read);
    menus('team_channels', 'Team')!.settings.onPreset('all');
    await settle();

    expect(read).toHaveBeenCalledOnce();
    expect(mocks.conflictDialogs).toEqual([]);
    expect(mocks.sectionWrites).toHaveLength(1);
  });

  it('reads nothing when no channel’s own settings resist the change', async () => {
    mocks.ownSettings = ids.map((channelId) => ({
      channelId,
      enabled: [...CHANNEL_NOTIFICATION_KINDS],
    }));
    const read = vi.fn(async () => joined);
    const { menus } = setup(read);
    menus('team_channels', 'Team')!.settings.onPreset('all');
    await settle();

    expect(read).not.toHaveBeenCalled();
    expect(mocks.conflictDialogs).toEqual([]);
    expect(mocks.sectionWrites).toHaveLength(1);
  });

  it('reads nothing for a section that holds its channels by id', async () => {
    const read = vi.fn(async () => joined);
    const { menus } = setup(read, [
      { id: 'section', name: 'Section', channelIds: ['own-7'] },
    ]);
    menus('label:section', 'Section')!.settings.onPreset('all');
    await settle();

    expect(read).not.toHaveBeenCalled();
    expect(mocks.conflictDialogs[0].channels).toEqual([
      { id: 'own-7', name: 'the channel' },
    ]);
  });

  it('reports a failed read and saves nothing', async () => {
    const { settings, menus } = setup(async () => {
      throw new Error('offline');
    });
    menus('team_channels', 'Team')!.settings.onPreset('all');
    await settle();

    expect(mocks.failures).toEqual(['Failed to update notification settings']);
    expect(mocks.conflictDialogs).toEqual([]);
    expect(mocks.sectionWrites).toEqual([]);
    expect(settings.pending()).toBe(false);
  });

  it.each([
    ['the viewer signs in again', () => mocks.setSession(2)],
    ['the rail goes', () => dispose()],
  ])('ends the read and saves nothing when %s', async (_, interrupt) => {
    const [signal, setSignal] = createSignal<AbortSignal>();
    const { menus } = setup(
      (abort) =>
        new Promise((_, reject) => {
          setSignal(abort);
          abort.addEventListener('abort', () => reject(abort.reason));
        })
    );
    menus('team_channels', 'Team')!.settings.onPreset('all');
    await settle();
    expect(signal()?.aborted).toBe(false);

    interrupt();
    await settle();

    expect(signal()?.aborted).toBe(true);
    expect(mocks.failures).toEqual([]);
    expect(mocks.conflictDialogs).toEqual([]);
    expect(mocks.sectionWrites).toEqual([]);
  });
});
