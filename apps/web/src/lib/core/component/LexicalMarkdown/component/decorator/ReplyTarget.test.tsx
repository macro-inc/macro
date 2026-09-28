import { MessageReferenceNavigation } from '@core/messages/message-reference-navigation';
import type {
  ReplyTargetDecoratorProps,
  ReplyTargetParent,
} from '@macro-inc/lexical-core';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { ReplyTarget } from './ReplyTarget';

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@core/block', () => ({
  useMaybeBlockId: () => undefined,
  useMaybeBlockName: () => undefined,
}));
vi.mock('@core/user', () => ({
  getDisplayName: () => 'Eric',
  tryMacroId: (id: string) => id,
}));
vi.mock('@core/util/openInNewSplit', () => ({
  openInNewSplitForMention: () => true,
}));
vi.mock('@queries/bots/bots', () => ({
  useBotsQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@queries/channel/channel-bots', () => ({
  useChannelBotsQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@queries/messages/message-sender', () => ({
  getBotDisplayName: () => undefined,
}));
vi.mock('@queries/storage/document-metadata', () => ({
  useDocumentMetadataQuery: () => ({
    isSuccess: true,
    data: { fileType: 'md' },
  }),
}));
vi.mock('../core/BlockLink', () => ({ openDocument: mocks.open }));
vi.mock('./QuoteReplyPreview', () => ({
  QuoteReplyPreview: (props: {
    onClick: (event: MouseEvent) => void;
    disabled?: boolean;
  }) => (
    <button disabled={props.disabled} onClick={props.onClick}>
      Quoted message
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each<{
  parentType: ReplyTargetParent['type'];
  type: string;
  id: string;
  params: Record<string, string>;
}>([
  {
    parentType: 'call',
    type: 'call',
    id: 'parent-id',
    params: { call_message_id: 'message-id' },
  },
  {
    parentType: 'crm_company',
    type: 'crm_company',
    id: 'parent-id',
    params: { comment_id: 'message-id' },
  },
  {
    parentType: 'crm_contact',
    type: 'crm_contact',
    id: 'parent-id',
    params: { comment_id: 'message-id' },
  },
  {
    parentType: 'initiative',
    type: 'component',
    id: 'initiative-view~parent-id~overview~message-id',
    params: {},
  },
  {
    parentType: 'document',
    type: 'md',
    id: 'parent-id',
    params: { comment_id: 'message-id' },
  },
  {
    parentType: 'channel',
    type: 'channel',
    id: 'parent-id',
    params: { channel_message_id: 'message-id', channel_thread_id: 'root-id' },
  },
])(
  'opens a quoted $parentType message at its durable target',
  ({ parentType, type, id, params }) => {
    const props: ReplyTargetDecoratorProps = {
      parent: { type: parentType, id: 'parent-id' },
      targetMessageId: 'message-id',
      targetThreadId: 'root-id',
      displayText: 'Quoted text',
      senderId: 'macro|eric@macro.test',
      key: 'node-key',
      theme: {},
    };
    render(() => <ReplyTarget {...props} />);
    const quote = screen.getByRole('button', { name: 'Quoted message' });
    expect(quote.hasAttribute('disabled')).toBe(false);
    fireEvent.click(quote);
    expect(mocks.open).toHaveBeenCalledWith(type, id, params, true);
  }
);

it('lets the active chat handle a quote locally, preserving Shift for opening a split', () => {
  const navigate = vi.fn(() => true);
  render(() => (
    <MessageReferenceNavigation.Provider value={navigate}>
      <ReplyTarget
        parent={{ type: 'call', id: 'call-id' }}
        targetMessageId="message-id"
        targetThreadId="call-id"
        senderId="user-id"
        displayText="Quoted text"
        key="node-key"
        theme={{}}
      />
    </MessageReferenceNavigation.Provider>
  ));
  const button = screen.getByRole('button', { name: 'Quoted message' });
  fireEvent.click(button);
  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({ targetMessageId: 'message-id' })
  );
  expect(mocks.open).not.toHaveBeenCalled();
  fireEvent.click(button, { shiftKey: true });
  expect(mocks.open).toHaveBeenCalledWith(
    'call',
    'call-id',
    { call_message_id: 'message-id' },
    true
  );
});
