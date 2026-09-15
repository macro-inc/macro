import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer, ChatSessionInput } from './ChatComposer';

const editor = vi.hoisted(() => ({
  clear: vi.fn(),
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
          focus: vi.fn(),
          getMarkdown: () => editor.text,
        },
        lexical: { update: vi.fn(), getRootElement: () => null },
      };
      return builder;
    },
  })
);

vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: (props: { placeholder?: string }) => (
    <div>{props.placeholder}</div>
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
      screen.getByRole('group', { name: 'Chat settings' }).textContent
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
        agentSelector={<button>Agent</button>}
        modelSelector={<button>Model</button>}
      />
    ));
    expect(screen.getByRole('button', { name: 'Agent' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Model' })).toBeTruthy();
  });
});
