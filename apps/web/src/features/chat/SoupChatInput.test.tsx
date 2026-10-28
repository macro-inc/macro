import { Model } from '@core/component/AI/constant';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createChat: vi.fn(),
  replace: vi.fn(),
  pending: vi.fn(),
  rename: vi.fn(),
  storeModel: vi.fn(),
  sendBackground: vi.fn(),
  setMarkdown: vi.fn(),
  setAttached: vi.fn(),
  failureToast: vi.fn(),
  background: false,
  agentsEnabled: false,
  agentsLoading: (): boolean => false,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({
    enabled: mocks.agentsEnabled,
    loading: mocks.agentsLoading(),
  }),
}));
vi.mock('../agents-view/mobile-agent-composer', () => ({
  MobileAgentComposer: () => <div data-testid="agent-composer" />,
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { replace: mocks.replace } }),
}));
vi.mock('@core/component/AI/component/input/buildChatEditor', () => ({
  buildChatEditor: () => {
    const builder = {
      withAppLinkResolver: () => builder,
      withMentions: () => ({ controls: { setMarkdown: mocks.setMarkdown } }),
    };
    return builder;
  },
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
          model: Model.gpt56,
          metaKey: mocks.background,
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
    model: () => Model.gpt56,
    attachments: { setAttached: mocks.setAttached },
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
  storeChatStateImmediate: mocks.storeModel,
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
  cognitionApiServiceClient: {
    createChat: mocks.createChat,
    sendStreamChatMessage: mocks.sendBackground,
  },
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failureToast },
}));

import { SoupChatInput } from './SoupChatInput';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendBackground.mockResolvedValue({ isErr: () => false });
  mocks.background = false;
  mocks.agentsEnabled = false;
  mocks.agentsLoading = () => false;
});
afterEach(cleanup);

describe('SoupChatInput', () => {
  it.each([true, false])(
    'waits for flags before mounting the composer (agents enabled: %s)',
    (enabled) => {
      const [loading, setLoading] = createSignal(true);
      mocks.agentsLoading = loading;
      render(() => <SoupChatInput />);
      expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
      expect(screen.queryByTestId('agent-composer')).toBeNull();
      expect(mocks.createChat).not.toHaveBeenCalled();
      mocks.agentsEnabled = enabled;
      setLoading(false);
      expect(!!screen.queryByTestId('agent-composer')).toBe(enabled);
      expect(!!screen.queryByRole('button', { name: 'Send' })).toBe(!enabled);
    }
  );
  it('uses the new composer when agents are enabled', () => {
    mocks.agentsEnabled = true;
    render(() => <SoupChatInput />);
    expect(screen.getByTestId('agent-composer')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(mocks.createChat).not.toHaveBeenCalled();
  });
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
      model: Model.gpt56,
      attachments: [{ entity_id: 'document-id', entity_type: 'document' }],
    });
    expect(mocks.pending.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.replace.mock.invocationCallOrder[0]
    );
    expect(mocks.storeModel).toHaveBeenCalledWith('new-chat', {
      model: Model.gpt56,
    });
    expect(mocks.storeModel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rename.mock.invocationCallOrder[0]
    );
  });
  it('records the selected provider for a background send without opening the chat', async () => {
    mocks.background = true;
    mocks.createChat.mockResolvedValue({
      isErr: () => false,
      value: { id: 'background-chat' },
    });
    render(() => <SoupChatInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.sendBackground).toHaveBeenCalled());
    expect(mocks.storeModel).toHaveBeenCalledWith('background-chat', {
      model: Model.gpt56,
    });
    expect(mocks.storeModel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendBackground.mock.invocationCallOrder[0]
    );
    expect(mocks.pending).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it('does not navigate or queue a message when creation fails', async () => {
    mocks.createChat.mockResolvedValue({ isErr: () => true });
    render(() => <SoupChatInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.createChat).toHaveBeenCalledTimes(1));
    expect(mocks.pending).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.storeModel).not.toHaveBeenCalled();
  });
});

it('restores a rejected background draft and reports the failure', async () => {
  mocks.background = true;
  mocks.createChat.mockResolvedValue({
    isErr: () => false,
    value: { id: 'new-chat' },
  });
  mocks.sendBackground.mockResolvedValue({ isErr: () => true });
  render(() => <SoupChatInput />);
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() =>
    expect(mocks.setMarkdown).toHaveBeenCalledWith('Summarize this document')
  );
  expect(mocks.setAttached).toHaveBeenCalledWith([
    { entity_id: 'document-id', entity_type: 'document' },
  ]);
  expect(mocks.failureToast).toHaveBeenCalledOnce();
  expect(mocks.replace).not.toHaveBeenCalled();
});
