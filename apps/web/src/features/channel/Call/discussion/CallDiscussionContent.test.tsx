import { render, waitFor } from '@solidjs/testing-library';
import { createSignal, onMount } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { CallDiscussionContent } from './CallDiscussionContent';
import type { CallDiscussion } from './call-discussion';

const mounts = vi.hoisted<{ count: number; chats: unknown[] }>(() => ({
  count: 0,
  chats: [],
}));

vi.mock('./ChannelCallPanel', () => ({
  ChannelCallPanel: () => {
    onMount(() => {
      mounts.count += 1;
    });
    return <div data-testid="channel-panel" />;
  },
}));
vi.mock('../chat/CallChat', () => ({
  default: (props: { access: unknown; callId: string }) => {
    mounts.chats.push({ access: props.access, callId: props.callId });
    return <div data-testid="call-chat" />;
  },
}));

it('keeps the channel mounted when the polled record returns a new object', async () => {
  const thread = (): CallDiscussion => ({
    kind: 'channel_thread',
    channel_id: 'channel-1',
    root_id: 'call-1',
  });
  const [discussion, setDiscussion] = createSignal<CallDiscussion>(thread());

  const view = render(() => (
    <CallDiscussionContent
      discussion={discussion}
      access={{ kind: 'member' }}
      panel={{ open: true, focusOnOpen: false, onClose: () => undefined }}
      onViewChannel={() => undefined}
    />
  ));
  await waitFor(() => expect(view.getByTestId('channel-panel')).toBeTruthy());

  setDiscussion(thread());
  setDiscussion(thread());

  expect(mounts.count).toBe(1);
});

it.each([
  { kind: 'member' } as const,
  {
    kind: 'guest',
    session: { token: 'guest-token', participantId: 'guest-1' },
  } as const,
])(
  'renders call chat with $kind access without the channel host',
  async (access) => {
    const host = vi.fn(() => <div />);
    const view = render(() => (
      <CallDiscussionContent
        discussion={() => ({ kind: 'call_chat', call_id: 'call-1' })}
        access={access}
        panel={{ open: true, focusOnOpen: false, onClose: () => undefined }}
        onViewChannel={() => undefined}
        host={host}
      />
    ));

    await waitFor(() => expect(view.getByTestId('call-chat')).toBeTruthy());
    expect(mounts.chats.at(-1)).toEqual({ access, callId: 'call-1' });
    expect(host).not.toHaveBeenCalled();
  }
);
