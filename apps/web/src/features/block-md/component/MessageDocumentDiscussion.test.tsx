import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { setVirtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, onCleanup, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentDiscussion } from './DocumentDiscussion';

const mocks = vi.hoisted(() => ({
  mount: vi.fn(),
  unmount: vi.fn(),
  conversation: vi.fn(),
}));

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isFeatureEnabled: () => true,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));
vi.mock('@core/block', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBlockId: () => 'document',
  useBlockAliasedName: () => 'md',
}));
vi.mock('@core/messages/DocumentConversation', () => ({
  DocumentConversation: (props: {
    hideComposer?: boolean;
    hideWhenEmpty?: boolean;
  }) => {
    mocks.conversation(props);
    return null;
  },
  DocumentConversationComposer: () => {
    mocks.mount();
    onCleanup(mocks.unmount);
    return <textarea aria-label="Comment draft" />;
  },
}));
vi.mock('@core/signal/permissions', () => ({
  useCanComment: () => () => true,
  useIsDocumentOwner: () => () => false,
}));
vi.mock('@core/component/ParamsProvider', () => ({
  useUrlParams: () => ({ commentId: () => null }),
}));
vi.mock('@channel/Input/ChannelInputContainer', () => ({
  ChannelInputContainer: (props: ParentProps) => props.children,
}));
vi.mock('@core/comments/discussion', () => ({
  DiscussionProvider: (props: ParentProps) => props.children,
  Discussion: () => null,
  DiscussionComposer: () => null,
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

describe('mobile document discussion accessory behind the flag', () => {
  it('moves the composer to the accessory and hides an empty conversation', () => {
    setup();
    expect(mocks.conversation).toHaveBeenCalledWith(
      expect.objectContaining({ hideComposer: true, hideWhenEmpty: true })
    );
    expect(mocks.mount).toHaveBeenCalledOnce();
  });

  it('hides during document typing and restores the same draft when the keyboard closes', () => {
    const { input, setEditorHasFocus } = setup();
    setEditorHasFocus(true);
    expect(screen.getByRole('textbox')).toBe(input);

    setVirtualKeyboardVisible(true);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(mocks.unmount).not.toHaveBeenCalled();

    setVirtualKeyboardVisible(false);
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('Unsent comment');
    expect(mocks.mount).toHaveBeenCalledOnce();
  });
});
