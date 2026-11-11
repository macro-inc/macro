import { projectHostedContent } from '@app/features/projects/open-project';
import { MessageReferenceNavigation } from '@core/messages/message-reference-navigation';
import { MessageSenderNameProvider } from '@core/messages/message-transport';
import type {
  ReplyTargetDecoratorProps,
  ReplyTargetParent,
} from '@macro-inc/lexical-core';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { ReplyTarget } from './ReplyTarget';

const mocks = vi.hoisted(() => ({ open: vi.fn(), openWithSplit: vi.fn() }));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@core/block', () => ({
  useMaybeBlockId: () => undefined,
  useMaybeBlockName: () => undefined,
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: () => true,
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
    label: string;
    onClick: (event: MouseEvent) => void;
    disabled?: boolean;
  }) => (
    <button
      aria-label="Quoted message"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span data-testid="quote-label">{props.label}</span>
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('uses the loaded thread name for a quoted non-Macro sender', () => {
  const resolve = vi.fn(() => 'Guest Tester');
  render(() => (
    <MessageSenderNameProvider resolve={resolve}>
      <ReplyTarget
        parent={{ type: 'call', id: 'call-id' }}
        targetMessageId="guest-message"
        targetThreadId="call-id"
        senderId="guest|00000000-0000-7000-8000-000000000002"
        displayText="Quoted text"
        key="node-key"
        theme={{}}
      />
    </MessageSenderNameProvider>
  ));
  expect(screen.getByTestId('quote-label').textContent).toBe('Guest Tester');
  expect(resolve).toHaveBeenCalledWith(
    'guest|00000000-0000-7000-8000-000000000002',
    'guest-message'
  );
});

it.each<{
  parentType: ReplyTargetParent['type'];
  type: string;
  id: string;
  params: Record<string, string>;
}>([
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

it('opens a quoted project message through the project opener', () => {
  render(() => (
    <ReplyTarget
      parent={{ type: 'initiative', id: 'parent-id' }}
      targetMessageId="message-id"
      targetThreadId="root-id"
      displayText="Quoted text"
      senderId="macro|eric@macro.test"
      key="node-key"
      theme={{}}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Quoted message' }));
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.openWithSplit).toHaveBeenCalledWith(
    projectHostedContent('parent-id', 'overview', 'message-id'),
    { preferNewSplit: true }
  );
});

it('reissues call quote navigation with a fresh route request each time', () => {
  render(() => (
    <ReplyTarget
      parent={{ type: 'call', id: 'call-id' }}
      targetMessageId="message-id"
      targetThreadId="call-id"
      senderId="user-id"
      displayText="Quoted text"
      key="node-key"
      theme={{}}
    />
  ));
  const button = screen.getByRole('button', { name: 'Quoted message' });
  fireEvent.click(button);
  fireEvent.click(button);

  expect(mocks.openWithSplit).toHaveBeenCalledTimes(2);
  const first = mocks.openWithSplit.mock.calls[0];
  const second = mocks.openWithSplit.mock.calls[1];
  expect(first).toEqual([
    { type: 'call', id: 'call-id' },
    {
      preferNewSplit: true,
      search: {
        'call-detail': {
          messageId: ['message-id'],
          seek: [expect.any(String)],
        },
      },
    },
  ]);
  expect(second[1].search['call-detail'].seek).not.toEqual(
    first[1].search['call-detail'].seek
  );
  expect(mocks.open).not.toHaveBeenCalled();
});

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
  expect(mocks.openWithSplit).not.toHaveBeenCalled();
  fireEvent.click(button, { shiftKey: true });
  expect(mocks.openWithSplit).toHaveBeenCalledWith(
    { type: 'call', id: 'call-id' },
    expect.objectContaining({ preferNewSplit: true })
  );
});
