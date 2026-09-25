import { $createQuoteNode, QuoteNode } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';
/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_INPUT_TEXT_AREA_ID, AgentInput } from './AgentInput';

const editor = vi.hoisted(() => ({
  lexical: undefined as LexicalEditor | undefined,
  clear: vi.fn(),
  enter: undefined as (() => boolean) | undefined,
  change: undefined as ((markdown: string) => void) | undefined,
}));

vi.mock(
  '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder',
  () => ({
    buildConfig: () => {
      editor.lexical = createEditor({ nodes: [QuoteNode] });
      const builder = {
        buildHandle: () => ({ lexical: editor.lexical }),
        namespace: () => builder,
        withMentions: () => builder,
        withEmojis: () => builder,
        withLinks: () => builder,
        withHistory: () => builder,
        withCode: () => builder,
        withRestoreFocus: () => builder,
        withAgentCommands: () => builder,
        withFilePaste: () => builder,
        onEnter: (callback: () => boolean) => {
          editor.enter = callback;
          return builder;
        },
        onFocusLeave: () => builder,
        onChange: (callback: (markdown: string) => void) => {
          editor.change = callback;
          return builder;
        },
        controls: {
          clear: editor.clear,
          focus: vi.fn(),
        },
        lexical: editor.lexical,
      };
      return builder;
    },
  })
);

vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: (props: { disabled?: boolean }) => (
    <div data-testid="agent-input-editor" data-disabled={props.disabled} />
  ),
}));

// The channel composer's chips and drop zone reach the block registry (and
// through it the chat input's storage module) on import; the composer's own
// send/attach logic is what is under test, so they are stubs that surface
// what this component hands them.
vi.mock('@channel/Input/context', () => ({
  InputProvider: (props: { children: unknown }) => props.children,
}));
vi.mock('@channel/Input/Input', () => ({
  Input: {
    DropZone: (props: { children: unknown }) => props.children,
    DropOverlay: () => null,
    Attachments: () => null,
    AttachFilesAction: () => (
      <button type="button" aria-label="Attach files">
        attach
      </button>
    ),
  },
}));
vi.mock('@core/util/upload', () => ({ handleFileFolderDrop: vi.fn() }));

vi.mock('@phosphor/arrow-up.svg', () => ({
  default: () => <span data-testid="send-icon" />,
}));

vi.mock('@phosphor/spinner-gap.svg', () => ({
  default: () => <span data-testid="spinner-icon" />,
}));

vi.mock(
  '@phosphor-icons/core/regular/arrow-bend-down-left.svg?component-solid',
  () => ({
    default: () => <span data-testid="enter-icon" />,
  })
);

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  editor.clear.mockClear();
  editor.enter = undefined;
  editor.change = undefined;
});

describe('queued message advancement', () => {
  it('keeps view-only drafts, stop, and queue advancement inert', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const onSendNext = vi.fn();
    render(() => (
      <AgentInput
        readOnly
        busy
        hasQueuedMessages
        onSend={onSend}
        onStop={onStop}
        onSendNext={onSendNext}
      />
    ));

    expect(
      screen.getByTestId('agent-input-editor').getAttribute('data-disabled')
    ).toBe('true');
    const stop = screen.getByRole('button', {
      name: 'Stop',
    }) as HTMLButtonElement;
    expect(stop.disabled).toBe(true);
    fireEvent.click(stop);
    editor.enter?.();
    editor.change?.('Cannot send this');
    editor.enter?.();

    expect(onSend).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
    expect(onSendNext).not.toHaveBeenCalled();
  });

  it('shows a pressable Enter action that advances the next queued message', () => {
    const onStop = vi.fn();

    render(() => (
      <AgentInput busy hasQueuedMessages onSend={vi.fn()} onStop={onStop} />
    ));

    const sendNext = screen.getByRole('button', {
      name: 'Send next queued message',
    });
    expect(screen.getByTestId('enter-icon')).toBeTruthy();

    fireEvent.click(sendNext);
    expect(onStop).toHaveBeenCalledTimes(1);

    editor.enter?.();
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it('sends typed text instead of advancing past it', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();

    render(() => (
      <AgentInput busy hasQueuedMessages onSend={onSend} onStop={onStop} />
    ));

    editor.change?.('  another request  ');
    editor.enter?.();

    expect(onSend).toHaveBeenCalledWith('another request', []);
    expect(onStop).not.toHaveBeenCalled();
    expect(editor.clear).toHaveBeenCalledOnce();
  });

  it('sends attached files instead of advancing past them', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const uploaded = {
      id: 'file-1',
      name: 'screenshot.png',
      kind: 'image' as const,
      mimeType: 'image/png',
      size: 2048,
    };

    render(() => (
      <AgentInput
        busy
        hasQueuedMessages
        onSend={onSend}
        onStop={onStop}
        attachments={[uploaded]}
        onAttachFiles={vi.fn()}
      />
    ));

    // Attached files are a draft, so this is the typed-text case: Enter sends
    // them, and the control is Stop rather than the send-next Enter action,
    // which would have stopped the agent and left the files behind.
    expect(
      screen.queryByRole('button', { name: 'Send next queued message' })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();

    editor.enter?.();
    expect(onSend).toHaveBeenCalledWith('', [uploaded]);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('keeps Enter inert when there is no queued message or draft', () => {
    const onStop = vi.fn();

    render(() => <AgentInput busy onSend={vi.fn()} onStop={onStop} />);

    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    editor.enter?.();
    expect(onStop).not.toHaveBeenCalled();
  });
});

describe('attachments', () => {
  const uploaded = {
    id: 'file-1',
    name: 'screenshot.png',
    kind: 'image' as const,
    mimeType: 'image/png',
    size: 2048,
  };

  it('sends attached files with no text at all', () => {
    const onSend = vi.fn();

    render(() => (
      <AgentInput
        onSend={onSend}
        attachments={[uploaded]}
        onAttachFiles={vi.fn()}
      />
    ));

    editor.enter?.();
    expect(onSend).toHaveBeenCalledWith('', [uploaded]);
  });

  it('holds the send while a file is still uploading', () => {
    const onSend = vi.fn();

    render(() => (
      <AgentInput
        onSend={onSend}
        attachments={[{ ...uploaded, pending: true }]}
        onAttachFiles={vi.fn()}
      />
    ));

    editor.change?.('look at this');
    editor.enter?.();
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('measures the composer height above the editor row, so chips are inside it', () => {
    // The surface is pinned to the measured element's height. The attachment
    // chips render alongside the editor row, so the measured element has to be
    // their shared parent — measuring the row alone clips them. The chips come
    // from the mocked `@channel/Input` here, so this pins the measurement
    // boundary rather than the chip markup.
    const { container } = render(() => (
      <AgentInput
        onSend={vi.fn()}
        attachments={[uploaded]}
        onAttachFiles={vi.fn()}
      />
    ));

    const measured = container.querySelector('[data-composer-content]');
    const editorRow = container.querySelector('[data-composer-compact]');
    expect(measured).toBeTruthy();
    expect(editorRow).toBeTruthy();
    expect(measured).not.toBe(editorRow);
    expect(editorRow?.parentElement).toBe(measured);
    expect(
      measured?.querySelector(`#${AGENT_INPUT_TEXT_AREA_ID}`)
    ).toBeTruthy();
  });

  it('offers the paperclip only when files can be attached', () => {
    render(() => <AgentInput onSend={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull();

    cleanup();
    render(() => <AgentInput onSend={vi.fn()} onAttachFiles={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeTruthy();
  });
});

it('expands for a short quote and collapses when replaced with a paragraph', () => {
  const { container } = render(() => <AgentInput onSend={vi.fn()} />);
  const layout = container.querySelector('[data-composer-compact]');
  expect(layout?.getAttribute('data-composer-compact')).toBe('true');
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
  expect(layout?.getAttribute('data-composer-compact')).toBe('true');
});
