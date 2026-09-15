import type { InputHandle } from '@channel/Input/types';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscussionInput } from './DiscussionInput';

const editor = vi.hoisted(() => ({
  root: undefined as HTMLTextAreaElement | undefined,
  isIOS: true,
}));
const pickPhotos = vi.hoisted(() => vi.fn<() => Promise<File[] | null>>());
const addMedia = vi.hoisted(() => vi.fn());

vi.mock('@solid-primitives/platform', () => ({
  get isIOS() {
    return editor.isIOS;
  },
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@core/mobile/nativePhotoLibrary', () => ({
  pickNativePhotoLibraryMedia: pickPhotos,
}));
vi.mock('@core/util/platform', () => ({
  isPlatform: (platform: string) => platform === 'ios' && editor.isIOS,
}));
vi.mock('@channel/Input/ActionButton', () => ({}));
vi.mock('@channel/Input/context', () => ({}));
vi.mock('@channel/Input/FormatButtons', () => ({ FormatButtons: () => null }));
vi.mock('@channel/Input/utils/formatting', () => ({}));
vi.mock('@core/component/LexicalMarkdown/plugins/media', () => ({
  addMediaFromFile: addMedia,
}));
vi.mock('@core/component/LexicalMarkdown/theme', () => ({
  singleLineMarkdownTheme: {},
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: () => null,
  })
);
vi.mock('@channel/Input/Input', () => {
  const Slot = (props: ParentProps) => props.children;
  return {
    Input: {
      Root: Slot,
      Layout: Slot,
      EditorShell: Slot,
      Editor: Slot,
      Footer: Slot,
      FormatRibbon: () => null,
    },
  };
});
vi.mock('@ui', () => ({
  ComposerSurface: (props: JSX.HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="composer" {...props} />
  ),
  CollapsedInput: (props: { onAttach: () => void }) => (
    <div data-testid="compact-input">
      <button onClick={props.onAttach}>Attach images</button>
    </div>
  ),
}));

// Keep the component's real send, clear, and collapse handlers; replace the
// rich editor with a native field so focus and blur still dispatch DOM events.
vi.mock('./configured-discussion-markdown-editor', () => ({
  createConfiguredDiscussionMarkdownEditor: () => ({
    buildHandle: () => {},
    lexical: { getRootElement: () => editor.root },
    controls: {
      focus: () => editor.root?.focus(),
      blur: () => editor.root?.blur(),
      clear: () => {
        if (editor.root) editor.root.value = '';
      },
    },
  }),
}));
vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: (props: { initialValue: string }) => (
    <textarea
      aria-label="Comment"
      ref={(element) => {
        editor.root = element;
      }}
      value={props.initialValue}
    />
  ),
}));

beforeEach(() => {
  editor.isIOS = true;
  pickPhotos.mockReset().mockResolvedValue([]);
  addMedia.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  editor.root = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('collapsed discussion attachments', () => {
  function renderCollapsed() {
    render(() => (
      <DiscussionInput input={{ mode: 'channel' }} collapsible>
        <span />
      </DiscussionInput>
    ));
    return vi.spyOn(HTMLInputElement.prototype, 'click');
  }

  it('inserts images selected from the native iOS photo library', async () => {
    const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    pickPhotos.mockResolvedValue([photo]);
    const browserPicker = renderCollapsed();

    screen.getByRole('button', { name: 'Attach images' }).click();
    await vi.runAllTimersAsync();

    expect(pickPhotos).toHaveBeenCalledOnce();
    expect(browserPicker).not.toHaveBeenCalled();
    expect(addMedia).toHaveBeenCalledExactlyOnceWith(
      expect.any(Object),
      photo,
      'image'
    );
  });

  it.each([true, false])(
    'opens the browser picker when native selection is unavailable (iOS: %s)',
    async (isIOS) => {
      editor.isIOS = isIOS;
      pickPhotos.mockResolvedValue(null);
      const browserPicker = renderCollapsed();

      screen.getByRole('button', { name: 'Attach images' }).click();
      await vi.runAllTimersAsync();

      expect(pickPhotos).toHaveBeenCalledTimes(isIOS ? 1 : 0);
      expect(browserPicker).toHaveBeenCalledOnce();
      expect(addMedia).not.toHaveBeenCalled();
    }
  );

  it('does not open another picker when native selection is cancelled', async () => {
    const browserPicker = renderCollapsed();

    screen.getByRole('button', { name: 'Attach images' }).click();
    await vi.runAllTimersAsync();

    expect(pickPhotos).toHaveBeenCalledOnce();
    expect(browserPicker).not.toHaveBeenCalled();
    expect(addMedia).not.toHaveBeenCalled();
  });
});

function setup(
  options: { blurOnSend?: boolean; submit?: () => Promise<void> } = {}
) {
  let handle!: InputHandle;
  render(() => (
    <DiscussionInput
      input={{ mode: 'channel', value: 'My comment' }}
      collapsible
      blurOnSend={options.blurOnSend}
      onReady={(value) => {
        handle = value;
      }}
      onSend={async () => {
        await options.submit?.();
        handle.clear();
      }}
    >
      <span />
    </DiscussionInput>
  ));
  handle.focus();
  return { handle, field: screen.getByRole('textbox') as HTMLTextAreaElement };
}

describe('discussion submission focus', () => {
  it.each([true, false])(
    'blurs and collapses after sending (iOS: %s)',
    async (isIOS) => {
      editor.isIOS = isIOS;
      const { handle, field } = setup({ blurOnSend: true });
      expect(document.activeElement).toBe(field);

      expect(await handle.send()).toBe(true);
      await vi.runAllTimersAsync();

      expect(field.value).toBe('');
      expect(document.activeElement).not.toBe(field);
      expect(screen.getByTestId('composer').className).toBe('hidden');
      expect(screen.queryByTestId('compact-input')).not.toBeNull();
    }
  );

  it('waits for submission before dismissing the input', async () => {
    let finish!: () => void;
    const { handle, field } = setup({
      blurOnSend: true,
      submit: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    const sending = handle.send();
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('My comment');
    finish();
    await sending;
    expect(document.activeElement).not.toBe(field);
  });

  it('keeps focus and the draft when the submit callback rejects', async () => {
    const { handle, field } = setup({
      blurOnSend: true,
      submit: async () => {
        throw new Error('Send failed');
      },
    });
    await expect(handle.send()).rejects.toThrow('Send failed');
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('My comment');
    expect(screen.queryByTestId('compact-input')).toBeNull();
  });

  it('preserves the default iOS refocus for other discussion inputs', async () => {
    const { handle, field } = setup();
    await handle.send();
    await vi.runAllTimersAsync();
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    expect(screen.queryByTestId('compact-input')).toBeNull();
  });
});
