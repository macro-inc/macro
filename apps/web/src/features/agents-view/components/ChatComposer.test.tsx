import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer, ChatSessionInput } from './ChatComposer';

const editor = vi.hoisted(() => ({
  clear: vi.fn(),
  setMarkdown: vi.fn(),
  enter: undefined as
    | ((event: unknown, markdown: string) => boolean)
    | undefined,
  change: undefined as ((markdown: string) => void) | undefined,
  text: '',
}));

vi.mock(
  '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder',
  () => ({
    buildConfig: () => {
      const builder = {
        namespace: () => builder,
        withMentions: () => builder,
        withEmojis: () => builder,
        withLinks: () => builder,
        withHistory: () => builder,
        withCode: () => builder,
        withRestoreFocus: () => builder,
        withSkills: () => builder,
        withAgentCommands: () => builder,
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
          getMarkdown: () => editor.text,
        },
        lexical: {
          update: vi.fn(),
          dispatchCommand: vi.fn(),
          getRootElement: () => null,
        },
      };
      return builder;
    },
  })
);

vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: (props: { placeholder?: string }) => (
    <div data-testid="editor">{props.placeholder}</div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  editor.text = '';
  editor.enter = undefined;
  editor.change = undefined;
});

function type(text: string) {
  editor.text = text;
  editor.change?.(text);
}

describe('Chat session input', () => {
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
    expect(send).toHaveBeenCalledWith('Follow up');
    expect(editor.clear).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')
    ).toBe(true);
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
    expect(send).toHaveBeenCalledWith('Next request');
  });

  it('advances a queued prompt with Enter only when the draft is empty', () => {
    const send = vi.fn();
    const stop = vi.fn();
    render(() => (
      <ChatSessionInput busy hasQueuedMessages onSend={send} onStop={stop} />
    ));
    editor.enter?.(undefined, '');
    expect(stop).toHaveBeenCalledOnce();
    type('Another request');
    editor.enter?.(undefined, editor.text);
    expect(send).toHaveBeenCalledWith('Another request');
    expect(stop).toHaveBeenCalledOnce();
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
  it('reveals the repository drawer without remounting the editor', () => {
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
    const drawer = container.querySelector('.composer-drawer');
    expect((drawer as HTMLElement).inert).toBe(true);
    expect(drawer?.getAttribute('aria-hidden')).toBe('true');
    setMode('code');
    expect(screen.getByTestId('editor')).toBe(input);
    expect((drawer as HTMLElement).inert).toBe(false);
    expect(drawer?.hasAttribute('data-open')).toBe(true);
    setMode('chat');
    expect((drawer as HTMLElement).inert).toBe(true);
    const settings = screen.getByRole('group', { name: 'Composer settings' });
    expect(settings.textContent).toBe('Agent');
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
});
