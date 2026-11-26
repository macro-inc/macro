/**
 * @vitest-environment jsdom
 */

import { dmWorkAccount } from '@app/features/agent-work/core/work-visibility';
import { Telemetry } from '@macro-inc/observability';
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
const serverViews = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock(import('@queries/channel/viewed-at'), async (original) => ({
  ...(await original()),
  readChannelViewedAt: serverViews.read,
}));

import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import {
  ChannelDirectoryProvider,
  type ChannelLastViewed,
  channelMemberIds,
  directMessagePeer,
  LAST_VIEW_WAIT_MS,
  useChannel,
  useChannelCanCall,
  useChannelLastViewed,
  useDmActivityByUserId,
} from './channels';

afterEach(() => {
  cleanup();
  serverViews.read.mockReset();
  viewer.id = 'viewer';
});

/** A directory that fills when the test says so; its views are current
 * unless `viewsCurrent` is false. */
function fillingDirectory(viewsCurrent = true) {
  const [channels, setChannels] = createSignal<readonly DirectoryChannel[]>([]);
  const [complete, setComplete] = createSignal(false);
  const [current, setViewsCurrent] = createSignal(viewsCurrent);
  const state = () => channelDirectoryState(channels(), [], complete());
  const directory: ChannelDirectory = {
    channels: () => state().joined,
    complete,
    lookup: (channelId) => lookupChannel(state(), {}, channelId),
    readComplete: async () => state().joined,
    failed: () => false,
    retry: () => {},
    recordView: () => {},
    viewsCurrent: current,
  };
  return {
    directory,
    fill(next: readonly DirectoryChannel[]) {
      setChannels(next);
      setComplete(true);
    },
    setChannels,
    setViewsCurrent,
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

describe('useChannelLastViewed', () => {
  const VIEWED = '2026-11-20T10:00:00+00:00';
  const SERVER_VIEWED = '2026-11-19T08:00:00+00:00';

  /** The server's answer, held until the test lets it through. Like the real
   * read, it fails with the abort's reason once the open stops waiting,
   * unless `ignoresAbort`. */
  function heldAnswer({ ignoresAbort = false } = {}) {
    let release!: (viewedAt: string | null) => void;
    serverViews.read.mockImplementation(
      (_channelId: string, signal: AbortSignal) =>
        ResultAsync.fromPromise(
          new Promise<string | null>((resolve, reject) => {
            release = resolve;
            if (ignoresAbort) return;
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
          (error) => error
        )
    );
    return (viewedAt: string | null) => release(viewedAt);
  }

  /** The signal the open's last ask went with. */
  const askSignal = (): AbortSignal | undefined =>
    serverViews.read.mock.lastCall?.[1];

  function setup(channelId: string, filling = fillingDirectory()) {
    let lastViewed!: () => ChannelLastViewed;
    render(() => (
      <ChannelDirectoryProvider directory={filling.directory}>
        {(() => {
          lastViewed = useChannelLastViewed(channelId);
          return null;
        })()}
      </ChannelDirectoryProvider>
    ));
    return { ...filling, lastViewed: () => lastViewed() };
  }

  const settles = () => new Promise((resolve) => setTimeout(resolve));

  it("reads a joined channel's view from its record, never asking the server", async () => {
    const filling = fillingDirectory();
    const id = channelUuid('joined');
    filling.fill([directoryChannel(id, { viewedAt: VIEWED })]);
    const { lastViewed } = setup(id, filling);
    await settles();
    expect(lastViewed()).toEqual({ status: 'known', viewedAt: VIEWED });
    expect(serverViews.read).not.toHaveBeenCalled();
  });

  it('asks the server once for a channel the viewer left, and is pending until it answers', async () => {
    const filling = fillingDirectory();
    const id = channelUuid('left');
    filling.fill([directoryChannel(id, { isParticipant: false })]);
    const answer = heldAnswer();
    const { lastViewed } = setup(id, filling);
    await settles();
    expect(lastViewed()).toEqual({ status: 'pending' });
    answer(SERVER_VIEWED);
    await settles();
    expect(lastViewed()).toEqual({ status: 'known', viewedAt: SERVER_VIEWED });
    expect(serverViews.read).toHaveBeenCalledTimes(1);
    expect(serverViews.read).toHaveBeenCalledWith(id, expect.any(AbortSignal));
    expect(askSignal()?.aborted).toBe(false);
  });

  it('knows that the viewer never viewed a channel the server has no view of', async () => {
    const filling = fillingDirectory();
    filling.fill([]);
    serverViews.read.mockReturnValue(okAsync(null));
    const { lastViewed } = setup(channelUuid('public'), filling);
    await settles();
    expect(lastViewed()).toEqual({ status: 'known', viewedAt: null });
  });

  it('stops waiting for a server that does not answer, ending the request, and ignores its late answer', async () => {
    vi.useFakeTimers();
    try {
      const filling = fillingDirectory();
      filling.fill([]);
      const answer = heldAnswer({ ignoresAbort: true });
      const { lastViewed } = setup(channelUuid('slow'), filling);
      await vi.advanceTimersByTimeAsync(LAST_VIEW_WAIT_MS - 1);
      expect(lastViewed()).toEqual({ status: 'pending' });
      expect(askSignal()?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(lastViewed()).toEqual({ status: 'unknown' });
      expect(askSignal()?.aborted).toBe(true);
      answer(SERVER_VIEWED);
      await vi.advanceTimersByTimeAsync(0);
      expect(lastViewed()).toEqual({ status: 'unknown' });
    } finally {
      vi.useRealTimers();
    }
  });

  // A span that ends only when the server answers says nothing about a server
  // that never does: each way of stopping ends the request and the span.
  it('records on its span what the open did with the answer, or why it stopped waiting, as it stops', async () => {
    const spans: { name: string; attrs: Record<string, unknown> }[] = [];
    const span = vi.spyOn(Telemetry, 'span').mockImplementation(((
      name: string,
      operation: (span: unknown) => Promise<unknown>
    ) => {
      const attrs: Record<string, unknown> = {};
      spans.push({ name, attrs });
      return operation({
        setAttr: (key: string, value: unknown) => {
          attrs[key] = value;
        },
        error: () => {
          attrs.error = true;
        },
      });
    }) as never);
    vi.useFakeTimers();
    try {
      const filling = fillingDirectory();
      filling.fill([]);
      const outcome = () => spans.at(-1)?.attrs['channel.last_view.outcome'];

      serverViews.read.mockReturnValue(okAsync(SERVER_VIEWED));
      setup(channelUuid('used'), filling);
      await vi.advanceTimersByTimeAsync(0);
      expect(spans.at(-1)).toEqual({
        name: 'channel.last_view',
        attrs: {
          'channel.id': channelUuid('used'),
          'channel.last_view.outcome': 'used',
        },
      });
      cleanup();

      // None of these answers: each span ends as the open stops waiting.
      heldAnswer();
      setup(channelUuid('timed-out'), filling);
      await vi.advanceTimersByTimeAsync(LAST_VIEW_WAIT_MS);
      expect(askSignal()?.aborted).toBe(true);
      expect(outcome()).toBe('timed_out');
      cleanup();

      heldAnswer();
      setup(channelUuid('closed'), filling);
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome()).toBeUndefined();
      cleanup();
      await vi.advanceTimersByTimeAsync(0);
      expect(askSignal()?.aborted).toBe(true);
      expect(outcome()).toBe('closed');

      const cold = fillingDirectory();
      const id = channelUuid('superseded');
      heldAnswer();
      setup(id, cold);
      await vi.advanceTimersByTimeAsync(0);
      cold.fill([directoryChannel(id, { viewedAt: VIEWED })]);
      await vi.advanceTimersByTimeAsync(0);
      expect(askSignal()?.aborted).toBe(true);
      expect(outcome()).toBe('superseded');
      cleanup();

      // A record whose view is later than the server's keeps it.
      const joined = channelUuid('outranked');
      const later = fillingDirectory(false);
      later.fill([directoryChannel(joined, { viewedAt: VIEWED })]);
      serverViews.read.mockReturnValue(okAsync(SERVER_VIEWED));
      const { lastViewed } = setup(joined, later);
      await vi.advanceTimersByTimeAsync(0);
      expect(lastViewed()).toEqual({ status: 'known', viewedAt: VIEWED });
      expect(outcome()).toBe('outranked');
      cleanup();

      serverViews.read.mockReturnValue(errAsync(new Error('lookup failed')));
      setup(channelUuid('failed'), filling);
      await vi.advanceTimersByTimeAsync(0);
      expect(spans.at(-1)?.attrs).toMatchObject({
        error: true,
        'channel.last_view.outcome': 'failed',
      });
      expect(spans).toHaveLength(6);
      expect(spans.filter(({ attrs }) => attrs.error)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      span.mockRestore();
    }
  });

  it('settles as unknown when the server fails', async () => {
    const filling = fillingDirectory();
    filling.fill([]);
    serverViews.read.mockReturnValue(errAsync(new Error('lookup failed')));
    const { lastViewed } = setup(channelUuid('public'), filling);
    await settles();
    expect(lastViewed()).toEqual({ status: 'unknown' });
  });

  // The activity tracker keeps the first view the open settles on, so an
  // answer after the record's, even a later view, would change nothing on
  // screen: the open ends the request and takes none.
  it('asks the server while a cold directory cannot place the channel, takes the record that arrives first, and stops asking', async () => {
    const id = channelUuid('cold');
    const LATER = '2026-11-21T09:00:00+00:00';
    const answer = heldAnswer({ ignoresAbort: true });
    const { fill, lastViewed } = setup(id);
    await settles();
    expect(serverViews.read).toHaveBeenCalledTimes(1);
    expect(lastViewed()).toEqual({ status: 'pending' });
    fill([directoryChannel(id, { viewedAt: VIEWED })]);
    expect(lastViewed()).toEqual({ status: 'known', viewedAt: VIEWED });
    expect(askSignal()?.aborted).toBe(true);
    answer(LATER);
    await settles();
    expect(lastViewed()).toEqual({ status: 'known', viewedAt: VIEWED });
  });

  describe('a joined channel whose record may predate this page', () => {
    const LATER = '2026-11-21T09:00:00+00:00';

    function stale(id: string, viewedAt = VIEWED) {
      const filling = fillingDirectory(false);
      filling.fill([directoryChannel(id, { viewedAt })]);
      return filling;
    }

    it('waits for the server and shows the view made elsewhere since', async () => {
      const id = channelUuid('viewed-elsewhere');
      const answer = heldAnswer();
      const { lastViewed } = setup(id, stale(id));
      await settles();
      expect(serverViews.read).toHaveBeenCalledWith(
        id,
        expect.any(AbortSignal)
      );
      expect(lastViewed()).toEqual({ status: 'pending' });
      answer(LATER);
      await settles();
      expect(lastViewed()).toEqual({ status: 'known', viewedAt: LATER });
    });

    it("keeps the record's view when the server's is older or absent", async () => {
      const older = channelUuid('older-answer');
      serverViews.read.mockReturnValue(okAsync(SERVER_VIEWED));
      const first = setup(older, stale(older));
      await settles();
      expect(first.lastViewed()).toEqual({ status: 'known', viewedAt: VIEWED });

      const none = channelUuid('no-answer');
      serverViews.read.mockReturnValue(okAsync(null));
      const second = setup(none, stale(none));
      await settles();
      expect(second.lastViewed()).toEqual({
        status: 'known',
        viewedAt: VIEWED,
      });
    });

    it("falls back to the record's view when the server fails or is slow", async () => {
      const failing = channelUuid('failing');
      serverViews.read.mockReturnValue(errAsync(new Error('lookup failed')));
      const first = setup(failing, stale(failing));
      await settles();
      expect(first.lastViewed()).toEqual({ status: 'known', viewedAt: VIEWED });

      vi.useFakeTimers();
      try {
        const slow = channelUuid('slow-joined');
        const answer = heldAnswer();
        const second = setup(slow, stale(slow));
        await vi.advanceTimersByTimeAsync(LAST_VIEW_WAIT_MS - 1);
        expect(second.lastViewed()).toEqual({ status: 'pending' });
        await vi.advanceTimersByTimeAsync(1);
        expect(second.lastViewed()).toEqual({
          status: 'known',
          viewedAt: VIEWED,
        });
        answer(LATER);
        await vi.advanceTimersByTimeAsync(0);
        expect(second.lastViewed()).toEqual({
          status: 'known',
          viewedAt: VIEWED,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops waiting once a pass rereads the record, ending the request', async () => {
      const id = channelUuid('reread');
      const answer = heldAnswer({ ignoresAbort: true });
      const filling = stale(id);
      const { lastViewed } = setup(id, filling);
      await settles();
      expect(lastViewed()).toEqual({ status: 'pending' });
      filling.setChannels([directoryChannel(id, { viewedAt: LATER })]);
      filling.setViewsCurrent(true);
      expect(lastViewed()).toEqual({ status: 'known', viewedAt: LATER });
      expect(askSignal()?.aborted).toBe(true);
      answer('2026-11-21T09:30:00+00:00');
      await settles();
      expect(lastViewed()).toEqual({ status: 'known', viewedAt: LATER });
    });
  });

  it('keeps reading the record after the viewer leaves the channel it opened in', async () => {
    const filling = fillingDirectory();
    const id = channelUuid('leaving');
    filling.fill([directoryChannel(id, { viewedAt: VIEWED })]);
    const { lastViewed } = setup(id, filling);
    await settles();
    filling.fill([directoryChannel(id, { isParticipant: false })]);
    await settles();
    expect(serverViews.read).not.toHaveBeenCalled();
    expect(lastViewed()).toEqual({ status: 'known', viewedAt: VIEWED });
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

  it('dates a DM by the person in it when it has a bot too', () => {
    // The REST list sent participants in no set order, so a bot could come
    // first and take the person's DM activity.
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
      directoryChannel('dm', {
        channelType: 'direct_message',
        updatedAt: '2026-11-02T00:00:00+00:00',
        participants: [
          directoryParticipant('viewer'),
          directoryParticipant('peer'),
        ],
        botParticipants: [
          {
            botId: 'bot-1',
            role: 'member',
            joinedAt: '2026-11-01T00:00:00+00:00',
            leftAt: null,
          },
        ],
      }),
    ]);
    expect([...activity().keys()]).toEqual(['peer']);
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
