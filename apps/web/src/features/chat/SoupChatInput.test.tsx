import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createChat: vi.fn(),
  replace: vi.fn(),
  pending: vi.fn(),
  rename: vi.fn(),
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { replace: mocks.replace } }),
}));
vi.mock('@core/component/AI/component/input/buildChatEditor', () => ({
  buildChatEditor: () => ({ withMentions: () => ({}) }),
}));
vi.mock('@core/component/AI/component/input/ChatInput', () => ({
  ChatInput: (props: {
    onSend: (request: unknown) => void;
    variant?: string;
    collapseOnBlur?: boolean;
  }) => (
    <button
      data-variant={props.variant}
      data-collapse-on-blur={props.collapseOnBlur}
      onClick={() =>
        props.onSend({
          content: 'Summarize this document',
          model: 'claude-sonnet-5',
          attachments: [{ entity_id: 'document-id', entity_type: 'document' }],
        })
      }
    >
      Send
    </button>
  ),
}));
vi.mock('@core/component/AI/context', () => ({
  ChatInputProvider: (props: { children: unknown }) => props.children,
  useChatInputContext: () => ({
    model: () => 'claude-sonnet-5',
    attachments: {},
  }),
}));
vi.mock('@core/component/AI/signal/attachment', () => ({
  useGetChatAttachmentInfo: () => ({}),
}));
vi.mock('@core/component/AI/signal/mention-attachment-callbacks', () => ({
  createMentionAttachmentCallbacks: () => ({}),
}));
vi.mock('@core/component/AI/signal/pendingSend', () => ({
  setPendingSendData: mocks.pending,
}));
vi.mock('@core/component/AI/util/storage', () => ({
  getSoupInputStoredModel: () => undefined,
  storeSoupInputModel: vi.fn(),
}));
vi.mock('@core/constant/PaywallState', () => ({
  PaywallKey: {},
  usePaywallState: () => ({}),
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
  useHotkeyDOMScope: () => [vi.fn()],
}));
vi.mock('@core/util/handlePaymentError', () => ({
  isPaymentError: () => false,
}));
vi.mock('@entity', () => ({
  createRenameDssEntityMutation: () => ({ mutate: mocks.rename }),
}));
vi.mock('@queries/soup/cache', () => ({ invalidateAllSoup: vi.fn() }));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: { createChat: mocks.createChat },
}));

import { SoupChatInput } from './SoupChatInput';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('SoupChatInput', () => {
  it('renders the compact chat input inline without page actions', () => {
    const { container } = render(() => <SoupChatInput />);
    const send = screen.getByRole('button', { name: 'Send' });
    expect(container.contains(send)).toBe(true);
    expect(send.getAttribute('data-variant')).toBe('default');
    expect(send.getAttribute('data-collapse-on-blur')).toBe('true');
    expect(screen.queryByRole('button', { name: /^New/ })).toBeNull();
  });
  it('creates and opens a chat with the first prompt, selected model, and attachments', async () => {
    mocks.createChat.mockResolvedValue({
      isErr: () => false,
      value: { id: 'new-chat' },
    });
    render(() => <SoupChatInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith({
        next: { type: 'chat', id: 'new-chat' },
      })
    );
    expect(mocks.createChat).toHaveBeenCalledTimes(1);
    expect(mocks.pending).toHaveBeenCalledWith({
      content: 'Summarize this document',
      model: 'claude-sonnet-5',
      attachments: [{ entity_id: 'document-id', entity_type: 'document' }],
    });
    expect(mocks.pending.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.replace.mock.invocationCallOrder[0]
    );
  });
  it('does not navigate or queue a message when creation fails', async () => {
    mocks.createChat.mockResolvedValue({ isErr: () => true });
    render(() => <SoupChatInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.createChat).toHaveBeenCalledTimes(1));
    expect(mocks.pending).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
