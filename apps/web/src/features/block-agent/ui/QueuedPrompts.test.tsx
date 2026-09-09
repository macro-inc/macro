/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueuedPrompts } from './QueuedPrompts';

const editor = vi.hoisted(() => ({
  enter: undefined as (() => boolean) | undefined,
  change: undefined as ((markdown: string) => void) | undefined,
  getMarkdown: vi.fn(() => ''),
  focus: vi.fn(),
}));

vi.mock(
  '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder',
  () => ({
    buildConfig: () => {
      const builder = {
        namespace: () => builder,
        withHistory: () => builder,
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
          getMarkdown: editor.getMarkdown,
          focus: editor.focus,
          setMarkdown: vi.fn(),
        },
        lexical: {
          getRootElement: () => null,
        },
      };
      return builder;
    },
  })
);

vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: () => <div data-testid="queued-prompt-editor" />,
}));

beforeEach(() => {
  editor.enter = undefined;
  editor.change = undefined;
  editor.getMarkdown.mockReturnValue('');
  editor.focus.mockClear();
});

describe('queued prompt Enter', () => {
  it('advances the queue from a prompt row', () => {
    const onSendNext = vi.fn();

    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'a1', kind: 'prompt', prompt: 'look at this next' },
        ]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onSendNext={onSendNext}
      />
    ));

    expect(screen.getByTestId('queued-prompt-editor')).toBeTruthy();
    editor.enter?.();
    expect(onSendNext).toHaveBeenCalledTimes(1);
  });

  it('flushes an in-progress edit before advancing', () => {
    const onSendNext = vi.fn();
    const onEdit = vi.fn();
    editor.getMarkdown.mockReturnValue('edited prompt');

    render(() => (
      <QueuedPrompts
        items={[{ actionId: 'a1', kind: 'prompt', prompt: 'original' }]}
        onEdit={onEdit}
        onRemove={vi.fn()}
        onSendNext={onSendNext}
      />
    ));

    editor.enter?.();
    expect(onEdit).toHaveBeenCalledWith('a1', 'edited prompt');
    expect(onSendNext).toHaveBeenCalledTimes(1);
  });

  it('advances the queue from a compact row', () => {
    const onSendNext = vi.fn();

    render(() => (
      <QueuedPrompts
        items={[{ actionId: 'c1', kind: 'compact' }]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onSendNext={onSendNext}
      />
    ));

    fireEvent.keyDown(screen.getByText('Compact the conversation'), {
      key: 'Enter',
    });
    expect(onSendNext).toHaveBeenCalledTimes(1);
  });
});
