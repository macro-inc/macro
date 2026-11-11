import { Model } from '@core/component/AI/constant';
import {
  ChatInputProvider,
  useChatInputContext,
} from '@core/component/AI/context';
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
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@core/component/LexicalMarkdown/utils/create-composer-layout', () => ({
  createComposerLayout: (
    _editor: unknown,
    options: { mode?: () => 'auto' | 'expanded' | 'collapsed' }
  ) => ({
    isCompact: () => options.mode?.() !== 'expanded',
    hasMultilineContent: () => false,
  }),
}));
vi.mock('@core/auth/license', () => ({ useHasPaidAccess: () => () => true }));
vi.mock('@core/component/AI/signal/attachment', () => ({
  useAttachments: () => ({ attached: () => [], setAttached: vi.fn() }),
  useGetChatAttachmentInfo: () => ({}),
}));
vi.mock('@core/component/AI/util/uploadToChat', () => ({
  useUploadAttachment: () => ({ popComplete: () => [], uploading: () => [] }),
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
vi.mock('@core/util/upload', () => ({}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 44, height: 20 }),
}));
vi.mock('./Attachment', () => ({ AttachmentList: () => null }));
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
      buildHandle: () => ({ lexical: {} }),
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
    const trigger = screen.getByRole('button', {
      name: 'Choose model, Sonnet 5.5',
    });
    if (mobile) fireEvent.click(trigger);
    else fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    if (mobile) {
      const dialog = await screen.findByRole('dialog', {
        name: 'Choose a model',
      });
      fireEvent.input(
        within(dialog).getByRole('textbox', { name: 'Search models' }),
        { target: { value: 'GPT-5.6' } }
      );
      fireEvent.click(within(dialog).getByRole('radio', { name: 'GPT-5.6' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    } else {
      fireEvent.input(
        await screen.findByRole('textbox', { name: 'Search models' }),
        { target: { value: 'GPT-5.6' } }
      );
      fireEvent.keyDown(
        screen.getByRole('menuitem', { name: /^GPT-5\.6 OpenAI$/ }),
        {
          key: 'Enter',
        }
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
