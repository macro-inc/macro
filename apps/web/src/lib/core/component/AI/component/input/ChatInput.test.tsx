import type { EditorConfigBuilder } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type JSX, onCleanup, onMount } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from './ChatInput';

const mocks = vi.hoisted(() => ({
  touch: true,
  emitChange: undefined as ((value: string) => void) | undefined,
  root: undefined as HTMLDivElement | undefined,
  upload: vi.fn(),
  mount: vi.fn(),
  unmount: vi.fn(),
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@core/component/LexicalMarkdown/utils/create-has-line-breaks', () => ({
  createHasLineBreaks: () => () => true,
}));
vi.mock('@core/auth/license', () => ({ useHasPaidAccess: () => () => false }));
vi.mock('@core/component/AI/constant', () => ({
  SUPPORTED_ATTACHMENT_EXTENSIONS: ['pdf', 'png'],
  Model: { test: 'test' },
  modelsForPlan: () => ['test'],
  defaultModelForPlan: () => 'test',
}));
vi.mock('@core/component/AI/context', () => ({
  useChatInputContext: () => ({
    model: () => 'test',
    setModel: vi.fn(),
    isGenerating: () => false,
    uploadQueue: {
      popComplete: () => [],
      uploading: () => [],
      upload: mocks.upload,
    },
    attachments: { attached: () => [], setAttached: vi.fn() },
  }),
}));
vi.mock('@core/component/AI/util/attachment', () => ({
  isImageAttachment: () => false,
}));
vi.mock('@core/component/AI/util/chatAttachmentMention', () => ({}));
vi.mock('@core/component/Toast/Toast', () => ({}));
vi.mock('@core/constant/allBlocks', () => ({}));
vi.mock('@core/constant/PaywallState', () => ({
  usePaywallState: () => ({ showPaywall: vi.fn() }),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.touch }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => false,
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
vi.mock('./ModelSelector', () => ({ ModelSelector: () => null }));
vi.mock('./ChatAttachMenu', () => ({
  ChatAttachMenu: () => <input aria-label="Search attachments" />,
}));
vi.mock('./useAiDataConsent', () => ({
  useAiDataConsentGate: () => ({ ConsentDialog: () => null }),
}));
vi.mock('@ui', async () => {
  const { cn } = await import('@ui/utils/classname');
  return {
    cn,
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
  MarkdownShell: (props: { initialValue?: string }) => {
    mocks.mount();
    onCleanup(mocks.unmount);
    onMount(() => mocks.emitChange?.(props.initialValue ?? ''));
    return (
      <div
        contentEditable
        tabIndex={0}
        role="textbox"
        aria-label="Prompt"
        ref={(element) => {
          mocks.root = element;
        }}
      >
        {props.initialValue}
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  mocks.touch = true;
  mocks.root = undefined;
  mocks.emitChange = undefined;
  vi.clearAllMocks();
});

function setup(collapseOnBlur = true) {
  const draft = 'First line\nSecond line of the unsent prompt';
  const onSend = vi.fn();
  const editor = {
    buildHandle: () => ({ lexical: {} }),
    withFilePaste: () => editor,
    onEnter: () => editor,
    onEscape: () => editor,
    onChange: (callback: (value: string) => void) => {
      mocks.emitChange = callback;
      return editor;
    },
    controls: {
      clear: () => {
        if (mocks.root) mocks.root.textContent = '';
        mocks.emitChange?.('');
      },
    },
  } as unknown as EditorConfigBuilder;
  const { container } = render(() => (
    <>
      <ChatInput
        variant="default"
        collapseOnBlur={collapseOnBlur}
        editor={editor}
        initialValue={draft}
        onSend={onSend}
      />
      <input aria-label="Outside" />
    </>
  ));
  const wrapper = container.querySelector<HTMLDivElement>(
    '#chat-input-text-area'
  )!;
  // jsdom has no layout: a clipped element's scrollHeight still includes its
  // full content in browsers. WebKit verification covers the actual geometry.
  Object.defineProperty(wrapper, 'scrollHeight', { get: () => 80 });
  return {
    wrapper,
    draft,
    onSend,
    input: screen.getByRole('textbox', { name: 'Prompt' }),
  };
}

describe('compact mobile chat drafts', () => {
  it('expands on focus and collapses on blur without replacing the editor or draft', () => {
    const { wrapper, input, draft } = setup();
    expect(wrapper.classList.contains('max-h-5')).toBe(true);
    input.focus();
    expect(wrapper.classList.contains('max-h-5')).toBe(false);
    wrapper.scrollTop = 40;
    screen.getByRole('textbox', { name: 'Outside' }).focus();
    expect(wrapper.classList.contains('max-h-5')).toBe(true);
    expect(wrapper.scrollTop).toBe(0);
    expect(input.textContent).toBe(draft);
    input.focus();
    expect(wrapper.classList.contains('max-h-5')).toBe(false);
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBe(input);
    expect(mocks.mount).toHaveBeenCalledOnce();
    expect(mocks.unmount).not.toHaveBeenCalled();
  });

  it('sends the entire collapsed draft', () => {
    const { draft, onSend } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ content: draft })
    );
  });

  it('keeps the composer expanded when focus moves into its attachment controls', () => {
    const { wrapper, input } = setup();
    input.focus();
    const attach = screen.getByRole('button', { name: 'Attach files' });
    attach.focus();
    fireEvent.click(attach);
    screen.getByRole('textbox', { name: 'Search attachments' }).focus();
    expect(wrapper.classList.contains('max-h-5')).toBe(false);
  });

  it('leaves other chat inputs expanded', () => {
    const { wrapper } = setup(false);
    expect(wrapper.classList.contains('max-h-5')).toBe(false);
  });

  it('leaves desktop drafts expanded', () => {
    mocks.touch = false;
    const { wrapper } = setup();
    expect(wrapper.classList.contains('max-h-5')).toBe(false);
  });
});

it('opens the desktop file picker directly and uploads the selected files', () => {
  mocks.touch = false;
  setup();
  const click = vi.spyOn(HTMLInputElement.prototype, 'click');
  fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
  expect(click).toHaveBeenCalledOnce();
  click.mockRestore();
  expect(
    screen.queryByRole('textbox', { name: 'Search attachments' })
  ).toBeNull();
  const picker =
    document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(['pdf'], 'report.pdf', { type: 'application/pdf' });
  fireEvent.change(picker, { target: { files: [file] } });
  expect(mocks.upload).toHaveBeenCalledExactlyOnceWith([file]);
});
