/**
 * @vitest-environment jsdom
 */

import { dmWorkAccount } from '@app/features/agent-work/core/work-visibility';
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
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const viewer = vi.hoisted(() => ({ id: 'viewer' as string | undefined }));
vi.mock('./user', () => ({
  useUserId: () => () => viewer.id,
  useIsAuthenticated: () => () => true,
}));

import {
  ChannelDirectoryProvider,
  channelMemberIds,
  directMessagePeer,
  useChannel,
  useChannelCanCall,
  useDmActivityByUserId,
} from './channels';

afterEach(() => {
  cleanup();
  viewer.id = 'viewer';
});

/** A directory that fills when the test says so. */
function fillingDirectory() {
  const [channels, setChannels] = createSignal<readonly DirectoryChannel[]>([]);
  const [complete, setComplete] = createSignal(false);
  const state = () => channelDirectoryState(channels(), [], complete());
  const directory: ChannelDirectory = {
    channels: () => state().joined,
    complete,
    lookup: (channelId) => lookupChannel(state(), {}, channelId),
    readComplete: async () => state().joined,
    failed: () => false,
    retry: () => {},
    recordView: () => {},
  };
  return {
    directory,
    fill(next: readonly DirectoryChannel[]) {
      setChannels(next);
      setComplete(true);
    },
    setChannels,
  };
}

function CanCall(props: { channelId: string }) {
  const canCall = useChannelCanCall(props.channelId);
  return <output>{String(canCall())}</output>;
}

function setupCanCall(channelId: string) {
  const filling = fillingDirectory();
  const view = render(() => (
    <ChannelDirectoryProvider directory={filling.directory}>
      <CanCall channelId={channelId} />
    </ChannelDirectoryProvider>
  ));
  return { ...filling, value: () => view.getByRole('status').textContent };
}

describe('useChannelCanCall', () => {
  it('waits for the directory, then refuses an agent DM', () => {
    const { fill, value } = setupCanCall(channelUuid('dm'));
    expect(value()).toBe('undefined');
    fill([
      directoryChannel(channelUuid('dm'), {
        channelType: 'direct_message',
        agentDm: { botId: 'bot', name: 'Agent', avatarUrl: null },
      }),
    ]);
    expect(value()).toBe('false');
  });

  it('allows a joined channel that is not an agent DM', () => {
    const { fill, value } = setupCanCall(channelUuid('team'));
    fill([directoryChannel(channelUuid('team'), { channelType: 'team' })]);
    expect(value()).toBe('true');
  });

  it('allows a channel the complete directory does not have', () => {
    const { fill, value } = setupCanCall(channelUuid('public'));
    fill([directoryChannel(channelUuid('other'))]);
    expect(value()).toBe('true');
  });

  it('answers for a channel a partial directory already holds', () => {
    const { setChannels, value } = setupCanCall(channelUuid('team'));
    setChannels([directoryChannel(channelUuid('team'))]);
    expect(value()).toBe('true');
  });
});

describe('useChannel', () => {
  it('follows a channel as the directory changes it, and drops one the viewer left', () => {
    const filling = fillingDirectory();
    let channel!: () => DirectoryChannel | undefined;
    render(() => (
      <ChannelDirectoryProvider directory={filling.directory}>
        {(() => {
          channel = useChannel('first');
          return null;
        })()}
      </ChannelDirectoryProvider>
    ));
    expect(channel()).toBeUndefined();
    filling.fill([directoryChannel('first', { name: 'First' })]);
    expect(channel()?.name).toBe('First');
    filling.fill([directoryChannel('first', { name: 'Renamed' })]);
    expect(channel()?.name).toBe('Renamed');
    filling.fill([directoryChannel('first', { isParticipant: false })]);
    expect(channel()).toBeUndefined();
  });
});

describe('direct message peers', () => {
  const dm = (id: string, userIds: string[], updatedAt: string) =>
    directoryChannel(id, {
      channelType: 'direct_message',
      updatedAt,
      participants: userIds.map((userId) => directoryParticipant(userId)),
    });

  it('names the other person, else the bot', () => {
    expect(directMessagePeer(dm('a', ['viewer', 'peer'], ''), 'viewer')).toBe(
      'peer'
    );
    expect(
      directMessagePeer(
        directoryChannel('agent', {
          channelType: 'direct_message',
          participants: [directoryParticipant('viewer')],
          botParticipants: [
            {
              botId: 'bot-1',
              role: 'member',
              joinedAt: '2026-11-01T00:00:00+00:00',
              leftAt: null,
            },
          ],
        }),
        'viewer'
      )
    ).toBe('bot|bot-1');
  });

  it('dates each peer by their DM and skips other channels', () => {
    const filling = fillingDirectory();
    let activity!: ReturnType<typeof useDmActivityByUserId>;
    render(() => (
      <ChannelDirectoryProvider directory={filling.directory}>
        {(() => {
          activity = useDmActivityByUserId();
          return null;
        })()}
      </ChannelDirectoryProvider>
    ));
    filling.fill([
      dm('a', ['viewer', 'peer'], '2026-11-02T00:00:00+00:00'),
      directoryChannel('group', { updatedAt: '2026-11-03T00:00:00+00:00' }),
    ]);
    expect([...activity()]).toEqual([['peer', '2026-11-02T00:00:00+00:00']]);
  });
});

describe('channelMemberIds', () => {
  const bot = (botId: string) => ({
    botId,
    role: 'member' as const,
    joinedAt: '2026-11-01T00:00:00+00:00',
    leftAt: null,
  });

  it('lists people, then bots as principals, as the REST list did', () => {
    const channel = directoryChannel('group', {
      participants: [
        directoryParticipant('viewer'),
        directoryParticipant('peer'),
      ],
      botParticipants: [bot('bot-1')],
    });
    expect(channelMemberIds(channel)).toEqual(['viewer', 'peer', 'bot|bot-1']);
  });

  it('keeps a DM with a person and a bot from reading as an agent DM', () => {
    const channel = directoryChannel('dm', {
      channelType: 'direct_message',
      participants: [
        directoryParticipant('viewer'),
        directoryParticipant('agent'),
      ],
      botParticipants: [bot('bot-1')],
    });
    expect(
      dmWorkAccount({
        isDirectMessage: true,
        participantIds: channelMemberIds(channel),
        viewerId: 'viewer',
        isAgentAccount: (id) => id === 'agent',
      })
    ).toBeUndefined();
  });
});
