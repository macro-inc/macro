import type { ChannelEntity } from '@entity';
import { cleanup, render } from '@solidjs/testing-library';
import { createEffect, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ChannelDetailView } from './ChannelDetailView';

const rendered = vi.hoisted(() => ({
  targets: [] as Array<{
    channelId: string;
    target?:
      | { kind: 'latest' }
      | { kind: 'message'; messageId: string; threadId?: string };
    autofocus?: boolean;
  }>,
}));

vi.mock('@app/features/next-soup/utils', () => ({
  getChannelEntityTarget: (channel: {
    target?: { messageId: string; threadId?: string };
    notifications?: () => Array<{ id: string }>;
  }) => {
    if (channel.target) return { kind: 'message', ...channel.target };
    const notification = channel.notifications?.()[0];
    return notification
      ? { kind: 'message', messageId: notification.id }
      : { kind: 'latest' };
  },
}));
vi.mock('@channel/Channel/ChannelDetail', () => ({
  ChannelDetail: (props: (typeof rendered.targets)[number]) => {
    createEffect(() => {
      rendered.targets.push({
        channelId: props.channelId,
        target: props.target,
        autofocus: props.autofocus,
      });
    });
    return <div data-testid="shared-channel-detail" />;
  },
}));

afterEach(() => {
  cleanup();
  rendered.targets.length = 0;
});

it('preserves explicit route targets across metadata refreshes and retargets on URL changes', () => {
  const [channel, setChannel] = createSignal({
    type: 'channel' as const,
    id: 'channel-1',
    name: 'First name',
    target: { messageId: 'message-1', threadId: 'thread-1' },
  });
  const view = render(() => (
    <ChannelDetailView channel={channel() as ChannelEntity} />
  ));
  expect(view.getByTestId('shared-channel-detail')).toBeTruthy();
  expect(rendered.targets.at(-1)).toMatchObject({
    channelId: 'channel-1',
    target: { kind: 'message', messageId: 'message-1', threadId: 'thread-1' },
    autofocus: false,
  });
  const firstTarget = rendered.targets.at(-1)?.target;

  setChannel((previous) => ({ ...previous, name: 'Updated name' }));
  expect(rendered.targets.at(-1)?.target).toBe(firstTarget);

  setChannel((previous) => ({
    ...previous,
    target: { messageId: 'message-2', threadId: 'thread-1' },
  }));
  expect(rendered.targets.at(-1)?.target).toEqual({
    kind: 'message',
    messageId: 'message-2',
    threadId: 'thread-1',
  });
  expect(rendered.targets.at(-1)?.target).not.toBe(firstTarget);
});

it('does not re-navigate when the unread notification edge changes', () => {
  const [channel, setChannel] = createSignal({
    name: 'Channel',
    ownerId: 'viewer',
    channelType: 'private' as const,
    type: 'channel' as const,
    id: 'channel-1',
    notifications: () => [{ id: 'unread-1' }],
  });
  render(() => <ChannelDetailView channel={channel() as ChannelEntity} />);
  const firstTarget = rendered.targets.at(-1)?.target;
  expect(firstTarget).toEqual({ kind: 'message', messageId: 'unread-1' });

  setChannel((previous) => ({
    ...previous,
    notifications: () => [{ id: 'unread-2' }],
  }));
  expect(rendered.targets.at(-1)?.target).toBe(firstTarget);
});
