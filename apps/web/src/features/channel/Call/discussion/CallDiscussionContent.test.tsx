import { render, waitFor } from '@solidjs/testing-library';
import { createSignal, onMount } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { CallDiscussionContent } from './CallDiscussionContent';
import type { CallDiscussion } from './call-discussion';

const mounts = vi.hoisted(() => ({ count: 0 }));

vi.mock('./ChannelCallPanel', () => ({
  ChannelCallPanel: () => {
    onMount(() => {
      mounts.count += 1;
    });
    return <div data-testid="channel-panel" />;
  },
}));
vi.mock('../chat/CallChat', () => ({ default: () => null }));

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
      panel={{ open: true, focusOnOpen: false, onClose: () => undefined }}
      onViewChannel={() => undefined}
    />
  ));
  await waitFor(() => expect(view.getByTestId('channel-panel')).toBeTruthy());

  setDiscussion(thread());
  setDiscussion(thread());

  expect(mounts.count).toBe(1);
});
