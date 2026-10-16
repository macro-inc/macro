/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, lazy, Show, Suspense } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ChannelMessage } from '../ChannelMessage';
import type { ChannelMessageListMeta } from '../list-meta';

vi.mock('../Message', async () => {
  const { Root } = await import('../Root');
  const { Layout } = await import('../Layout');
  const { Slot } = await import('../Slot');
  const empty = () => null;
  return {
    Message: {
      Root,
      Layout,
      Slot,
      Content: () => <p>Test reply</p>,
      SenderIcon: empty,
      SenderName: empty,
      ExternalBadge: empty,
      AgentBadge: empty,
      Timestamp: empty,
      EditedIndicator: empty,
      AgentSessionLink: empty,
      FromPill: empty,
      Attachments: empty,
      Reactions: empty,
      ActionMenu: empty,
    },
  };
});
vi.mock('../SwipeToReplyRow', () => ({
  MaybeSwipeToReplyRow: (props: { children: unknown }) => props.children,
}));
vi.mock('../../Channel/InlineMessageEditor', () => ({
  MessageEditorContent: () => null,
}));
vi.mock('@core/util/message-send-motion', () => ({
  messageSendMotion: () => {},
}));
vi.mock('@core/directive/touchHandler', () => ({ touchHandler: () => {} }));
vi.mock('@channel/Mobile/message-action-drawer-context', () => ({
  useMessageActionDrawer: () => undefined,
}));

afterEach(cleanup);

it('keeps lazy delivery visible after sender grouping changes during load', async () => {
  let finish!: () => void;
  const loaded = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const Status = lazy(async () => {
    await loaded;
    return {
      default: (props: { text: string }) => (
        <span role="status">{props.text}</span>
      ),
    };
  });
  const [grouped, setGrouped] = createSignal(false);
  const [status, setStatus] = createSignal('Delivered');
  render(() => (
    <ChannelMessage
      parent={{ type: 'channel', id: 'channel' }}
      message={{
        id: 'reply',
        sender_id: 'macro|sender@example.test',
        content: 'Test reply',
        created_at: '',
        updated_at: '',
        attachments: [],
        reactions: [],
      }}
      listMeta={{ isGroupedWithPrevious: grouped() } as ChannelMessageListMeta}
      delivery={() => (
        <Show when={status()}>
          {(state) => (
            <Suspense>
              <Status text={state()} />
            </Suspense>
          )}
        </Show>
      )}
    />
  ));
  expect(screen.queryByRole('status')).toBeNull();
  setGrouped(true);
  finish();
  await screen.findByRole('status');
  expect(screen.getByRole('status').textContent).toBe('Delivered');
  setStatus('Read');
  expect(screen.getByRole('status').textContent).toBe('Read');
  setGrouped(false);
  expect((await screen.findByRole('status')).textContent).toBe('Read');
});
