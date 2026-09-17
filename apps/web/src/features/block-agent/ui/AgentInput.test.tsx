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

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentInput } from './AgentInput';

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
  MarkdownShell: () => <div data-testid="agent-input-editor" />,
}));

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

    expect(onSend).toHaveBeenCalledWith('another request');
    expect(onStop).not.toHaveBeenCalled();
    expect(editor.clear).toHaveBeenCalledOnce();
  });

  it('keeps Enter inert when there is no queued message or draft', () => {
    const onStop = vi.fn();

    render(() => <AgentInput busy onSend={vi.fn()} onStop={onStop} />);

    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    editor.enter?.();
    expect(onStop).not.toHaveBeenCalled();
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
