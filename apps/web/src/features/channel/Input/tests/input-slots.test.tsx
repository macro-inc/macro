/**
 * @vitest-environment jsdom
 */

import { isMobile } from '@core/mobile/isMobile';
import type { IUser } from '@core/user/types';
import { render as renderBare, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import userEvent from '@testing-library/user-event';
import { createSignal, type JSX, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const editorMocks = vi.hoisted(() => ({
  cursorEnabled: false,
  clear: vi.fn(),
  focus: vi.fn(),
  mentionUsers: undefined as (() => IUser[]) | undefined,
  emitChange: undefined as ((markdown: string) => void) | undefined,
  onEnter: undefined as (() => boolean) | undefined,
}));

// These slots render the microphone, so they run with dictation rolled out.
// Other flags keep their real values.
vi.mock('@core/constant/featureFlags', async (original) => {
  const actual = await original<typeof import('@core/constant/featureFlags')>();
  return {
    ...actual,
    isFeatureEnabled: (flag: Parameters<typeof actual.isFeatureEnabled>[0]) =>
      flag === actual.enableDictation || actual.isFeatureEnabled(flag),
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
  useCodexAgentsAccess: () => () => false,
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

vi.mock('@phosphor-icons/core/regular/paperclip.svg?component-solid', () => ({
  default: () => <span data-testid="paperclip-icon" />,
}));

vi.mock('@phosphor/text-aa.svg', () => ({
  default: () => <span data-testid="format-icon" />,
}));

vi.mock('@phosphor/trash.svg', () => ({
  default: () => <span data-testid="trash-icon" />,
}));

vi.mock('@phosphor/x.svg', () => ({
  default: () => <span data-testid="close-icon" />,
}));

vi.mock('@phosphor/arrow-up.svg', () => ({
  default: () => <span data-testid="send-icon" />,
}));

vi.mock(
  '@phosphor-icons/core/regular/paper-plane-right.svg?component-solid',
  () => ({
    default: () => <span data-testid="paper-plane-icon" />,
  })
);

vi.mock('@phosphor/spinner-gap.svg', () => ({
  default: () => <span data-testid="spinner-icon" />,
}));

vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: () => <span data-testid="entity-icon" />,
}));

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
    onConnect?: () => void;
  }) => {
    onMount(() => {
      editorMocks.emitChange?.(props.initialValue ?? '');
      props.onConnect?.();
    });
    return (
      <>
        <div
          data-testid="markdown-shell"
          data-initial-value={props.initialValue ?? ''}
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
        setMarkdown: (markdown: string) => {
          editorMocks.emitChange?.(markdown);
        },
      };
      const lexical = {
        focus: vi.fn(),
        dispatchCommand: vi.fn(),
        getElementByKey: vi.fn(),
        getRootElement: vi.fn(),
        update: vi.fn((callback: () => void) => callback()),
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
        withMentions: (options: { users?: () => IUser[] }) => {
          editorMocks.mentionUsers = options.users;
          return builder;
        },
        withEmojis: () => builder,
        withActions: () => builder,
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

const peopleMocks = vi.hoisted(() => ({
  contactsEnabled: undefined as boolean | undefined,
}));
const CONTACT = {
  id: 'macro|ann@macro.test',
  name: 'Ann',
  email: 'ann@macro.test',
};
const CHANNEL_MEMBER = { user_id: 'macro|bo@macro.test' };

vi.mock('@queries/contacts/contacts', () => ({
  useContacts: (enabled?: () => boolean) => {
    peopleMocks.contactsEnabled = enabled?.() ?? true;
    return () => [CONTACT];
  },
}));
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
}));
vi.mock('@queries/messages/mutations', () => ({
  useSendMessageMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('@queries/messages/typing', () => ({
  usePostTypingUpdateMutation: () => ({ mutate: vi.fn() }),
}));

import { cursorMentionUser } from '../../macroAi';
import { ThreadReplyChannelInput } from '../../Thread/ThreadReplyChannelInput';
import { createInputAttachmentTracker } from '../attachment-tracker';
import { ChannelInput } from '../ChannelInput';
import { DropOverlay } from '../DropOverlay';
import { Root } from '../Root';
import type { InputData, InputHandle } from '../types';

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
    editorMocks.cursorEnabled = false;
    editorMocks.clear.mockClear();
    editorMocks.focus.mockClear();
    editorMocks.emitChange = undefined;
    editorMocks.onEnter = undefined;
    editorMocks.mentionUsers = undefined;
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

  it('starts dictation from the collapsed channel composer', async () => {
    vi.mocked(isMobile).mockReturnValue(true);
    const user = userEvent.setup();
    const { container } = render(() => (
      <ChannelInput input={baseInput} collapsible />
    ));
    const collapsed = container.querySelector('[data-composer-collapsed]');
    expect(collapsed).toBeTruthy();
    const microphone = collapsed?.querySelector(
      'button[aria-label="Start dictation"]'
    );
    expect(microphone).toBeTruthy();
    await user.click(microphone!);
    expect(container.querySelector('[data-composer-collapsed]')).toBeNull();
    expect(screen.getByRole('group', { name: 'Dictation' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel dictation' }));
    expect(screen.queryByRole('group', { name: 'Dictation' })).toBeNull();
  });

  it('offers Cursor within its rollout before account setup', () => {
    editorMocks.cursorEnabled = true;
    render(() => <ChannelInput input={baseInput} />);
    expect(editorMocks.mentionUsers?.().map((user) => user.name)).toEqual(
      expect.arrayContaining(['Cursor', 'Claude', 'Codex'])
    );
  });

  it('hides Cursor outside its rollout, including supplied bot entries', () => {
    render(() => (
      <ChannelInput
        input={baseInput}
        participants={() => [cursorMentionUser()]}
        bots={() => [cursorMentionUser()]}
      />
    ));
    const names = editorMocks.mentionUsers?.().map((user) => user.name);
    expect(names).not.toContain('Cursor');
    expect(names).toEqual(expect.arrayContaining(['Claude', 'Codex']));
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

  it('does not refocus the editor when a portaled editor control is clicked', async () => {
    const user = userEvent.setup();
    render(() => <ChannelInput input={baseInput} />);

    await user.click(screen.getByTestId('markdown-shell'));
    expect(editorMocks.focus).toHaveBeenCalledOnce();

    editorMocks.focus.mockClear();
    await user.click(screen.getByTestId('markdown-portal-input'));

    expect(editorMocks.focus).not.toHaveBeenCalled();
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
    await user.click(screen.getByRole('button', { name: 'Attach files' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Format' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Delete reply' }));

    expect(onSend).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    clickSpy.mockRestore();
    expect(onToggleFormatRibbon).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]?.[0]?.value).toBe('reply');
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
    expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull();
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
    peopleMocks.contactsEnabled = undefined;
  });

  it('offers a document composer the workspace contacts', () => {
    render(() => <ChannelInput input={baseInput} parent={documentParent} />);

    expect(mentionIds()).toContain(CONTACT.id);
  });

  it('offers a channel composer its participants, not the workspace contacts', () => {
    render(() => <ChannelInput input={baseInput} parent={channelParent} />);

    expect(mentionIds()).toContain(CHANNEL_MEMBER.user_id);
    expect(mentionIds()).not.toContain(CONTACT.id);
    // A channel never shows them, so it should not fetch them either.
    expect(peopleMocks.contactsEnabled).toBe(false);
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
