import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { setVirtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { cleanup, render, screen } from '@solidjs/testing-library';
import {
  batch,
  createSignal,
  For,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentDiscussion } from './DocumentDiscussion';

const mocks = vi.hoisted(() => ({
  mount: vi.fn(),
  unmount: vi.fn(),
  conversation: vi.fn(),
  commentId: (): string | null => null,
  navigationCount: (): number => 0,
  renderedMessageIds: (): string[] => [],
}));

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isFeatureEnabled: () => true,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));
vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => 'document',
    kind: () => 'task',
    permissions: {
      canComment: () => true,
      isOwner: () => false,
    },
  }),
}));
vi.mock('@core/messages/DocumentConversation', () => ({
  DocumentConversation: (props: {
    parent: { type: string; id: string };
    canWrite: boolean;
    buildLink: (message: { id: string }) => string;
    hideComposer?: boolean;
    hideWhenEmpty?: boolean;
    targetCleared?: boolean;
    onClearTarget?: () => void;
  }) => {
    mocks.conversation(props);
    return (
      <For each={mocks.renderedMessageIds()}>
        {(id) => <div data-message-id={id} />}
      </For>
    );
  },
  DocumentConversationComposer: () => {
    mocks.mount();
    onCleanup(mocks.unmount);
    return <textarea aria-label="Comment draft" />;
  },
}));
vi.mock('@core/component/ParamsProvider', () => ({
  useUrlParams: () => ({ commentId: () => mocks.commentId() }),
  useParamNavigationCount: () => () => mocks.navigationCount(),
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
      expect.objectContaining({
        parent: { type: 'document', id: 'document' },
        canWrite: true,
        hideComposer: true,
        hideWhenEmpty: true,
      })
    );
    expect(mocks.mount).toHaveBeenCalledOnce();
  });

  it('builds links from the markdown document kind without a block context', () => {
    setup();
    const conversationProps = mocks.conversation.mock.calls[0][0] as {
      buildLink: (message: { id: string }) => string;
    };
    const link = new URL(conversationProps.buildLink({ id: 'comment' }));

    expect(link.pathname).toBe('/app/task/document');
    expect(link.searchParams.get('comment_id')).toBe('comment');
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

describe('scrolling to a linked Discussion message', () => {
  const scrollIntoView = vi.fn();
  const [commentId, setCommentId] = createSignal<string | null>(null);
  const [navigationCount, setNavigationCount] = createSignal(0);
  const [renderedMessageIds, setRenderedMessageIds] = createSignal<string[]>(
    []
  );
  const flushMutations = () => new Promise((resolve) => setTimeout(resolve));
  const scrolledIds = () =>
    scrollIntoView.mock.contexts.map(
      (element) => (element as HTMLElement).dataset.messageId
    );

  beforeEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
    mocks.commentId = commentId;
    mocks.navigationCount = navigationCount;
    mocks.renderedMessageIds = renderedMessageIds;
    setCommentId(null);
    setNavigationCount(0);
    setRenderedMessageIds([]);
  });

  afterEach(() => {
    scrollIntoView.mockReset();
  });

  const navigate = (id: string) =>
    batch(() => {
      setCommentId(id);
      setNavigationCount((count) => count + 1);
    });

  it('scrolls to the target once it renders after its data loads', async () => {
    setCommentId('m2');
    setup();
    expect(scrollIntoView).not.toHaveBeenCalled();

    setRenderedMessageIds(['m1', 'm2']);
    await flushMutations();

    expect(scrolledIds()).toEqual(['m2']);
  });

  it('scrolls again when a later navigation targets another message', async () => {
    setRenderedMessageIds(['m1', 'm2']);
    setup();
    navigate('m1');
    navigate('m2');
    await flushMutations();

    expect(scrolledIds()).toEqual(['m1', 'm2']);
  });

  it('scrolls again on a repeat navigation to the same message', async () => {
    setRenderedMessageIds(['m1']);
    setup();
    navigate('m1');
    navigate('m1');
    await flushMutations();

    expect(scrolledIds()).toEqual(['m1', 'm1']);
  });

  it('releases the linked message highlight until the next navigation', () => {
    setRenderedMessageIds(['m1']);
    setup();
    navigate('m1');
    const conversation = mocks.conversation.mock.calls[0][0] as {
      targetCleared?: boolean;
      onClearTarget: () => void;
    };
    expect(conversation.targetCleared).toBe(false);

    conversation.onClearTarget();
    expect(conversation.targetCleared).toBe(true);

    navigate('m1');
    expect(conversation.targetCleared).toBe(false);
  });

  it('does not steal scroll on later renders or when the value shows through again', async () => {
    setRenderedMessageIds(['m1']);
    setup();
    navigate('m1');
    await flushMutations();

    setRenderedMessageIds(['m1', 'm2']);
    setCommentId(null);
    setCommentId('m1');
    await flushMutations();

    expect(scrolledIds()).toEqual(['m1']);
  });
});
