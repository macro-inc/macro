/** @vitest-environment jsdom */
import { ChannelDirectoryProvider } from '@core/context/channels';
import {
  type ChannelDirectory,
  channelDirectoryState,
  lookupChannel,
} from '@queries/channel/directory';
import type { DirectoryChannel } from '@queries/channel/directory-core';
import { channelUuid } from '@queries/channel/tests/channel-uuid';
import {
  directoryChannel,
  directoryParticipant,
} from '@queries/channel/tests/directory-channel';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  heroIds: [] as (readonly string[])[],
  confirm: vi.fn(async (options: () => { mobileHero?: unknown }) => {
    // Building the drawer's options renders its hero, as the drawer does.
    options();
    return false;
  }),
}));

vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@channel/Channel/ChannelTabContext', () => ({
  useChannelTab: () => ({ setActiveTab: vi.fn() }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'viewer',
  useIsAuthenticated: () => () => true,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@queries/call/call', () => ({
  useActiveCallQuery: () => ({ data: undefined }),
}));
vi.mock('@ui', () => ({ confirmDialog: mocks.confirm }));
vi.mock('../CallParticipantAvatars', () => ({
  CallParticipantAvatars: (props: { ids: readonly string[] }) => {
    mocks.heroIds.push(props.ids);
    return null;
  },
}));
vi.mock('../use-call', () => ({
  useCall: () => ({
    isJoining: () => false,
    isInThisChannel: () => false,
    joinCall: vi.fn(),
    startCall: vi.fn(),
  }),
}));

import { useStartChannelCall } from '../use-start-channel-call';

afterEach(() => {
  cleanup();
  mocks.heroIds.length = 0;
  mocks.confirm.mockClear();
});

function directoryOf(channels: readonly DirectoryChannel[]): ChannelDirectory {
  const state = channelDirectoryState(channels, [], true);
  return {
    channels: () => state.joined,
    complete: () => true,
    lookup: (channelId) => lookupChannel(state, {}, channelId),
    readComplete: async () => state.joined,
    failed: () => false,
    retry: () => {},
    recordView: () => {},
    viewsCurrent: () => true,
  };
}

async function startFromPhone(channel: DirectoryChannel) {
  let start!: () => Promise<void>;
  function Starter() {
    start = useStartChannelCall(() => channel.id).start;
    return null;
  }
  render(() => (
    <ChannelDirectoryProvider directory={directoryOf([channel])}>
      <Starter />
    </ChannelDirectoryProvider>
  ));
  await start();
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  return mocks.heroIds.at(-1);
}

// The REST list counted bots among a channel's participants, so the drawer
// that confirms a call on a phone showed them; the directory keeps bots
// apart, and the hook adds them back after the people.
it('shows the viewer first, then the people, then the bots it will ring', async () => {
  const ids = await startFromPhone(
    directoryChannel(channelUuid('with-bot'), {
      participants: [
        directoryParticipant('peer'),
        directoryParticipant('viewer'),
      ],
      botParticipants: [
        {
          botId: 'bot-1',
          role: 'member',
          joinedAt: '2026-11-01T00:00:00+00:00',
          leftAt: null,
        },
      ],
    })
  );
  expect(ids).toEqual(['viewer', 'peer', 'bot|bot-1']);
});

it('shows a DM with an agent as the viewer and the agent', async () => {
  const ids = await startFromPhone(
    directoryChannel(channelUuid('agent-dm'), {
      channelType: 'direct_message',
      participants: [directoryParticipant('viewer')],
      botParticipants: [
        {
          botId: 'agent-bot',
          role: 'member',
          joinedAt: '2026-11-01T00:00:00+00:00',
          leftAt: null,
        },
      ],
    })
  );
  expect(ids).toEqual(['viewer', 'bot|agent-bot']);
});
