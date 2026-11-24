/**
 * @vitest-environment jsdom
 */

import {
  clearComposerStorage,
  endComposerStorageClear,
} from '@core/auth/clear-composer-storage';
import type { MentionsOptions } from '@core/component/LexicalMarkdown/builder/types';
import { isMobile } from '@core/mobile/isMobile';
import type { IUser } from '@core/user/types';
import { ThrownResultError } from '@core/util/result';
import {
  fireEvent,
  render as renderBare,
  screen,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import userEvent from '@testing-library/user-event';
import { createSignal, type JSX, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
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

vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: (props: {
    placeholder?: string;
    initialValue?: string;
    value?: string;
    onConnect?: () => void;
  }) => {
    onMount(() => {
      // Like the real shell, only an uncontrolled editor reports its initial
      // value; a controlled one already holds it.
      if (props.value === undefined)
        editorMocks.emitChange?.(props.initialValue ?? '');
      props.onConnect?.();
    });
    return (
      <>
        <div
          data-testid="markdown-shell"
          data-initial-value={props.value ?? props.initialValue ?? ''}
        >
          {props.placeholder}
        </div>
        <Portal>
          <input data-testid="markdown-portal-input" />
        </Portal>
      </>
    );
  },
}));

vi.mock(
  '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder',
  () => ({
    buildConfig: () => {
      const controls = {
        clear: editorMocks.clear,
        focus: editorMocks.focus,
        isInlineMenuOpen: () => editorMocks.inlineMenuOpen,
        setMarkdown: (markdown: string) => {
          editorMocks.emitChange?.(markdown);
        },
      };
      const lexical = {
        focus: vi.fn(),
        blur: editorMocks.blur,
        dispatchCommand: vi.fn(),
        getElementByKey: vi.fn(),
        getRootElement: vi.fn(),
        update: vi.fn((callback: () => void) => callback()),
        read: <T,>(callback: () => T) => callback(),
      };
      const handle = {
        controls,
        lexical,
        plugins: { use: vi.fn() },
        selection: undefined,
        _internal: {},
      };
      const builder: any = {
        namespace: () => builder,
        withMentions: (options: MentionsOptions) => {
          editorMocks.mentionScope.mockImplementation(() => options.users?.());
          editorMocks.mentionUsers = () => {
            // Stand in for one loaded window, not a whole directory.
            const users = options.users?.() ?? [CONTACT];
            return options.transformUsers?.(users) ?? users;
          };
          return builder;
        },
        withEmojis: () => builder,
        withActions: (options?: { ignoreActionIds?: string[] }) => {
          editorMocks.ignoredActions.push(...(options?.ignoreActionIds ?? []));
          return builder;
        },
        withLinks: () => builder,
        withHistory: () => builder,
        withCode: () => builder,
        withFilePaste: () => builder,
        withRestoreFocus: () => builder,
        withSelectionData: () => builder,
        withFloatingFormatMenu: () => builder,
        use: () => builder,
        onChange: (handler: (markdown: string) => void) => {
          editorMocks.emitChange = handler;
          return builder;
        },
        onEnter: (handler: () => boolean) => {
          editorMocks.onEnter = handler;
          return builder;
        },
        buildHandle: () => handle,
        controls,
        lexical,
        selection: undefined,
      };
      return builder;
    },
  })
);

vi.mock('@core/component/LexicalMarkdown/plugins', () => ({
  createDragInsertStore: () => [
    { nodeKey: null, position: null, visible: false },
    vi.fn(),
  ],
  DefaultShortcuts: {},
  INSERT_DOCUMENT_MENTION_COMMAND: 'INSERT_DOCUMENT_MENTION_COMMAND',
  NODE_TRANSFORM: 'NODE_TRANSFORM',
  $readItemMentions: () => [],
  keyboardShortcutsPlugin: () => () => () => {},
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

vi.mock('../FormatButtons', () => ({
  FormatButtons: () => <div data-testid="format-buttons" />,
}));

const CONTACT = {
  id: 'macro|ann@macro.test',
  name: 'Ann',
  email: 'ann@macro.test',
};
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

import { MACRO_NEW_PRINCIPAL_ID } from '@core/constant/macroNew';
import type { MessageParent } from '@service-storage/messages';
import { codexMentionUser, cursorMentionUser } from '../../macroAi';
import { currentReplyDraft, replyDraftKeys } from '../../Thread/reply-drafts';
import { ThreadReplyChannelInput } from '../../Thread/ThreadReplyChannelInput';
import { buildReplyTargetValue } from '../../Thread/utils/message-actions';
import { createInputAttachmentTracker } from '../attachment-tracker';
import { ChannelInput } from '../ChannelInput';
import { DropOverlay } from '../DropOverlay';
import { Root } from '../Root';
import type { InputData, InputHandle, InputSnapshot } from '../types';

const baseInput: InputData = {
  mode: 'channel',
  id: 'input-1',
  placeholder: 'Message channel',
  value: '',
  showFormatRibbon: false,
  hasPendingAttachments: false,
  attachments: [],
};

// Provide query context for the composed input and its decorators.
const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function render(ui: () => JSX.Element) {
  return renderBare(() => (
    <QueryClientProvider client={testQueryClient}>{ui()}</QueryClientProvider>
  ));
}

describe('Input slots', () => {
  beforeEach(() => {
    editorMocks.codexEnabled = false;
    editorMocks.cursorEnabled = false;
    editorMocks.clear.mockClear();
    editorMocks.focus.mockClear();
    editorMocks.blur.mockClear();
    editorMocks.emitChange = undefined;
    editorMocks.onEnter = undefined;
    editorMocks.inlineMenuOpen = false;
    editorMocks.onEscape = undefined;
    editorMocks.mentionUsers = undefined;
    editorMocks.mentionScope.mockReset();
    device.touch = false;
    editorMocks.ignoredActions = [];
    vi.mocked(isMobile).mockReturnValue(false);
  });

  it('blocks handle and keyboard sends during dictation without clearing the draft', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    let handle: InputHandle | undefined;
    const { container } = render(() => (
      <ChannelInput
        input={{ ...baseInput, value: 'existing draft' }}
        onReady={(value) => {
          handle = value;
        }}
        onSend={onSend}
      />
    ));

    await user.click(screen.getByRole('button', { name: 'Start dictation' }));
    expect(container.querySelector('[data-input-layout]')).toHaveProperty(
      'inert',
      true
    );
    await handle?.send();
    editorMocks.onEnter?.();
    expect(onSend).not.toHaveBeenCalled();
    expect(editorMocks.clear).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Dictation' })).toBeNull();
    await handle?.send();
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]?.[0]?.value).toBe('existing draft');
  });

  it('handles dictation and inline menus before dismissing the composer host on Escape', async () => {
    const user = userEvent.setup();
    const closeHost = vi.fn();
    render(() => <ChannelInput input={baseInput} onEscape={closeHost} />);

    await user.click(screen.getByRole('button', { name: 'Start dictation' }));
    expect(editorMocks.onEscape?.()).toBe(true);
    expect(screen.queryByRole('group', { name: 'Dictation' })).toBeNull();
    expect(closeHost).not.toHaveBeenCalled();

    editorMocks.inlineMenuOpen = true;
    expect(editorMocks.onEscape?.()).toBe(true);
    expect(closeHost).not.toHaveBeenCalled();
    expect(editorMocks.blur).not.toHaveBeenCalled();

    editorMocks.inlineMenuOpen = false;
    expect(editorMocks.onEscape?.()).toBe(true);
    expect(closeHost).toHaveBeenCalledOnce();
    // The editor lets go of its selection, so it cannot pull focus back.
    expect(editorMocks.blur).toHaveBeenCalledOnce();
  });

  it('lets Escape continue when there is no menu, dictation, or host handler', () => {
    render(() => <ChannelInput input={baseInput} />);
    expect(editorMocks.onEscape?.()).toBe(false);
  });

  it('omits the microphone on touch devices, whose keyboards dictate', () => {
    device.touch = true;
    vi.mocked(isMobile).mockReturnValue(true);
    const collapsed = render(() => (
      <ChannelInput input={baseInput} collapsible />
    ));
    expect(
      collapsed.container.querySelector('[data-composer-collapsed]')
    ).toBeTruthy();
    expect(
      collapsed.queryByRole('button', { name: 'Start dictation' })
    ).toBeNull();

    const expanded = render(() => <ChannelInput input={baseInput} />);
    expect(
      expanded.queryByRole('button', { name: 'Start dictation' })
    ).toBeNull();
  });

  it('previews a collapsed draft’s attachments before its text and opens the composer from them', async () => {
    const user = userEvent.setup();
    device.touch = true;
    vi.mocked(isMobile).mockReturnValue(true);
    const { container } = render(() => (
      <ChannelInput
        input={{ ...baseInput, value: 'see attached' }}
        attachmentTracker={createInputAttachmentTracker({
          initialAttachments: [
            { id: 'image-1', name: 'photo.png', kind: 'image' },
            { id: 'doc-1', name: 'notes.pdf', kind: 'document' },
            { id: 'image-2', name: 'photo-2.png', kind: 'image' },
          ],
        })}
        collapsible
      />
    ));

    const preview = screen.getByRole('img', { name: '3 attachments' });
    expect(preview.textContent).toBe('3');
    const collapsedInput = preview.closest('button');
    expect(collapsedInput?.textContent).toContain('see attached');
    expect(screen.queryByRole('button', { name: '3 attachments' })).toBeNull();

    await user.click(collapsedInput as HTMLElement);
    expect(container.querySelector('[data-composer-collapsed]')).toBeNull();
  });

  it('offers Cursor and Codex within their rollouts before account setup', () => {
    editorMocks.cursorEnabled = true;
    editorMocks.codexEnabled = true;
    render(() => <ChannelInput input={baseInput} />);
    expect(editorMocks.mentionUsers?.().map((user) => user.name)).toEqual(
      expect.arrayContaining(['Cursor', 'Codex'])
    );
  });

  it('offers one Macro entry in call chat', () => {
    render(() => (
      <ChannelInput
        input={baseInput}
        parent={{ type: 'call', id: 'call-1' }}
        bots={() => [
          { id: 'bot|owned', name: 'Owned agent', email: 'Owned agent' },
          { id: 'bot|team', name: 'Team agent', email: 'Team agent' },
        ]}
      />
    ));
    const users = editorMocks.mentionUsers?.() ?? [];
    expect(
      users.filter((user) => user.name === 'Macro').map((user) => user.id)
    ).toEqual([MACRO_NEW_PRINCIPAL_ID]);
    expect(users.map((user) => user.id)).toEqual(
      expect.arrayContaining(['bot|owned', 'bot|team'])
    );
  });

  it('offers a single Macro mention aimed at the agent bot', () => {
    render(() => <ChannelInput input={baseInput} />);
    expect(
      editorMocks.mentionUsers?.().filter((user) => user.name === 'Macro')
    ).toEqual([
      {
        id: MACRO_NEW_PRINCIPAL_ID,
        name: 'Macro',
        email: 'Macro',
      },
    ]);
  });

  it('hides Cursor and Codex outside their rollouts, including supplied bot entries', () => {
    const builtIns = () => [cursorMentionUser(), codexMentionUser()];
    render(() => (
      <ChannelInput input={baseInput} participants={builtIns} bots={builtIns} />
    ));
    const names = editorMocks.mentionUsers?.().map((user) => user.name);
    expect(names).not.toContain('Cursor');
    expect(names).not.toContain('Codex');
  });

  it('does not start typing when the editor hydrates an empty composer', async () => {
    const onStartTyping = vi.fn();
    render(() => (
      <ChannelInput input={baseInput} onStartTyping={onStartTyping} />
    ));

    await Promise.resolve();
    expect(onStartTyping).not.toHaveBeenCalled();

    editorMocks.emitChange?.('hello');
    expect(onStartTyping).toHaveBeenCalledTimes(1);
  });

  it('does not start typing when hydrate echoes an existing draft', async () => {
    const onStartTyping = vi.fn();
    render(() => (
      <ChannelInput
        input={{ ...baseInput, value: 'draft' }}
        onStartTyping={onStartTyping}
      />
    ));

    await Promise.resolve();
    expect(onStartTyping).not.toHaveBeenCalled();

    editorMocks.emitChange?.('draft');
    expect(onStartTyping).not.toHaveBeenCalled();

    editorMocks.emitChange?.('draft plus');
    expect(onStartTyping).toHaveBeenCalledTimes(1);
  });

  it('does not start typing when a snapshot is restored', async () => {
    const onStartTyping = vi.fn();
    let handle: InputHandle | undefined;
    render(() => (
      <ChannelInput
        input={baseInput}
        onReady={(nextHandle) => {
          handle = nextHandle;
        }}
        onStartTyping={onStartTyping}
      />
    ));

    await Promise.resolve();
    handle?.restoreSnapshot({
      value: 'restored draft',
      mentions: [],
      attachments: [],
    });
    expect(onStartTyping).not.toHaveBeenCalled();

    await Promise.resolve();
    editorMocks.emitChange?.('user typed');
    expect(onStartTyping).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'rechecks deferred focus before editor connection (current: %s)',
    async (current) => {
      let focusCurrent = true;
      render(() => (
        <ChannelInput
          input={baseInput}
          onReady={(handle) => {
            handle.focus({ when: () => focusCurrent });
            focusCurrent = current;
          }}
        />
      ));
      await Promise.resolve();
      expect(editorMocks.focus).toHaveBeenCalledTimes(current ? 1 : 0);
    }
  );

  it('does not refocus the editor when a portaled editor control is clicked', async () => {
    const user = userEvent.setup();
    render(() => <ChannelInput input={baseInput} />);

    await user.click(screen.getByTestId('markdown-shell'));
    expect(editorMocks.focus).toHaveBeenCalledOnce();

    editorMocks.focus.mockClear();
    await user.click(screen.getByTestId('markdown-portal-input'));

    expect(editorMocks.focus).not.toHaveBeenCalled();
  });

  it('waits for touch release before sending a channel message', async () => {
    vi.mocked(isMobile).mockReturnValue(true);
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(() => (
      <ChannelInput
        input={{ ...baseInput, value: 'Send on release' }}
        onSend={onSend}
      />
    ));
    const button = screen.getByRole('button', { name: 'Send message' });
    await user.pointer({ target: button, keys: '[TouchA>]' });
    expect(onSend).not.toHaveBeenCalled();
    await user.pointer({ keys: '[/TouchA]' });
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]?.[0]?.value).toBe('Send on release');
  });

  it('does not send a cancelled press and still accepts an assistive click', () => {
    const onSend = vi.fn();
    render(() => (
      <ChannelInput
        input={{ ...baseInput, value: 'Keep this draft' }}
        onSend={onSend}
      />
    ));
    const button = screen.getByRole('button', { name: 'Send message' });
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    fireEvent.pointerCancel(button, { pointerType: 'touch' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(button, { detail: 0 });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('renders the default action composition and wires handlers through context', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onToggleFormatRibbon = vi.fn();
    const onClose = vi.fn();

    const { container } = render(() =>
      (() => {
        return (
          <ChannelInput
            input={{ ...baseInput, mode: 'reply', value: 'reply' }}
            onSend={onSend}
            onToggleFormatRibbon={onToggleFormatRibbon}
            onClose={onClose}
          />
        );
      })()
    );

    const layout = container.querySelector('[data-input-layout]');
    expect(
      container.querySelector('[data-input-actions-left]')?.parentElement
    ).toBe(layout);
    expect(
      container.querySelector('[data-input-actions-right]')?.parentElement
    ).toBe(layout);

    await user.click(screen.getByRole('button', { name: 'Send message' }));
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    expect(screen.queryByRole('button', { name: 'Format' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Delete reply' }));
    // The menu is modal, so it opens last.
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual(
      expect.arrayContaining([
        'Mention@',
        'Attach files',
        'New task',
        'New document',
      ])
    );
    await user.click(screen.getByRole('menuitem', { name: 'Attach files' }));

    expect(onSend).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    clickSpy.mockRestore();
    expect(onToggleFormatRibbon).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]?.[0]?.value).toBe('reply');
  });

  it('offers only text, formatting and files when a host switches features off', async () => {
    const user = userEvent.setup();
    render(() => (
      <ChannelInput
        input={baseInput}
        features={{
          mentions: false,
          createItems: false,
          gifs: false,
          richBlocks: false,
        }}
      />
    ));
    expect(editorMocks.mentionUsers).toBeUndefined();
    expect(editorMocks.ignoredActions).toEqual(
      expect.arrayContaining(['task', 'document', 'gif', 'table', 'heading1'])
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual(['Attach files']);
  });

  it('omits the reply action for channel mode', () => {
    render(() => <ChannelInput input={baseInput} />);

    expect(screen.queryByRole('button', { name: 'Delete reply' })).toBeNull();
  });

  it('renders custom action composition from children instead of defaults', () => {
    render(() => (
      <ChannelInput input={baseInput}>
        <div data-testid="custom-actions">custom actions</div>
      </ChannelInput>
    ));

    expect(screen.getByTestId('custom-actions')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
  });

  it('disables send while attachments are pending', () => {
    render(() =>
      (() => {
        const attachmentTracker = createInputAttachmentTracker({
          initialAttachments: [
            {
              id: 'pending-1',
              name: 'uploading.png',
              kind: 'image',
              pending: true,
            },
          ],
        });

        return (
          <ChannelInput
            input={baseInput}
            attachmentTracker={attachmentTracker}
          />
        );
      })()
    );

    expect(screen.getByRole('button', { name: 'Send message' })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('disables send when the input is empty', () => {
    render(() => <ChannelInput input={{ ...baseInput, value: '   ' }} />);

    expect(screen.getByRole('button', { name: 'Send message' })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('exposes send through the input handle', async () => {
    const onSend = vi.fn();
    let handle: InputHandle | undefined;

    render(() => (
      <ChannelInput
        input={{ ...baseInput, value: 'handle send' }}
        onReady={(nextHandle) => {
          handle = nextHandle;
        }}
        onSend={onSend}
      />
    ));

    await handle?.send();

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]?.[0]?.value).toBe('handle send');
  });

  it('shows the drop overlay when dragged over', () => {
    render(() => (
      <Root input={{ ...baseInput, isDraggedOver: true }}>
        <DropOverlay hint="Drop files to attach" />
      </Root>
    ));

    expect(screen.getByText('Drop files to attach')).toBeTruthy();
  });

  it('drops the inline reply margin from a flat composer', () => {
    const replyInput: InputData = { ...baseInput, mode: 'reply' };
    const { container: inline } = render(() => (
      <ChannelInput input={replyInput} />
    ));
    const { container: flat } = render(() => (
      <ChannelInput input={replyInput} flat />
    ));

    expect(inline.querySelector('[data-input]')?.classList).toContain('mb-4');
    const flatRoot = flat.querySelector('[data-input]');
    expect(flatRoot?.classList).not.toContain('mb-4');
    expect(flatRoot?.classList).toContain('mb-0');
  });
});

/**
 * Mention people reach the shared input from its `parent`, so every composer
 * on a document — root, reply, and edit — offers the same people. The
 * document composers regressed once by relying on each call site to pass
 * them: a document reply offered agents and bots but no People at all.
 */
describe('mention people', () => {
  const documentParent = { type: 'document', id: 'doc-1' } as const;
  const channelParent = { type: 'channel', id: 'channel-1' } as const;
  const mentionIds = () => editorMocks.mentionUsers?.().map((user) => user.id);

  beforeEach(() => {
    editorMocks.mentionUsers = undefined;
    editorMocks.mentionScope.mockReset();
  });

  it('delegates a document composer to the bounded workspace window', () => {
    render(() => <ChannelInput input={baseInput} parent={documentParent} />);
    expect(mentionIds()).toContain(CONTACT.id);
    expect(editorMocks.mentionScope()).toBeUndefined();
  });

  it('offers a channel composer its participants, not the workspace contacts', () => {
    render(() => <ChannelInput input={baseInput} parent={channelParent} />);

    expect(mentionIds()).toContain(CHANNEL_MEMBER.user_id);
    expect(mentionIds()).not.toContain(CONTACT.id);
    expect(editorMocks.mentionScope()?.map((user) => user.id)).toContain(
      CHANNEL_MEMBER.user_id
    );
  });

  it('keeps an explicitly supplied participants list', () => {
    render(() => (
      <ChannelInput
        input={baseInput}
        parent={documentParent}
        participants={() => []}
      />
    ));

    expect(mentionIds()).not.toContain(CONTACT.id);
  });

  it('offers people in a document thread reply composer', () => {
    render(() => (
      <ThreadReplyChannelInput
        parent={documentParent}
        threadId="root-1"
        replyInputState={() => undefined}
        setReplyInputState={() => undefined}
        onExit={() => {}}
      />
    ));

    expect(mentionIds()).toContain(CONTACT.id);
  });
});

describe('Thread reply sends', () => {
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
    // A test that signs out leaves the sign-out it started finished.
    endComposerStorageClear();
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

  it('restores a reply of unknown delivery after its composer closed, and sends it again under its id', async () => {
    const { reply, view } = mountReply(
      { type: 'channel', id: 'channel-2' },
      'root-2'
    );
    render(view);
    await nextFrame();
    const fail = holdNextSend();
    editorMocks.emitChange?.('did this arrive?');
    expect(await reply.handle?.send()).toBe(true);
    expect(reply.open()).toBe(false);

    fail(unknown);
    await nextFrame();
    reply.setOpen(true);
    await nextFrame();

    expect(reply.handle?.snapshot().value).toBe('did this arrive?');
    await reply.handle?.send();
    expect(sentIds()).toHaveLength(2);
    expect(sentIds()[1]).toBe(sentIds()[0]);
  });

  it('keeps a newer draft of the same reply typed in another view', async () => {
    const parent = { type: 'channel', id: 'channel-3' } as const;
    const first = mountReply(parent, 'root-3');
    const second = mountReply(parent, 'root-3');
    second.reply.setOpen(false);
    render(() => (
      <>
        {first.view()}
        {second.view()}
      </>
    ));
    await nextFrame();
    const fail = holdNextSend();
    editorMocks.emitChange?.('first reply');
    expect(await first.reply.handle?.send()).toBe(true);
    second.reply.setOpen(true);
    await nextFrame();
    editorMocks.emitChange?.('new reply in the second view');

    fail(unknown);
    await nextFrame();
    first.reply.setOpen(true);
    await nextFrame();

    expect(second.reply.handle?.snapshot().value).toBe(
      'new reply in the second view'
    );
    expect(first.reply.handle?.snapshot().value).toBe(
      'new reply in the second view'
    );
  });

  it('restores a reply into the thread opened again after its whole channel view closed', async () => {
    const parent = { type: 'channel', id: 'channel-4' } as const;
    const [channelOpen, setChannelOpen] = createSignal(true);
    let latest: ReturnType<typeof mountReply> | undefined;
    function ChannelView() {
      latest = mountReply(parent, 'root-4');
      return latest.view();
    }
    render(() => (
      <Show when={channelOpen()}>
        <ChannelView />
      </Show>
    ));
    await nextFrame();
    const fail = holdNextSend();
    editorMocks.emitChange?.('reply before leaving');
    expect(await latest?.reply.handle?.send()).toBe(true);
    setChannelOpen(false);
    setChannelOpen(true);
    await nextFrame();

    fail(unknown);
    await nextFrame();

    expect(latest?.reply.handle?.snapshot().value).toBe('reply before leaving');
  });
  /** Sends `text` on `reply`, fails it as of unknown delivery, and reopens. */
  async function failAndReopen(
    reply: ReturnType<typeof mountReply>['reply'],
    text: string
  ) {
    const fail = holdNextSend();
    editorMocks.emitChange?.(text);
    expect(await reply.handle?.send()).toBe(true);
    fail(unknown);
    await nextFrame();
    reply.setOpen(true);
    await nextFrame();
  }

  it('sends the same words under a new id once another reply went to the thread', async () => {
    const { reply, view } = mountReply(
      { type: 'channel', id: 'channel-5' },
      'root-5'
    );
    render(view);
    await nextFrame();
    await failAndReopen(reply, 'Thanks');
    expect(reply.handle?.snapshot().value).toBe('Thanks');

    editorMocks.emitChange?.('Something else');
    await reply.handle?.send();
    reply.setOpen(true);
    await nextFrame();
    editorMocks.emitChange?.('Thanks');
    await reply.handle?.send();

    expect(sentIds()).toHaveLength(3);
    expect(new Set(sentIds()).size).toBe(3);
  });

  it('keeps a reply’s id while a draft is typed in another thread of the channel', async () => {
    const parent = { type: 'channel', id: 'channel-6' } as const;
    const first = mountReply(parent, 'root-6a');
    const other = mountReply(parent, 'root-6b');
    other.reply.setOpen(false);
    render(() => (
      <>
        {first.view()}
        {other.view()}
      </>
    ));
    await nextFrame();
    const fail = holdNextSend();
    editorMocks.emitChange?.('first reply');
    expect(await first.reply.handle?.send()).toBe(true);
    fail(unknown);
    await nextFrame();

    other.reply.setOpen(true);
    await nextFrame();
    editorMocks.emitChange?.('draft in another thread');
    first.reply.setOpen(true);
    await nextFrame();

    expect(first.reply.handle?.snapshot().value).toBe('first reply');
    expect(await first.reply.handle?.send()).toBe(true);
    expect(sentIds()[1]).toBe(sentIds()[0]);
  });

  it('keeps an unchanged reply’s id with its attachment', async () => {
    const parent = { type: 'channel', id: 'channel-7' } as const;
    localStorage.setItem(
      replyDraftKeys(parent, 'root-7').attachments,
      JSON.stringify([
        { id: 'attachment-a', kind: 'document', name: 'notes.md' },
      ])
    );
    const { reply, view } = mountReply(parent, 'root-7');
    render(view);
    await nextFrame();
    await failAndReopen(reply, 'See attachment');

    expect(reply.handle?.snapshot()).toMatchObject({
      value: 'See attachment',
      attachments: [{ id: 'attachment-a' }],
    });
    expect(await reply.handle?.send()).toBe(true);
    expect(sentIds()[1]).toBe(sentIds()[0]);
  });

  it('writes no draft back once composer storage was cleared at sign-out', async () => {
    const parent = { type: 'channel', id: 'channel-8' } as const;
    const { reply, view } = mountReply(parent, 'root-8');
    render(view);
    await nextFrame();
    const fail = holdNextSend();
    editorMocks.emitChange?.('private reply');
    expect(await reply.handle?.send()).toBe(true);
    clearComposerStorage();
    fail(unknown);
    await nextFrame();

    expect(
      Object.keys(localStorage).filter((key) => key.includes('channel-8'))
    ).toEqual([]);
  });

  it('quotes into a restored reply whose composer is closed', async () => {
    const parent = { type: 'channel', id: 'channel-9' } as const;
    const { reply, view } = mountReply(parent, 'root-9');
    render(view);
    await nextFrame();
    const fail = holdNextSend();
    editorMocks.emitChange?.('The reply that failed');
    expect(await reply.handle?.send()).toBe(true);
    fail(unknown);
    await nextFrame();

    // As the channel's quote action builds it, before the composer opens.
    const before = currentReplyDraft(
      replyDraftKeys(parent, 'root-9'),
      reply.state()
    );
    expect(before?.value).toBe('The reply that failed');
    const value = buildReplyTargetValue({
      channelId: parent.id,
      message: {
        id: 'reply-to-quote',
        thread_id: 'root-9',
        sender_id: 'macro|someone@example.test',
        content: 'Quoted text',
      },
      renderedText: 'Quoted text',
      existingValue: before?.value,
    });
    expect(value).toContain('reply-to-quote');
    expect(value).toContain('The reply that failed');
  });

  it('quotes into the stored draft, not a closed composer’s older snapshot', async () => {
    const parent = { type: 'channel', id: 'channel-10' } as const;
    const first = mountReply(parent, 'root-10');
    const second = mountReply(parent, 'root-10');
    second.reply.setOpen(false);
    render(() => (
      <>
        {first.view()}
        {second.view()}
      </>
    ));
    await nextFrame();
    editorMocks.emitChange?.('older words');
    await nextFrame();
    const stale = first.reply.state();
    expect(stale?.value).toBe('older words');
    first.reply.setOpen(false);
    second.reply.setOpen(true);
    await nextFrame();
    editorMocks.emitChange?.('newer words');
    await nextFrame();

    const before = currentReplyDraft(replyDraftKeys(parent, 'root-10'), stale);
    expect(before?.value).toBe('newer words');
  });

  it('writes no draft back for a reply sent after sign-out cleared composer storage', async () => {
    const parent = { type: 'channel', id: 'channel-11' } as const;
    const { reply, view } = mountReply(parent, 'root-11');
    render(view);
    await nextFrame();
    editorMocks.emitChange?.('typed before sign-out');
    clearComposerStorage();
    const fail = holdNextSend();
    expect(await reply.handle?.send()).toBe(true);
    fail(unknown);
    await nextFrame();

    // Sending empties the composer, which may store an empty list; never words.
    const stored = Object.keys(localStorage)
      .filter((key) => key.includes('channel-11'))
      .map((key) => localStorage.getItem(key));
    expect(stored.filter((value) => value?.includes('sign-out'))).toEqual([]);
    expect(
      Object.keys(localStorage).some((key) => key.startsWith('input-value-'))
    ).toBe(false);
  });
});
