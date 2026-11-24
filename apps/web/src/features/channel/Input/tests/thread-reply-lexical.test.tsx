/**
 * @vitest-environment jsdom
 *
 * The reply composer over the real Lexical editor: a reply read back from
 * storage must send again under the same id.
 */

import { INSERT_USER_MENTION_COMMAND } from '@core/component/LexicalMarkdown/plugins';
import type { IUser } from '@core/user/types';
import { ThrownResultError } from '@core/util/result';
import { render as renderBare } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  getNearestEditorFromDOMNode,
} from 'lexical';
import { createSignal, type JSX, Show } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const editorMocks = vi.hoisted(() => ({
  codexEnabled: false,
  cursorEnabled: false,
  clear: vi.fn(),
  focus: vi.fn(),
  blur: vi.fn(),
  mentionUsers: undefined as (() => IUser[]) | undefined,
  mentionScope: vi.fn<() => IUser[] | undefined>(),
  emitChange: undefined as ((markdown: string) => void) | undefined,
  onEnter: undefined as (() => boolean) | undefined,
  inlineMenuOpen: false,
  onEscape: undefined as ((event?: KeyboardEvent) => boolean) | undefined,
  ignoredActions: [] as string[],
}));

vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({ StaticMarkdown: () => null })
);

vi.mock('@core/hotkey/hotkeys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@core/hotkey/hotkeys')>();
  return {
    ...actual,
    registerHotkey: (options: Parameters<typeof actual.registerHotkey>[0]) => {
      if (options.description === 'block escape from moving up scope') {
        editorMocks.onEscape = options.keyDownHandler;
      }
      return actual.registerHotkey(options);
    },
  };
});

vi.mock('../../../dictation/composer-dictation', () => ({
  createComposerDictation: () => {
    const [active, setActive] = createSignal(false);
    return {
      active,
      phase: () => (active() ? 'listening' : 'idle'),
      volumeHistory: () => [],
      message: () => '',
      label: () => 'Start dictation',
      disabled: () => false,
      start: async () => {
        setActive(true);
      },
      confirm: async () => {
        setActive(false);
      },
      cancel: () => setActive(false),
    };
  },
}));

vi.hoisted(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }),
  });
});

vi.mock('@core/mobile/isMobile', () => ({ isMobile: vi.fn(() => false) }));

const device = vi.hoisted(() => ({ touch: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
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

vi.mock('@core/util/upload', () => ({
  chatRuleset: {},
  uploadFile: vi.fn(),
}));

vi.mock('@core/codex/flag', () => ({
  useCodexAgentsAccess: () => () => editorMocks.codexEnabled,
}));
vi.mock('@core/cursor/flag', () => ({
  useCursorAgentsAccess: () => () => editorMocks.cursorEnabled,
}));

// Several service clients in StaticMarkdown's import graph build websocket
// connections at module scope, which jsdom cannot do. Stub the builder so
// every module-scope socket is inert.
vi.mock('@macro-inc/collaboration/websocket', async (importOriginal) => {
  const actual = await importOriginal<object>();
  const socket = {
    addEventListener: () => {},
    removeEventListener: () => {},
    send: () => {},
    close: () => {},
  };
  const builder: object = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        return prop === 'build' ? () => socket : () => builder;
      },
    }
  );
  return {
    ...actual,
    WebsocketBuilder: function WebsocketBuilder() {
      return builder;
    },
  };
});

vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (type?: string | null) => type ?? 'unknown',
}));

vi.mock('@icon/system/regular/paperclip.svg?component-solid', () => ({
  default: () => <span data-testid="paperclip-icon" />,
}));

vi.mock('@icon/system/regular/text-aa.svg', () => ({
  default: () => <span data-testid="format-icon" />,
}));

vi.mock('@icon/system/regular/trash.svg', () => ({
  default: () => <span data-testid="trash-icon" />,
}));

vi.mock('@icon/system/regular/x.svg', () => ({
  default: () => <span data-testid="close-icon" />,
}));

vi.mock('@icon/system/bold/arrow-up-bold.svg', () => ({
  default: () => <span data-testid="send-icon" />,
}));

vi.mock('@icon/system/regular/paper-plane-right.svg?component-solid', () => ({
  default: () => <span data-testid="paper-plane-icon" />,
}));

vi.mock('@icon/system/regular/spinner-gap.svg', () => ({
  default: () => <span data-testid="spinner-icon" />,
}));

vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: () => <span data-testid="entity-icon" />,
}));

// Input slots do not exercise rich message rendering. Keep collapsed drafts
// outside StaticMarkdown's application/decorator import graph.
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: (props: { markdown: string }) => (
      <span>{props.markdown}</span>
    ),
    StaticMarkdownContext: (props: { children: JSX.Element }) => props.children,
  })
);

vi.mock('@core/component/ImagePreview', () => ({
  ImagePreview: (props: { image: { id: string } }) => (
    <div data-testid={`image-preview-${props.image.id}`} />
  ),
}));

vi.mock('@core/component/VideoPreview', () => ({
  VideoPreview: (props: { id: string }) => (
    <div data-testid={`video-preview-${props.id}`} />
  ),
}));

vi.mock('@core/component/LexicalMarkdown/plugins/tables/tablePlugin', () => ({
  tablePlugin: () => () => () => {},
}));

vi.mock(
  '@core/component/LexicalMarkdown/plugins/tables/tableCellResizerPlugin',
  () => ({
    tableCellResizerPlugin: () => () => () => {},
  })
);

vi.mock('@core/component/LexicalMarkdown/component/menu/MentionsMenu', () => ({
  MentionsMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/ActionsMenu', () => ({
  ActionMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/EmojiMenu', () => ({
  EmojiMenu: () => null,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/FloatingFormatMenu',
  () => ({ FloatingFormatMenu: () => null })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/FloatingGifMenu',
  () => ({ FloatingGifMenu: () => null })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/FloatingLinkMenu',
  () => ({ FloatingLinkMenu: () => null })
);
vi.mock('@core/component/LexicalMarkdown/component/menu/SnippetsMenu', () => ({
  SnippetsMenu: () => null,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/DecoratorRenderer',
  () => ({ DecoratorRenderer: () => null })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/core/NodeAccessoryRenderer',
  () => ({ NodeAccessoryRenderer: () => null })
);

vi.mock('../FormatButtons', () => ({
  FormatButtons: () => <div data-testid="format-buttons" />,
}));

const CHANNEL_MEMBER = { user_id: 'macro|bo@macro.test' };

vi.mock('@queries/channel/channel-participants', () => ({
  useChannelParticipantsQuery: (channelId: () => string) => ({
    isLoading: false,
    get data() {
      return channelId() ? [CHANNEL_MEMBER] : [];
    },
  }),
}));
vi.mock('@core/context/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/context/user')>()),
  useUserId: () => () => 'macro|me@macro.test',
  useIsAuthenticated: () => () => true,
}));
const sendMocks = vi.hoisted(() => ({
  send: vi.fn((_input: { optimisticId: string }) => Promise.resolve()),
  next: 0,
}));
vi.mock('@queries/messages/mutations', async () => {
  const { useMutation } = await import('@tanstack/solid-query');
  return {
    // A real mutation: its per-call callbacks die with the composer, as in the app.
    useSendMessageMutation: () =>
      useMutation(() => ({
        mutationFn: (input: { optimisticId: string }) => sendMocks.send(input),
      })),
    newMessageId: () => `message-${++sendMocks.next}`,
  };
});
vi.mock('@queries/messages/typing', () => ({
  usePostTypingUpdateMutation: () => ({ mutate: vi.fn() }),
}));

import {
  clearComposerStorage,
  endComposerStorageClear,
} from '@core/auth/clear-composer-storage';
import { uploadFile } from '@core/util/upload';
import type { MessageParent } from '@service-storage/messages';
import {
  applyQuoteText,
  currentReplyDraft,
  replyDraftKeys,
} from '../../Thread/reply-drafts';
import { ThreadReplyChannelInput } from '../../Thread/ThreadReplyChannelInput';
import { buildReplyTargetValue } from '../../Thread/utils/message-actions';
import type { InputHandle, InputSnapshot } from '../types';

// Provide query context for the composed input and its decorators.
const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function render(ui: () => JSX.Element) {
  return renderBare(() => (
    <QueryClientProvider client={testQueryClient}>{ui()}</QueryClientProvider>
  ));
}

describe('Thread reply sends through the real editor', () => {
  const unknown = new ThrownResultError([
    { code: 'DELIVERY_UNKNOWN', message: 'could not confirm' },
  ]);
  const nextFrame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  /** The next send stays pending until the returned function fails it. */
  const holdNextSend = () => {
    let fail: (error: unknown) => void = () => {};
    sendMocks.send.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    return (error: unknown) => fail(error);
  };
  const sentIds = () =>
    sendMocks.send.mock.calls.map(([input]) => input.optimisticId);

  beforeEach(() => {
    localStorage.clear();
    sendMocks.send.mockClear();
  });

  /** One reply input on a thread, opened and closed like a thread's reply. */
  function mountReply(parent: MessageParent, threadId: string) {
    const [state, setState] = createSignal<InputSnapshot | undefined>();
    const [open, setOpen] = createSignal(true);
    const reply = {
      handle: undefined as InputHandle | undefined,
      open,
      setOpen,
      state,
      setState,
    };
    const view = () => (
      <Show when={open()}>
        <ThreadReplyChannelInput
          parent={parent}
          threadId={threadId}
          replyInputState={state}
          setReplyInputState={setState}
          onExit={() => setOpen(false)}
          onReady={(next) => {
            reply.handle = next;
          }}
        />
      </Show>
    );
    return { reply, view };
  }

  const editor = () =>
    getNearestEditorFromDOMNode(
      document.querySelector('[data-markdown-editable]')!
    )!;

  it('keeps a reply’s id when its mentions come back from storage in another order', async () => {
    const { reply, view } = mountReply(
      { type: 'channel', id: 'channel-mentions' },
      'thread-a'
    );
    render(view);
    await nextFrame();
    const fail = holdNextSend();
    const firstEditor = editor();
    firstEditor.update(
      () => {
        $getRoot().clear().append($createParagraphNode());
        $getRoot().selectEnd();
      },
      { discrete: true }
    );
    firstEditor.dispatchCommand(INSERT_USER_MENTION_COMMAND, {
      userId: 'macro|a@macro.test',
      email: 'a@macro.test',
    });
    firstEditor.read(() => {});
    firstEditor.update(
      () => {
        $getRoot().getFirstChildOrThrow().selectStart();
      },
      { discrete: true }
    );
    firstEditor.dispatchCommand(INSERT_USER_MENTION_COMMAND, {
      userId: 'macro|b@macro.test',
      email: 'b@macro.test',
    });
    firstEditor.read(() => {});
    const original = reply.handle!.snapshot();
    expect(original.mentions.map((mention) => mention.itemId)).toEqual([
      'macro|a@macro.test',
      'macro|b@macro.test',
    ]);
    expect(await reply.handle?.send()).toBe(true);
    fail(unknown);
    await nextFrame();
    reply.setOpen(true);
    await nextFrame();
    expect(reply.handle!.snapshot().value).toBe(original.value);
    expect(await reply.handle?.send()).toBe(true);
    expect(sentIds()[1]).toBe(sentIds()[0]);
  });

  it('keeps a reply’s id when another open view reads its draft back', async () => {
    const parent = { type: 'channel', id: 'channel-roundtrip' } as const;
    const first = mountReply(parent, 'thread-a');
    const second = mountReply(parent, 'thread-a');
    second.reply.setOpen(false);
    render(() => (
      <>
        {first.view()}
        {second.view()}
      </>
    ));
    await nextFrame();
    const fail = holdNextSend();
    editor().update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append($createTextNode('  padded text  '))
          );
      },
      { discrete: true }
    );
    const original = first.reply.handle!.snapshot();
    expect(original.value).toBe('  padded text  ');
    expect(await first.reply.handle?.send()).toBe(true);
    second.reply.setOpen(true);
    await nextFrame();
    fail(unknown);
    await nextFrame();
    expect(second.reply.handle!.snapshot().value).toBe(original.value);
    expect(await second.reply.handle?.send()).toBe(true);
    expect(sentIds()[1]).toBe(sentIds()[0]);
  });

  it('stores a failed reply while a view with no editor in the page holds its thread', async () => {
    const parent = { type: 'channel', id: 'channel-detached' } as const;
    const first = mountReply(parent, 'thread-a');
    const detached = mountReply(parent, 'thread-a');
    render(first.view);
    await nextFrame();
    const fail = holdNextSend();
    editor().update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append(
              $createTextNode('Persist the failed reply')
            )
          );
      },
      { discrete: true }
    );
    expect(await first.reply.handle?.send()).toBe(true);
    const container = document.createElement('div');
    const other = renderBare(
      () => (
        <QueryClientProvider client={testQueryClient}>
          {detached.view()}
        </QueryClientProvider>
      ),
      { container }
    );
    expect(detached.reply.handle).toBeDefined();
    expect(container.isConnected).toBe(false);
    fail(unknown);
    await nextFrame();
    other.unmount();
    first.reply.setOpen(true);
    await nextFrame();
    expect(first.reply.handle?.snapshot().value).toBe(
      'Persist the failed reply'
    );
  });

  /** The quote a reply action builds on `existing`, the thread's draft. */
  const quoteOf = (
    parent: MessageParent,
    threadId: string,
    existing?: string
  ) =>
    buildReplyTargetValue({
      channelId: parent.id,
      message: {
        id: 'quoted-reply',
        thread_id: threadId,
        sender_id: 'macro|b@macro.test',
        content: 'Quoted text',
      },
      existingValue: existing,
    });

  it('sends the mentions of a draft read back from storage into a quote', async () => {
    const parent = { type: 'channel', id: 'quote-mentions' } as const;
    const threadId = 'quote-thread';
    const first = mountReply(parent, threadId);
    const other = mountReply(parent, threadId);
    other.reply.setOpen(false);
    render(() => (
      <>
        {first.view()}
        {other.view()}
      </>
    ));
    await nextFrame();
    const firstEditor = editor();
    firstEditor.update(
      () => {
        $getRoot().clear().append($createParagraphNode());
        $getRoot().selectEnd();
      },
      { discrete: true }
    );
    firstEditor.dispatchCommand(INSERT_USER_MENTION_COMMAND, {
      userId: 'macro|a@macro.test',
      email: 'a@macro.test',
    });
    firstEditor.read(() => {});
    first.reply.setOpen(false);

    // A draft read back from storage carries no mentions.
    const stored = currentReplyDraft(
      replyDraftKeys(parent, threadId),
      other.reply.state()
    );
    expect(stored?.mentions).toEqual([]);
    const quote = {
      value: quoteOf(parent, threadId, stored?.value),
      attachments: stored?.attachments ?? [],
      mentions: stored?.mentions ?? [],
    };
    other.reply.setState(quote);
    other.reply.setOpen(true);
    await nextFrame();
    other.reply.handle?.restoreSnapshot(quote, { focus: false });
    expect(await other.reply.handle?.send()).toBe(true);

    expect(sendMocks.send.mock.calls[0]?.[0]).toMatchObject({
      message: {
        mentions: [{ entity_id: 'macro|a@macro.test', entity_type: 'user' }],
      },
    });
  });

  it('keeps an upload that finished after a quote read the draft', async () => {
    const parent = { type: 'channel', id: 'attachment-quote' } as const;
    const threadId = 'attachment-quote-thread';
    const { reply, view } = mountReply(parent, threadId);
    render(view);
    await nextFrame();
    const upload =
      Promise.withResolvers<Awaited<ReturnType<typeof uploadFile>>>();
    vi.mocked(uploadFile).mockImplementationOnce(() => upload.promise);
    const attaching = reply.handle!.attachFiles([
      new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    ]);
    const before = currentReplyDraft(
      replyDraftKeys(parent, threadId),
      reply.state()
    );
    expect(before?.attachments).toMatchObject([{ pending: true }]);
    const quote = quoteOf(parent, threadId, before?.value);

    upload.resolve({
      failed: false,
      pending: false,
      destination: 'static',
      id: 'uploaded',
      name: 'notes.txt',
    });
    await attaching;
    applyQuoteText(reply.handle, quote);

    const applied = reply.handle?.snapshot();
    expect(applied?.value).toContain('quoted-reply');
    expect(applied?.attachments).toMatchObject([{ id: 'uploaded' }]);
  });

  it('writes nothing back from a reply opened while sign-out clears drafts', async () => {
    const parent = { type: 'channel', id: 'logout' } as const;
    const threadId = 'logout-thread';
    const keys = replyDraftKeys(parent, threadId);
    localStorage.setItem(
      keys.attachments,
      JSON.stringify([
        { id: 'attachment-a', kind: 'document', name: 'notes.md' },
      ])
    );
    const first = mountReply(parent, threadId);
    const other = mountReply(parent, threadId);
    other.reply.setOpen(false);
    render(() => (
      <>
        {first.view()}
        {other.view()}
      </>
    ));
    await nextFrame();
    editor().update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode('unsent')));
      },
      { discrete: true }
    );

    try {
      // Sign-out clears drafts before it publishes the signed-out user; the
      // open view keeps its text in between.
      clearComposerStorage();
      other.reply.setOpen(true);
      await nextFrame();
      const failDuring = holdNextSend();
      expect(await other.reply.handle?.send()).toBe(true);
      failDuring(unknown);
      await nextFrame();
      expect(localStorage.getItem(keys.text)).toBeNull();
      expect(localStorage.getItem(keys.attachments) ?? '[]').toBe('[]');
    } finally {
      endComposerStorageClear();
    }

    other.reply.setOpen(false);
    other.reply.setOpen(true);
    await nextFrame();
    expect(localStorage.getItem(keys.text)).toBeNull();
    expect(localStorage.getItem(keys.attachments) ?? '[]').toBe('[]');
  });
});
