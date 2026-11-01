/**
 * @vitest-environment jsdom
 */

import type { MessageData } from '@core/messages/types';
import { render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { MessageProvider, useMessage } from '../context';

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
vi.mock('../Message', () => {
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
      Slot: Pass,
      Content: Nothing,
      SenderIcon: Nothing,
      SenderName: Nothing,
      AgentBadge: Nothing,
      Timestamp: Nothing,
      EditedIndicator: Nothing,
      AgentSessionLink: Nothing,
      Attachments: Nothing,
      Reactions: Nothing,
      ActionMenu: Nothing,
      FromPill: () => <span>from {useMessage()().sender?.triggered_by}</span>,
    },
  };
});

import { ChannelMessage } from '../ChannelMessage';

const reply = {
  id: 'reply',
  content: 'Here you go.',
  sender_id: 'bot|ada',
  sender: { triggered_by: 'macro|me@example.com' },
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T00:00:00.000Z',
  attachments: [],
  reactions: [],
} as unknown as MessageData;

const parent = { type: 'channel', id: 'dm' } as const;

describe('who triggered a bot message', () => {
  it('names them in a channel', () => {
    const view = render(() => (
      <ChannelMessage parent={parent} message={reply} />
    ));
    expect(view.queryByText(/from macro\|me@example.com/)).not.toBeNull();
  });

  it('is left out where it is always the viewer', () => {
    const view = render(() => (
      <ChannelMessage parent={parent} message={reply} hideTriggeredBy />
    ));
    expect(view.queryByText(/^from /)).toBeNull();
  });
});
