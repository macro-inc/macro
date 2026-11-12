/**
 * @vitest-environment jsdom
 */

import type { MessageData } from '@core/messages/types';
import {
  NOT_SENT_AFTER_MS,
  trackQueuedPosts,
} from '@queries/messages/graphql/unsent-posts';
import { cleanup, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageProvider } from '../context';
import type { ChannelMessageListMeta } from '../list-meta';

vi.mock('@channel/Mobile/message-action-drawer-context', () => ({
  useMessageActionDrawer: () => undefined,
}));
vi.mock('@core/directive/touchHandler', () => ({ touchHandler: () => {} }));
vi.mock('@core/util/message-send-motion', () => ({
  messageSendMotion: () => {},
}));
vi.mock('../SwipeToReplyRow', () => ({
  MaybeSwipeToReplyRow: (props: ParentProps) => <>{props.children}</>,
}));
vi.mock('../../Channel/InlineMessageEditor', () => ({
  MessageEditorContent: () => null,
}));
vi.mock('../Message', async () => {
  const { NotSentIndicator } = await vi.importActual<
    typeof import('../NotSentIndicator')
  >('../NotSentIndicator');
  const Pass = (props: ParentProps) => <>{props.children}</>;
  const Nothing = () => null;
  return {
    Message: {
      Root: (props: ParentProps<{ message: MessageData }>) => (
        <MessageProvider value={() => props.message}>
          <div>{props.children}</div>
        </MessageProvider>
      ),
      Layout: Pass,
      Slot: (props: ParentProps<{ placement: string; class?: string }>) => (
        <div data-slot={props.placement} class={props.class}>
          {props.children}
        </div>
      ),
      Content: Nothing,
      SenderIcon: Nothing,
      SenderName: Nothing,
      AgentBadge: Nothing,
      Timestamp: Nothing,
      EditedIndicator: Nothing,
      NotSentIndicator,
      AgentSessionLink: Nothing,
      Attachments: Nothing,
      Reactions: Nothing,
      ActionMenu: Nothing,
      FromPill: Nothing,
    },
  };
});

import { ChannelMessage } from '../ChannelMessage';

const post = {
  id: 'post',
  content: 'hello',
  sender_id: 'macro|me@example.com',
  created_at: '2026-11-12T10:00:00.000Z',
  updated_at: '2026-11-12T10:00:00.000Z',
  attachments: [],
  reactions: [],
} as unknown as MessageData;

const channel = { type: 'channel', id: 'channel-1' } as const;
const grouped = {
  index: 1,
  isNewMessage: false,
  isFirstNewMessage: false,
  isGroupedWithPrevious: true,
} satisfies ChannelMessageListMeta;

const dimmed = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-slot]')]
    .filter((slot) => slot.classList.contains('opacity-60'))
    .map((slot) => slot.getAttribute('data-slot'));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  trackQueuedPosts(new Map());
  cleanup();
  vi.useRealTimers();
});

describe('a post the queue holds', () => {
  it('is dimmed and says it is not sent once it has waited five seconds', () => {
    trackQueuedPosts(new Map([[post.id, Date.now()]]));
    const view = render(() => (
      <ChannelMessage parent={channel} message={post} />
    ));
    expect(view.queryByText('Not sent yet')).toBeNull();
    expect(dimmed(view.container)).toEqual([]);

    vi.advanceTimersByTime(NOT_SENT_AFTER_MS);
    expect(view.queryByText('Not sent yet')).not.toBeNull();
    expect(dimmed(view.container)).toEqual([
      'icon',
      'header',
      'content',
      'footer',
    ]);

    // Sent: the row reads as any other.
    trackQueuedPosts(new Map());
    expect(view.queryByText('Not sent yet')).toBeNull();
    expect(dimmed(view.container)).toEqual([]);
  });

  it('says so in a row grouped under the one before it', () => {
    trackQueuedPosts(new Map([[post.id, Date.now() - NOT_SENT_AFTER_MS]]));
    const view = render(() => (
      <ChannelMessage parent={channel} message={post} listMeta={grouped} />
    ));
    expect(view.queryByText('Not sent yet')).not.toBeNull();
    expect(dimmed(view.container)).toEqual(['content', 'footer']);
  });

  it('leaves the other rows alone', () => {
    trackQueuedPosts(new Map([['another', Date.now() - NOT_SENT_AFTER_MS]]));
    const view = render(() => (
      <ChannelMessage parent={channel} message={post} />
    ));
    expect(view.queryByText('Not sent yet')).toBeNull();
    expect(dimmed(view.container)).toEqual([]);
  });
});
