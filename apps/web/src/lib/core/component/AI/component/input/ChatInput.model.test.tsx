import { SoupChatInput } from '@app/features/chat/SoupChatInput';
import { Chat } from '@block-chat/component/Chat';
import type { ChatData } from '@block-chat/definition';
import { Model } from '@core/component/AI/constant';
import {
  ChatInputProvider,
  useChatInputContext,
} from '@core/component/AI/context';
import { peekPendingSend } from '@core/component/AI/signal/pendingSend';
import {
  getChatInputStoredState,
  getSoupInputStoredModel,
} from '@core/component/AI/util/storage';
import type { EditorConfigBuilder } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { type JSX, onMount } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatInput } from './ChatInput';

const mocks = vi.hoisted(() => ({
  mobile: true,
  change: undefined as ((text: string) => void) | undefined,
  createChat: vi.fn(),
  replace: vi.fn(),
  editor: undefined as unknown as EditorConfigBuilder,
  send: vi.fn(),
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { replace: mocks.replace } }),
  useCanAutofocusSplitContent: () => false,
}));
vi.mock('@block-chat/component/TopBar', () => ({
  TopBar: () => <CurrentModel />,
}));
vi.mock('@block-chat/signal/pendingLocationParams', () => ({
  pendingLocationParamsSignal: { get: vi.fn(), set: vi.fn() },
}));
vi.mock('@components/app/mobile/float-regions/FloatRegion', () => ({
  FloatRegionOrInline: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@components/app/useNavigatedFromJK', () => ({
  useNavigatedFromJK: () => ({ navigatedFromJK: () => false }),
}));
vi.mock('@core/block', () => ({
  useBlockId: () => 'selected-first-chat',
  useIsNestedBlock: () => false,
}));
vi.mock('@core/component/AI/component/DragDrop', () => ({
  DragDropWrapper: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@core/component/AI/component/input/buildRequest', () => ({
  useSendChatMessage: () => mocks.send,
}));
vi.mock('@core/component/AI/component/message/ChatMessages', () => ({
  ChatMessages: () => null,
}));
vi.mock('@core/component/AI/hook/useEntityDropAttachment', () => ({
  useEntityDropAttachment: () => ({
    droppable: vi.fn(),
    isDraggingOver: () => false,
  }),
}));
vi.mock('@core/component/AI/signal/tool', () => ({
  registerToolHandler: vi.fn(),
}));
vi.mock('@core/component/CustomScrollbar', () => ({
  CustomScrollbar: () => null,
}));
vi.mock('@core/hotkey/utils', () => ({ registerScopeSignalHotkey: vi.fn() }));
vi.mock('@core/orchestrator', () => ({ createMethodRegistration: vi.fn() }));
vi.mock('@core/signal/blockElement', () => ({
  blockElementSignal: { get: vi.fn() },
  blockHotkeyScopeSignal: { get: vi.fn() },
}));
vi.mock('@core/signal/load', () => ({ blockHandleSignal: { get: vi.fn() } }));
vi.mock('@core/signal/permissions', () => ({ useCanEdit: () => () => true }));
vi.mock('@core/util/message-send-motion', () => ({ markMessageSent: vi.fn() }));
vi.mock('@queries/auth', () => ({ invalidateUserQuota: vi.fn() }));
vi.mock('@core/component/AI/component/input/buildChatEditor', () => ({
  buildChatEditor: () => ({ withMentions: () => mocks.editor }),
}));
vi.mock('@core/component/AI/signal/mention-attachment-callbacks', () => ({
  createMentionAttachmentCallbacks: () => ({}),
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
  useHotkeyDOMScope: () => [vi.fn()],
}));
vi.mock('@core/util/handlePaymentError', () => ({
  isPaymentError: () => false,
}));
vi.mock('@entity', () => ({
  createRenameDssEntityMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('@queries/soup/cache', () => ({ invalidateAllSoup: vi.fn() }));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: { createChat: mocks.createChat },
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@core/auth/license', () => ({ useHasPaidAccess: () => () => true }));
vi.mock('@core/component/AI/signal/attachment', () => ({
  useAttachments: () => ({ attached: () => [], setAttached: vi.fn() }),
  useGetChatAttachmentInfo: () => ({}),
}));
vi.mock('@core/component/AI/util/uploadToChat', () => ({
  useUploadAttachment: () => ({ popComplete: () => [], uploading: () => [] }),
}));
vi.mock('@core/component/AI/state/createChatController', () => ({
  createChatController: (chatId: string) => ({
    chatId: () => chatId,
    messages: () => [],
    isGenerating: () => false,
    stream: () => undefined,
    dispatch: vi.fn(),
  }),
}));
vi.mock('@core/component/AI/util/chatAttachmentMention', () => ({}));
vi.mock('@core/component/Toast/Toast', () => ({}));
vi.mock('@core/constant/allBlocks', () => ({}));
vi.mock('@core/constant/PaywallState', () => ({
  usePaywallState: () => ({ showPaywall: vi.fn() }),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.mobile }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.mobile,
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => false,
}));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => true,
}));
vi.mock('@core/mobile/useTouchOutsideToDismissKeyboard', () => ({
  useTouchOutsideToDismissKeyboard: () => {},
}));
vi.mock('@core/util/getItemBlockName', () => ({}));
vi.mock('@core/util/upload', () => ({}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 44, height: 20 }),
}));
vi.mock('./Attachment', () => ({ AttachmentList: () => null }));
vi.mock('./ChatAttachMenu', () => ({ ChatAttachMenu: () => null }));
vi.mock('./useAiDataConsent', () => ({
  useAiDataConsentGate: () => ({ ConsentDialog: () => null }),
}));
vi.mock('@ui', async () => {
  const { cn } = await import('@ui/utils/classname');
  const { Dropdown } = await import('@ui/components/Dropdown');
  return {
    cn,
    Dropdown,
    ComposerSurface: (props: JSX.HTMLAttributes<HTMLDivElement>) => (
      <div {...props} />
    ),
    Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props} />
    ),
    SendButton: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button aria-label="Send" {...props} />
    ),
  };
});

it('preserves a real soup composer selection when creating and opening its first chat', async () => {
  mocks.mobile = true;
  const editor = {
    withFilePaste: () => editor,
    onEnter: () => editor,
    onEscape: () => editor,
    onChange: (callback: (text: string) => void) => {
      mocks.change = callback;
      return editor;
    },
    controls: { clear: () => mocks.change?.('') },
  } as unknown as EditorConfigBuilder;
  mocks.editor = editor;
  mocks.createChat.mockResolvedValue({
    isErr: () => false,
    value: { id: 'selected-first-chat' },
  });
  const composer = render(() => <SoupChatInput />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Choose model, Sonnet 5' })
  );
  const dialog = await screen.findByRole('dialog', { name: 'Select model' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'GPT-5.6' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(
    screen.getByRole('button', { name: 'Choose model, GPT-5.6' })
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
  expect(peekPendingSend()?.model).toBe(Model.gpt56);
  expect(getChatInputStoredState('selected-first-chat').model).toBe(
    Model.gpt56
  );
  expect(getSoupInputStoredModel()).toBe(Model.gpt56);
  composer.unmount();
  mocks.send.mockResolvedValue({ error: true });
  const chat = render(() => (
    <Chat
      data={
        {
          chat: {
            id: 'selected-first-chat',
            model: Model.sonnet5,
            messages: [],
          },
        } as unknown as ChatData
      }
    />
  ));
  expect(screen.getByTestId('model').textContent).toBe(Model.gpt56);
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({
      model: Model.gpt56,
      chatId: 'selected-first-chat',
    })
  );
  expect(peekPendingSend()).toBeNull();
  chat.unmount();
  render(() => <SoupChatInput />);
  expect(
    screen.getByRole('button', { name: 'Choose model, GPT-5.6' })
  ).toBeTruthy();
});
vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: () => {
    onMount(() => mocks.change?.('Test first message'));
    return (
      <div contentEditable tabIndex={0} role="textbox" aria-label="Prompt">
        Test first message
      </div>
    );
  },
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.unstubAllGlobals();
});

function CurrentModel() {
  const input = useChatInputContext();
  return <output data-testid="model">{input.model()}</output>;
}

it.each([true, false])(
  'keeps GPT selected through picker dismissal and the first send (mobile=%s)',
  async (mobile) => {
    mocks.mobile = mobile;
    const onSend = vi.fn();
    const editor = {
      withFilePaste: () => editor,
      onEnter: () => editor,
      onEscape: () => editor,
      onChange: (callback: (text: string) => void) => {
        mocks.change = callback;
        return editor;
      },
      controls: { clear: () => mocks.change?.('') },
    } as unknown as EditorConfigBuilder;
    render(() => (
      <ChatInputProvider>
        <CurrentModel />
        <ChatInput variant="default" editor={editor} onSend={onSend} />
      </ChatInputProvider>
    ));
    const trigger = mobile
      ? screen.getByRole('button', { name: 'Choose model, Sonnet 5' })
      : screen.getByRole('button', { name: 'Sonnet 5' });
    if (mobile) fireEvent.click(trigger);
    else fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    if (mobile) {
      const dialog = await screen.findByRole('dialog', {
        name: 'Select model',
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'GPT-5.6' }));
      expect(screen.getByTestId('model').textContent).toBe(Model.gpt56);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    } else {
      fireEvent.keyDown(
        await screen.findByRole('menuitem', { name: 'GPT-5.6' }),
        { key: 'Enter' }
      );
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    }
    expect(screen.getByTestId('model').textContent).toBe(Model.gpt56);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        model: Model.gpt56,
        content: 'Test first message',
      })
    );
    expect(screen.getByTestId('model').textContent).toBe(Model.gpt56);
  }
);
