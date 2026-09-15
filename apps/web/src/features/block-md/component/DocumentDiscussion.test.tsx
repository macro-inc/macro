import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { setVirtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, onCleanup, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentDiscussion } from './DocumentDiscussion';

const mocks = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));
vi.mock('../comments/documentDiscussionSource', () => ({
  createDocumentDiscussionSource: () => ({
    canEdit: () => true,
    threads: () => [],
  }),
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: ParentProps) => props.children,
  })
);
vi.mock('@core/comments/discussion', () => ({
  DiscussionProvider: (props: ParentProps) => props.children,
  Discussion: () => null,
  DiscussionComposer: () => {
    mocks.mount();
    onCleanup(mocks.unmount);
    return <textarea aria-label="Comment draft" />;
  },
}));

afterEach(() => {
  cleanup();
  setVirtualKeyboardVisible(false);
  vi.clearAllMocks();
});

function setup() {
  const [editorHasFocus, setEditorHasFocus] = createSignal(false);
  render(() => (
    <>
      <div ref={(element) => FloatRegions.setMount('accessory', element)} />
      <FloatRegion region="accessory" priority={-1}>
        <button>Ask AI</button>
      </FloatRegion>
      <DocumentDiscussion editorHasFocus={editorHasFocus()} />
    </>
  ));
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  input.value = 'Unsent comment';
  return { input, setEditorHasFocus };
}

describe('mobile document discussion accessory', () => {
  it('hides during document typing and restores the same draft when the keyboard closes', () => {
    const { input, setEditorHasFocus } = setup();
    setEditorHasFocus(true);
    expect(screen.getByRole('textbox')).toBe(input);

    setVirtualKeyboardVisible(true);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull();
    expect(mocks.unmount).not.toHaveBeenCalled();

    setVirtualKeyboardVisible(false);
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('Unsent comment');
    expect(mocks.mount).toHaveBeenCalledOnce();
  });

  it('stays available for commenting with the keyboard open and responds to focus changes', () => {
    const { input, setEditorHasFocus } = setup();
    input.focus();
    setVirtualKeyboardVisible(true);
    expect(screen.getByRole('textbox')).toBe(input);
    expect(document.activeElement).toBe(input);

    setEditorHasFocus(true);
    expect(screen.queryByRole('textbox')).toBeNull();
    setEditorHasFocus(false);
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('Unsent comment');
    expect(mocks.mount).toHaveBeenCalledOnce();
  });
});
