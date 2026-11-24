import { createSessionComposerDraft } from '@app/features/block-agent/primitives/session-composer-draft';
import type { InputAttachmentData } from '@channel/Input/types';
import { preloadAgentFold } from '@core/agent-fold/client';
import type { RestoreFocusDefault } from '@core/component/LexicalMarkdown/plugins/restore-focus';
import { hapticImpact } from '@core/mobile/haptics';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { $createQuoteNode, QuoteNode } from '@lexical/rich-text';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { createSignal, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { MobileModelSelector } from '../views/mobile/model-selector';
import { RepositoryPicker } from '../views/RepositoryPicker';
import { ChatComposer, ChatSessionInput } from './ChatComposer';
import { UnifiedModelSelectorRoot } from './unified-model-selector/root';

vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));

vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));

vi.mock('@core/agent-fold/client', () => ({
  preloadAgentFold: vi.fn(async () => {}),
}));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: vi.fn(() => false),
}));

const editor = vi.hoisted(() => ({
  lexical: undefined as LexicalEditor | undefined,
  clear: vi.fn(),
  setMarkdown: vi.fn(),
  enter: undefined as
    | ((event: unknown, markdown: string) => boolean)
    | undefined,
  change: undefined as ((markdown: string) => void) | undefined,
  paste: undefined as
    | ((files: File[], directories: FileSystemDirectoryEntry[]) => void)
    | undefined,
  text: '',
  readMarkdown: (): string => '',
  /** Applies MarkdownShell's initial value when the editor connects. */
  connect: undefined as ((markdown: string) => void) | undefined,
  /** The fallback the composer configures with withRestoreFocus. */
  restoreFocus: undefined as RestoreFocusDefault | undefined,
  /** What the composer does when a mention picks people or agents. */
  onUserMention: undefined as
    | ((mention: { mentions: string[] }) => void)
    | undefined,
}));

vi.mock(
  '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder',
  () => ({
    buildConfig: () => {
      editor.lexical = createEditor({ nodes: [QuoteNode] });
      const builder = {
        buildHandle: () => ({ lexical: editor.lexical }),
        namespace: () => builder,
        withAppLinkResolver: () => builder,
        withMentions: (options: {
          onUserMention?: (mention: { mentions: string[] }) => void;
        }) => {
          editor.onUserMention = options.onUserMention;
          return builder;
        },
        withEmojis: () => builder,
        withLinks: () => builder,
        withHistory: () => builder,
        withCode: () => builder,
        withRestoreFocus: (fallback?: RestoreFocusDefault) => {
          editor.restoreFocus = fallback;
          return builder;
        },
        withSkills: () => builder,
        withAgentCommands: () => builder,
        withFilePaste: (options: {
          onPasteFilesAndDirs: typeof editor.paste;
        }) => {
          editor.paste = options.onPasteFilesAndDirs;
          return builder;
        },
        onEnter: (callback: typeof editor.enter) => {
          editor.enter = callback;
          return builder;
        },
        onFocusLeave: () => builder,
        onChange: (callback: typeof editor.change) => {
          editor.change = callback;
          return builder;
        },
        controls: {
          clear: editor.clear,
          setMarkdown: editor.setMarkdown,
          focus: vi.fn(),
          getMarkdown: () => editor.readMarkdown(),
        },
        lexical: editor.lexical,
      };
      return builder;
    },
  })
);

vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: (props: {
    placeholder?: string;
    initialValue?: string;
    onConnect?: () => void;
  }) => {
    // Like the real shell: apply the initial value once connected, then report it.
    onMount(() => {
      if (props.initialValue) editor.connect?.(props.initialValue);
      props.onConnect?.();
    });
    return (
      <div data-testid="editor">
        {props.placeholder}
        {/* Decorators portal their popups (the paste viewer) out of the editor. */}
        <Portal>
          <pre data-testid="portaled-text">Pasted text</pre>
        </Portal>
      </div>
    );
  },
}));

vi.mock('@channel/Input/Input', () => ({
  Input: {
    DropZone: (props: { children: unknown }) => props.children,
    DropOverlay: () => null,
    Attachments: () => null,
    AttachFilesAction: (props: { disabled?: boolean }) => (
      <button aria-label="Attach files" disabled={props.disabled} />
    ),
  },
}));
vi.mock('@core/util/upload', () => ({
  handleFileFolderDrop: async (
    files: File[],
    _dirs: unknown[],
    callback: (entries: { file: File }[]) => void
  ) => callback(files.map((file) => ({ file }))),
}));

const resizeCallbacks: ResizeObserverCallback[] = [];

/** Report a content resize the way the browser would for `target`. */
function resize(target: HTMLElement, height: number) {
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 400, height)
  );
  const entry = { target, contentRect: new DOMRect(0, 0, 400, height) };
  for (const callback of resizeCallbacks)
    callback([entry as unknown as ResizeObserverEntry], {} as ResizeObserver);
}

beforeEach(() => {
  resizeCallbacks.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.clearAllMocks();
  vi.mocked(isTouchDevice).mockReturnValue(false);
  editor.clear.mockReset();
  editor.setMarkdown.mockReset();
  editor.text = '';
  editor.readMarkdown = () => editor.text;
  editor.enter = undefined;
  editor.change = undefined;
  editor.connect = undefined;
});

/** Replace the editor contents with the selection at the start, as Lexical's markdown import does. */
function importAtStart(markdown: string) {
  editor.lexical?.update(
    () => {
      const paragraph = $createParagraphNode().append(
        $createTextNode(markdown)
      );
      $getRoot().clear().append(paragraph);
      paragraph.selectStart();
    },
    { discrete: true }
  );
}

/** Attach the editor to a document root, so focus and DOM selection run. */
function connectRoot() {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  editor.lexical?.setRootElement(root);
  onTestFinished(() => {
    editor.lexical?.setRootElement(null);
    root.remove();
  });
  return root;
}

/** Focus the root as triggerFocusInput does; restoreFocusPlugin then focuses the editor, falling back to the composer's configured default. */
function focusEditor(root: HTMLElement) {
  root.focus();
  editor.lexical?.focus(undefined, {
    defaultSelection: editor.restoreFocus ?? 'rootStart',
  });
}

/** Characters before the DOM caret in `root`, or undefined when it is elsewhere. */
function domCaretOffset(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.anchorNode || !root.contains(selection.anchorNode)) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString().length;
}

function caretOffset() {
  return editor.lexical?.read(() => {
    const selection = $getSelection();
    return $isRangeSelection(selection) ? selection.anchor.offset : undefined;
  });
}

function type(text: string) {
  editor.text = text;
  editor.change?.(text);
}

describe('Chat session input', () => {
  it.each([false, true])(
    'shows the complete static hint immediately and keeps it unchanged (session=%s)',
    (session) => {
      vi.useFakeTimers();
      const view = render(() =>
        session ? (
          <ChatSessionInput onSend={vi.fn()} />
        ) : (
          <ChatComposer
            draft=""
            onDraftChange={vi.fn()}
            onSend={vi.fn()}
            selector={null}
          />
        )
      );
      try {
        const hint =
          'Type @ to mention docs, people, or channels, / for skills';
        expect(screen.getByTestId('editor').textContent).toBe(hint);
        vi.advanceTimersByTime(30000);
        expect(screen.getByTestId('editor').textContent).toBe(hint);
      } finally {
        view.unmount();
        vi.useRealTimers();
      }
    }
  );

  it('reports each person or agent a mention picks', () => {
    const mentioned = vi.fn();
    render(() => (
      <ChatComposer
        draft=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        onMentionUser={mentioned}
        selector={null}
      />
    ));
    editor.onUserMention?.({ mentions: ['bot|cursor', 'macro|ada'] });
    expect(mentioned.mock.calls).toEqual([['bot|cursor'], ['macro|ada']]);
  });

  it('does not write a sent prompt back into the editor', () => {
    const [draft, setDraft] = createSignal('');
    const [markdown, setMarkdown] = createSignal('');
    editor.readMarkdown = markdown;
    editor.clear.mockImplementation(() => setMarkdown(''));
    editor.setMarkdown.mockImplementation((value: string) =>
      setMarkdown(value)
    );
    const send = vi.fn();
    render(() => (
      <ChatComposer
        draft={draft()}
        onDraftChange={setDraft}
        onSend={send}
        selector={<span />}
      />
    ));
    setDraft('Hello agent');
    setMarkdown('Hello agent');
    editor.setMarkdown.mockClear();
    editor.enter?.(undefined, 'Hello agent');
    expect(send).toHaveBeenCalledWith('Hello agent', []);
    expect(draft()).toBe('');
    expect(markdown()).toBe('');
    expect(editor.setMarkdown).not.toHaveBeenCalledWith('Hello agent');
  });

  it('does not pass back a host draft the editor exports differently', () => {
    const [draft, setDraft] = createSignal('');
    const [markdown, setMarkdown] = createSignal('');
    editor.readMarkdown = markdown;
    // Markdown import drops a code block's trailing blank line.
    editor.setMarkdown.mockImplementation((value: string) =>
      setMarkdown(value.replace('\n\n```', '\n```'))
    );
    const change = vi.fn();
    render(() => (
      <ChatComposer
        draft={draft()}
        onDraftChange={change}
        onSend={vi.fn()}
        selector={null}
      />
    ));
    setDraft('```\nfoo\n\n```');
    editor.change?.(markdown());
    expect(change).not.toHaveBeenCalled();

    type('```\nfoo\n```\nmore');
    expect(change).toHaveBeenCalledWith('```\nfoo\n```\nmore');
  });

  it('does not pass back the export it reports while connecting with a draft', () => {
    // MarkdownShell reports its initial export before calling onConnect.
    editor.connect = (markdown) =>
      editor.change?.(markdown.replace('\n\n```', '\n```'));
    const change = vi.fn();
    render(() => (
      <ChatComposer
        draft={'```\nfoo\n\n```'}
        onDraftChange={change}
        onSend={vi.fn()}
        selector={null}
      />
    ));
    expect(change).not.toHaveBeenCalled();

    type('```\nfoo\n```\nmore');
    expect(change).toHaveBeenCalledWith('```\nfoo\n```\nmore');
  });

  it('preloads the fold only when focused without sending or changing the draft', () => {
    const send = vi.fn();
    const change = vi.fn();
    render(() => (
      <ChatComposer
        draft="Keep this draft"
        onDraftChange={change}
        onSend={send}
        selector={null}
      />
    ));
    expect(preloadAgentFold).not.toHaveBeenCalled();
    fireEvent.focusIn(screen.getByTestId('editor'));
    expect(preloadAgentFold).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
    expect(editor.clear).not.toHaveBeenCalled();
  });

  it('seeds the supplied context without sending it', () => {
    const send = vi.fn();
    render(() => (
      <ChatSessionInput initialInput="Document context" onSend={send} />
    ));
    expect(editor.setMarkdown).toHaveBeenCalledWith('Document context');
    expect(send).not.toHaveBeenCalled();
  });

  it('focuses a draft seeded when the editor connects after the draft', () => {
    let root: HTMLElement | undefined;
    editor.connect = (markdown) => {
      root = connectRoot();
      importAtStart(markdown);
    };
    render(() => (
      <ChatSessionInput initialInput="Ask about @Routine" onSend={vi.fn()} />
    ));
    if (!root) throw new Error('the editor never connected');
    focusEditor(root);
    expect(caretOffset()).toBe('Ask about @Routine'.length);
    expect(domCaretOffset(root)).toBe('Ask about @Routine'.length);
  });

  it('focuses a draft the host applies to an open editor after the draft', () => {
    editor.setMarkdown.mockImplementation(importAtStart);
    const [draft, setDraft] = createSignal('');
    render(() => (
      <ChatSessionInput
        draft={draft()}
        onDraftChange={setDraft}
        onSend={vi.fn()}
      />
    ));
    const root = connectRoot();
    // Typed in earlier, then left for the Compose with agent button.
    focusEditor(root);
    const button = document.createElement('button');
    document.body.append(button);
    onTestFinished(() => button.remove());
    button.focus();
    setDraft('Ask about @Routine');
    // Applying the draft doesn't take focus.
    expect(document.activeElement).toBe(button);
    focusEditor(root);
    expect(caretOffset()).toBe('Ask about @Routine'.length);
    expect(domCaretOffset(root)).toBe('Ask about @Routine'.length);
  });

  it('shows only the model control and submits a trimmed follow-up', () => {
    const send = vi.fn();
    render(() => (
      <ChatSessionInput modelControl={<button>Model</button>} onSend={send} />
    ));
    expect(
      screen.getByRole('group', { name: 'Composer settings' }).textContent
    ).toBe('Model');
    type('  Follow up  ');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith('Follow up', []);
    expect(editor.clear).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')
    ).toBe(true);
  });

  it('restores an unsent session message after the composer remounts', () => {
    localStorage.clear();
    const View = () => {
      const persisted = createSessionComposerDraft(() => 'session-restore');
      return (
        <ChatSessionInput
          draft={persisted.draft()}
          onDraftChange={persisted.setDraft}
          onSend={vi.fn()}
        />
      );
    };
    const first = render(() => <View />);
    type('Hold this for the session');
    first.unmount();
    editor.text = '';
    editor.setMarkdown.mockClear();
    render(() => <View />);
    expect(editor.setMarkdown).toHaveBeenCalledWith(
      'Hold this for the session'
    );
  });

  it('drops the saved session message once it is sent', () => {
    localStorage.clear();
    const send = vi.fn();
    const View = () => {
      const persisted = createSessionComposerDraft(() => 'session-sent');
      return (
        <ChatSessionInput
          draft={persisted.draft()}
          onDraftChange={persisted.setDraft}
          onSend={send}
        />
      );
    };
    const first = render(() => <View />);
    type('Send and forget');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith('Send and forget', []);
    first.unmount();
    editor.text = '';
    editor.setMarkdown.mockClear();
    render(() => <View />);
    expect(editor.setMarkdown).not.toHaveBeenCalledWith('Send and forget');
  });

  it('keeps a draft intact while the session is pending', () => {
    const send = vi.fn();
    render(() => <ChatSessionInput disabled onSend={send} />);
    type('Wait for the session');
    editor.enter?.(undefined, editor.text);
    expect(send).not.toHaveBeenCalled();
    expect(editor.clear).not.toHaveBeenCalled();
  });

  it('stops an active turn, then sends a typed prompt to the queue', () => {
    const send = vi.fn();
    const stop = vi.fn();
    render(() => <ChatSessionInput busy onSend={send} onStop={stop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(stop).toHaveBeenCalledOnce();
    type('Next request');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith('Next request', []);
  });

  it('never stops the turn from Enter on an empty draft', () => {
    const send = vi.fn();
    const stop = vi.fn();
    render(() => <ChatSessionInput busy onSend={send} onStop={stop} />);
    editor.enter?.(undefined, '');
    expect(stop).not.toHaveBeenCalled();
    type('Another request');
    editor.enter?.(undefined, editor.text);
    expect(send).toHaveBeenCalledWith('Another request', []);
    expect(stop).not.toHaveBeenCalled();
  });

  describe('on a touch device', () => {
    beforeEach(() => {
      vi.mocked(isTouchDevice).mockReturnValue(true);
    });

    it('leaves Enter to the virtual keyboard and sends only from the button', () => {
      const send = vi.fn();
      render(() => <ChatSessionInput onSend={send} />);
      type('first line');
      // Not captured, so the editor inserts a newline instead of sending.
      expect(editor.enter?.(undefined, editor.text)).toBe(false);
      expect(send).not.toHaveBeenCalled();
      expect(hapticImpact).not.toHaveBeenCalled();
      expect(editor.clear).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(send).toHaveBeenCalledWith('first line', []);
      expect(hapticImpact).toHaveBeenCalledExactlyOnceWith('light');
    });

    it('applies to a new conversation as well', () => {
      const send = vi.fn();
      render(() => (
        <ChatComposer
          draft="Describe this"
          onDraftChange={vi.fn()}
          selector={null}
          onSend={send}
        />
      ));
      expect(editor.enter?.(undefined, 'Describe this')).toBe(false);
      expect(send).not.toHaveBeenCalled();
      expect(hapticImpact).not.toHaveBeenCalled();
    });
  });

  it('registers and cleans up session focus and quote handlers', () => {
    const focus = vi.fn();
    const quote = vi.fn();
    const { unmount } = render(() => (
      <ChatSessionInput
        onSend={vi.fn()}
        registerFocus={focus}
        registerQuoteInsert={quote}
      />
    ));
    expect(focus).toHaveBeenCalledWith(expect.any(Function));
    expect(quote).toHaveBeenCalledWith(expect.any(Function));
    unmount();
    expect(focus).toHaveBeenLastCalledWith(undefined);
    expect(quote).toHaveBeenLastCalledWith(undefined);
  });

  it('retains the agent selector on the new-chat input', () => {
    render(() => (
      <ChatComposer
        draft=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        selector={<button>Agent</button>}
      />
    ));
    expect(screen.getByRole('button', { name: 'Agent' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Model' })).toBeNull();
  });
  it.each([false, true])(
    'places new-session modes outside and below the composer, like Home (touch: %s)',
    (touch) => {
      vi.mocked(isTouchDevice).mockReturnValue(touch);
      const { container } = render(() => (
        <ChatComposer
          draft=""
          onDraftChange={vi.fn()}
          onSend={vi.fn()}
          selector={<button>Model</button>}
          settingsPlacement="below"
          drawerOpen
          drawer={<button>Auto / Chat / Code</button>}
        />
      ));
      const surface = container.querySelector('[data-agent-composer]');
      const modes = screen.getByRole('button', { name: 'Auto / Chat / Code' });
      expect(surface?.contains(modes)).toBe(false);
      expect(
        (surface?.compareDocumentPosition(modes) ?? 0) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        modes.closest('.composer-drawer')?.getAttribute('data-placement')
      ).toBe('bottom');
      expect(
        screen
          .getByRole('button', { name: 'Model' })
          .closest('[data-agent-composer]')
      ).toBe(surface);
    }
  );
  it.each([false, true])(
    'keeps settings and editor mounted in desktop controls or the touch drawer (touch: %s)',
    (touch) => {
      vi.mocked(isTouchDevice).mockReturnValue(touch);
      const [mode, setMode] = createSignal('chat');
      const { container } = render(() => (
        <ChatComposer
          draft="Shared draft"
          onDraftChange={vi.fn()}
          selector={<button>Agent</button>}
          drawer={<button>Repository</button>}
          drawerOpen={mode() === 'code'}
          onSend={vi.fn()}
        />
      ));
      const input = screen.getByTestId('editor');
      const drawer = touch
        ? container.querySelector('.composer-drawer')
        : container.querySelector('[aria-label="Conversation settings"]');
      const layout = container.querySelector('[data-composer-compact]');
      expect(layout?.getAttribute('data-composer-compact')).toBe('true');
      expect(
        (drawer?.compareDocumentPosition(input) ?? 0) &
          (touch
            ? Node.DOCUMENT_POSITION_FOLLOWING
            : Node.DOCUMENT_POSITION_PRECEDING)
      ).toBeTruthy();
      if (touch) expect((drawer as HTMLElement).inert).toBe(true);
      else expect((drawer as HTMLElement).hidden).toBe(true);
      setMode('code');
      expect(screen.getByTestId('editor')).toBe(input);
      if (touch) expect((drawer as HTMLElement).inert).toBe(false);
      else expect((drawer as HTMLElement).hidden).toBe(false);
      expect(layout?.getAttribute('data-composer-compact')).toBe('false');
      expect(editor.clear).not.toHaveBeenCalled();
      setMode('chat');
      expect(layout?.getAttribute('data-composer-compact')).toBe('true');
      expect(screen.getByTestId('editor')).toBe(input);
      if (touch) expect((drawer as HTMLElement).inert).toBe(true);
      else expect((drawer as HTMLElement).hidden).toBe(true);
      const settings = screen.getByRole('group', { name: 'Composer settings' });
      expect(
        settings.contains(screen.getByRole('button', { name: 'Agent' }))
      ).toBe(true);
    }
  );
  it('does not grow the surface from zero after mounting offscreen', () => {
    render(() => (
      <ChatComposer
        draft=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        selector={<button>Agent</button>}
      />
    ));
    const surface = document.querySelector<HTMLElement>(
      '[data-agent-composer="chat"]'
    );
    const content = document.querySelector<HTMLElement>(
      '[data-composer-content]'
    );
    if (!surface || !content) throw new Error('composer did not render');
    const parent = content.parentElement;
    content.remove();
    resize(content, 0);
    expect(surface.style.height).toBe('');

    parent?.append(content);
    resize(content, 49);
    expect(surface.style.height).toBe('49px');
  });

  it('lets controls inside the composer receive pointer focus', () => {
    render(() => (
      <ChatComposer
        draft=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        selector={<input aria-label="Filter models" />}
      />
    ));
    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
    });
    screen.getByRole('textbox', { name: 'Filter models' }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves presses in portaled editor popups to the browser so their text can be selected', () => {
    render(() => <ChatSessionInput onSend={vi.fn()} />);
    const press = (target: Element, type: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const surface = document.querySelector('[data-agent-composer="chat"]')!;
    const portaled = screen.getByTestId('portaled-text');
    expect(surface.contains(portaled)).toBe(false);
    for (const type of ['pointerdown', 'mousedown']) {
      expect(press(surface, type)).toBe(true);
      expect(press(portaled, type)).toBe(false);
    }
  });
});

it('keeps desktop session controls below both quotes and paragraphs', () => {
  const { container } = render(() => <ChatSessionInput onSend={vi.fn()} />);
  const layout = container.querySelector('[data-composer-compact]');
  expect(layout?.getAttribute('data-composer-compact')).toBe('false');
  editor.lexical!.update(
    () => {
      $getRoot()
        .clear()
        .append($createQuoteNode().append($createTextNode('short')));
    },
    { discrete: true }
  );
  expect(layout?.getAttribute('data-composer-compact')).toBe('false');
  editor.lexical!.update(
    () => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('short')));
    },
    { discrete: true }
  );
  expect(layout?.getAttribute('data-composer-compact')).toBe('false');
});

describe('attachments in the shared composer', () => {
  const image: InputAttachmentData = {
    id: 'image-id',
    name: 'pasted.png',
    kind: 'image',
    mimeType: 'image/png',
  };

  it('routes pasted files to the session uploader', () => {
    const attach = vi.fn();
    render(() => <ChatSessionInput onSend={vi.fn()} onAttachFiles={attach} />);
    const file = new File(['image'], 'pasted.png', { type: 'image/png' });
    editor.paste?.([file], []);
    expect(attach).toHaveBeenCalledWith([file]);
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeTruthy();
  });

  it('holds an image-only prompt while uploading, then sends the image instead of stopping', () => {
    const send = vi.fn();
    const stop = vi.fn();
    const [attachments, setAttachments] = createSignal([
      { ...image, pending: true },
    ]);
    render(() => (
      <ChatSessionInput
        busy
        onSend={send}
        onStop={stop}
        attachments={attachments()}
      />
    ));
    expect(
      screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')
    ).toBe(true);
    editor.enter?.(undefined, '');
    expect(send).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    setAttachments([{ ...image, pending: false }]);
    editor.enter?.(undefined, '');
    expect(send).toHaveBeenCalledWith('', [{ ...image, pending: false }]);
    expect(stop).not.toHaveBeenCalled();
  });

  it('sends attachments and text from a new conversation', () => {
    const send = vi.fn();
    render(() => (
      <ChatComposer
        draft="Describe this"
        onDraftChange={vi.fn()}
        selector={null}
        attachments={[image]}
        onSend={send}
      />
    ));
    editor.enter?.(undefined, 'Describe this');
    expect(send).toHaveBeenCalledWith('Describe this', [image]);
  });
});

it('keeps the paperclip visible while the session is unavailable', () => {
  render(() => (
    <ChatSessionInput disabled onSend={vi.fn()} onAttachFiles={vi.fn()} />
  ));
  expect(
    screen
      .getByRole('button', { name: 'Attach files' })
      .hasAttribute('disabled')
  ).toBe(true);
});

it.each([undefined, 'Describe what you want to build'])(
  'uses a short mobile placeholder instead of the desktop prompt %s',
  (placeholder) => {
    vi.mocked(isTouchDevice).mockReturnValue(true);
    render(() => (
      <ChatComposer
        draft=""
        placeholder={placeholder}
        onDraftChange={() => {}}
        onSend={() => {}}
        selector={<button>Model</button>}
      />
    ));
    expect(screen.getByTestId('editor').textContent).toBe('Message Macro AI');
  }
);

it('expands mobile controls on focus without replacing the editor or model picker', () => {
  vi.mocked(isTouchDevice).mockReturnValue(true);
  const { container } = render(() => (
    <ChatComposer
      collapseOnBlur
      draft=""
      onDraftChange={() => {}}
      onSend={() => {}}
      onAttachFiles={() => {}}
      selector={<button>Model</button>}
      drawer={<button>Repository</button>}
      drawerOpen
    />
  ));
  const input = screen.getByTestId('editor');
  const model = screen.getByRole('button', { name: 'Model' });
  const attach = screen.getByRole('button', { name: 'Attach files' });
  const repository = container.querySelector('.composer-drawer');
  const surface = container.querySelector('[data-agent-composer]');
  const compact = () => input.closest('[data-composer-compact]');

  expect(compact()?.getAttribute('data-composer-compact')).toBe('true');
  expect(model.closest('.hidden')).not.toBeNull();
  expect(attach.parentElement?.classList.contains('hidden')).toBe(true);
  expect(repository?.getAttribute('aria-hidden')).toBe('true');
  expect(surface?.hasAttribute('data-composer-expanded')).toBe(false);

  fireEvent.focusIn(input);
  expect(compact()?.getAttribute('data-composer-compact')).toBe('false');
  expect(model.closest('.hidden')).toBeNull();
  expect(attach.parentElement?.classList.contains('hidden')).toBe(false);
  expect(repository?.getAttribute('aria-hidden')).toBe('false');
  expect(surface?.getAttribute('data-composer-expanded')).toBe('true');

  fireEvent.pointerDown(document.body);
  expect(compact()?.getAttribute('data-composer-compact')).toBe('true');
  expect(repository?.getAttribute('aria-hidden')).toBe('true');
  expect(surface?.hasAttribute('data-composer-expanded')).toBe(false);
  expect(screen.getByTestId('editor')).toBe(input);
  expect(screen.getByRole('button', { name: 'Model' })).toBe(model);
});

it('expands a short mobile session draft on focus and keeps the editor mounted', () => {
  vi.mocked(isTouchDevice).mockReturnValue(true);
  render(() => (
    <ChatSessionInput
      initialInput="Keep this draft"
      onSend={() => {}}
      modelControl={<button>Model</button>}
    />
  ));
  const input = screen.getByTestId('editor');
  const compact = () =>
    input
      .closest('[data-composer-compact]')
      ?.getAttribute('data-composer-compact');

  expect(compact()).toBe('true');
  fireEvent.focusIn(input);
  expect(compact()).toBe('false');
  fireEvent.focusOut(input, { relatedTarget: document.body });
  expect(compact()).toBe('true');
  expect(screen.getByTestId('editor')).toBe(input);
  expect(editor.clear).not.toHaveBeenCalled();
});

it('reveals the mobile model trigger after focusing the input', () => {
  vi.mocked(isTouchDevice).mockReturnValue(true);
  const open = vi.fn();
  render(() => (
    <ChatComposer
      collapseOnBlur
      draft=""
      onDraftChange={() => {}}
      onSend={() => {}}
      selector={<button onClick={open}>Model</button>}
    />
  ));
  const trigger = screen.getByRole('button', { name: 'Model' });
  const compact = screen
    .getByTestId('editor')
    .closest('[data-composer-compact]');

  expect(trigger.closest('.hidden')).not.toBeNull();
  fireEvent.focusIn(screen.getByTestId('editor'));
  expect(trigger.closest('.hidden')).toBeNull();
  expect(compact?.getAttribute('data-composer-compact')).toBe('false');
  fireEvent.click(trigger);
  expect(open).toHaveBeenCalledOnce();
  expect(preloadAgentFold).toHaveBeenCalled();
});

it.each(['Send', 'Attach files', 'Model'])(
  'keeps the expanded Home composer stable through an iOS %s tap',
  (control) => {
    vi.mocked(isTouchDevice).mockReturnValue(true);
    const send = vi.fn();
    render(() => (
      <ChatComposer
        collapseOnBlur
        draft={'First line\nSecond line'}
        onDraftChange={() => {}}
        onSend={send}
        onAttachFiles={() => {}}
        selector={<button>Model</button>}
      />
    ));
    editor.text = 'First line\nSecond line';
    const input = screen.getByTestId('editor');
    const clipped = () => input.parentElement?.classList.contains('max-h-6');
    fireEvent.focusIn(input);
    expect(clipped()).toBe(false);
    const button = screen.getByRole('button', { name: control });
    fireEvent.pointerDown(button);
    fireEvent.focusOut(input, { relatedTarget: null });
    expect(clipped()).toBe(false);
    fireEvent.click(button);
    if (control === 'Send')
      expect(send).toHaveBeenCalledWith('First line\nSecond line', []);
    fireEvent.pointerDown(document.body);
    expect(clipped()).toBe(true);
  }
);

it.each(['Repository', 'Branch'])(
  'keeps the mobile composer expanded while the portaled %s picker has focus',
  (control) => {
    vi.mocked(isTouchDevice).mockReturnValue(true);
    const [controlsOpen, setControlsOpen] = createSignal(false);
    const { container } = render(() => (
      <ChatComposer
        collapseOnBlur
        controlsOpen={controlsOpen()}
        draft="Keep this draft"
        onDraftChange={() => {}}
        onSend={() => {}}
        selector={<button>Model</button>}
        drawerOpen
        drawer={
          <RepositoryPicker
            onOpenChange={setControlsOpen}
            repoUrl="https://github.com/macro-inc/macro"
            branch="main"
            repositories={[]}
            repositoriesLoading={false}
            repositoriesError={false}
            recentRepositories={[]}
            branches={['main']}
            branchesLoading={false}
            branchesError={false}
            onRetryRepositories={() => {}}
            onRetryBranches={() => {}}
            onSelectRepository={() => {}}
            onSelectBranch={() => {}}
          />
        }
      />
    ));
    const input = screen.getByTestId('editor');
    fireEvent.focusIn(input);
    fireEvent.click(screen.getByRole('button', { name: control }));
    const search = screen.getByRole('combobox');
    expect(container.contains(search)).toBe(false);
    fireEvent.focusOut(input, { relatedTarget: search });
    fireEvent.pointerDown(search);
    expect(controlsOpen()).toBe(true);
    expect(
      container.querySelector('.composer-drawer')?.getAttribute('aria-hidden')
    ).toBe('false');
    expect(
      input
        .closest('[data-composer-compact]')
        ?.getAttribute('data-composer-compact')
    ).toBe('false');
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(controlsOpen()).toBe(false);
    expect(screen.getByTestId('editor')).toBe(input);
  }
);

it('keeps the list composer expanded across model selection and dismisses an orphaned card', async () => {
  vi.mocked(isTouchDevice).mockReturnValue(true);
  const computedStyle = window.getComputedStyle;
  vi.stubGlobal('getComputedStyle', (element: Element) => {
    const style = computedStyle(element);
    style.transitionDuration ||= '0s';
    style.animationName ||= 'none';
    return style;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute('data-corvu-drawer-content') ? 600 : 0;
    }
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  const [open, setOpen] = createSignal(false);
  const [model, setModel] = createSignal('openai/gpt-5.6');
  const [hidden, setHidden] = createSignal(false);
  const models = [
    { id: 'openai/gpt-5.6', label: 'GPT-5.6' },
    { id: 'anthropic/claude-sonnet-5-5', label: 'Sonnet 5.5' },
  ];
  const { container } = render(() => (
    <div hidden={hidden()}>
      <ChatComposer
        collapseOnBlur
        phoneLayout
        controlsOpen={open()}
        draft="Keep the list draft"
        onDraftChange={() => {}}
        onSend={() => {}}
        selector={
          <UnifiedModelSelectorRoot
            state={{
              get model() {
                return model();
              },
              models,
              suggestedModels: models,
              onModel: (id) => {
                setModel(id);
              },
              onEffort: () => {},
              onSpeed: () => {},
              onOpenChange: setOpen,
              onCloseAutoFocus: (event) => event.preventDefault(),
            }}
          >
            <MobileModelSelector />
          </UnifiedModelSelectorRoot>
        }
      />
    </div>
  ));
  const input = screen.getByTestId('editor');
  const surface = container.querySelector('[data-agent-composer]')!;
  fireEvent.focusIn(input);
  const trigger = screen.getByRole('button', {
    name: 'Choose an agent or model',
  });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('button', { name: 'GPT-5.6' }));
  let search = await screen.findByRole('textbox');
  const sheet = search.closest<HTMLElement>('[data-corvu-drawer-content]')!;
  search.focus();
  fireEvent(window, new Event('resize'));
  expect(document.activeElement).toBe(search);
  expect(open()).toBe(true);
  await waitFor(() => expect(sheet.style.transform).toContain('0px'));
  const press = new MouseEvent('pointerdown', {
    bubbles: true,
    button: 0,
    clientX: 100,
    clientY: 100,
  });
  Object.defineProperty(press, 'pointerType', { value: 'touch' });
  fireEvent(search, press);
  fireEvent.touchStart(search, { touches: [{ clientX: 100, clientY: 100 }] });
  fireEvent.touchMove(search, { touches: [{ clientX: 100, clientY: 102 }] });
  fireEvent.touchMove(search, { touches: [{ clientX: 100, clientY: 742 }] });
  fireEvent.touchEnd(search, { touches: [] });
  expect(open()).toBe(true);
  expect(document.activeElement).toBe(search);
  fireEvent.click(sheet.querySelector('button')!);
  // The closing sheet must retire its focus trap before a new card mounts.
  expect(
    document.querySelector('[role="dialog"]:not([data-corvu-drawer-content])')
  ).toBeNull();
  await waitFor(() =>
    expect(
      document.querySelector('[role="dialog"]:not([data-corvu-drawer-content])')
    ).not.toBeNull()
  );
  expect(open()).toBe(true);
  fireEvent.click(await screen.findByRole('button', { name: 'GPT-5.6' }));
  search = await screen.findByRole('textbox');
  fireEvent.focusOut(input, { relatedTarget: search });
  fireEvent.pointerDown(search);
  expect(surface.hasAttribute('data-composer-expanded')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Sonnet 5.5' }));
  await waitFor(() => expect(open()).toBe(false));
  expect(model()).toBe('anthropic/claude-sonnet-5-5');
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(surface.hasAttribute('data-composer-expanded')).toBe(true);
  expect(screen.getByTestId('editor')).toBe(input);

  fireEvent.click(trigger);
  await screen.findByRole('dialog');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(open()).toBe(false));

  fireEvent.click(trigger);
  await screen.findByRole('dialog');
  setHidden(true);
  await waitFor(() => expect(open()).toBe(false));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  setHidden(false);

  fireEvent.click(trigger);
  await screen.findByRole('dialog');
  fireEvent.click(document.querySelector('[data-model-selector-overlay]')!);
  await waitFor(() => expect(open()).toBe(false));
});

it('blocks existing images on text-only models and preserves the draft until switching back', () => {
  const send = vi.fn();
  const [supportsImages, setSupportsImages] = createSignal(false);
  const attachment: InputAttachmentData = {
    id: 'image',
    name: 'test.png',
    kind: 'image',
  };
  render(() => (
    <ChatSessionInput
      onSend={send}
      supportsImages={supportsImages()}
      attachments={[attachment]}
    />
  ));
  type('Describe this');
  expect(screen.queryByText(/This model does not support images/)).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')
  ).toBe(true);
  editor.enter?.(undefined, 'Describe this');
  expect(send).not.toHaveBeenCalled();
  expect(editor.clear).not.toHaveBeenCalled();
  setSupportsImages(true);
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(send).toHaveBeenCalledWith('Describe this', [attachment]);
});

it('refuses pasted images for text-only models but still accepts documents', () => {
  const attach = vi.fn();
  render(() => (
    <ChatSessionInput
      onSend={vi.fn()}
      onAttachFiles={attach}
      supportsImages={false}
    />
  ));
  const document = new File(['hello'], 'note.txt', { type: 'text/plain' });
  // Missing browser MIME types still use the image extension.
  const image = new File(['image'], 'picture.PNG');
  editor.paste?.([image, document], []);
  expect(attach).toHaveBeenCalledWith([document]);
});
