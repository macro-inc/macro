import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueuedPrompts } from './QueuedPrompts';

const editor = vi.hoisted(() => ({
  change: undefined as ((markdown: string) => void) | undefined,
  escape: undefined as (() => boolean) | undefined,
  markdown: 'Queued request',
  focus: vi.fn(),
}));
vi.mock(
  '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder',
  () => ({
    buildConfig: () => {
      const builder = {
        namespace: () => builder,
        withHistory: () => builder,
        onChange: (callback: (markdown: string) => void) => {
          editor.change = callback;
          return builder;
        },
        onFocusLeave: () => builder,
        onEscape: (callback: () => boolean) => {
          editor.escape = callback;
          return builder;
        },
        lexical: { getRootElement: () => null },
        controls: {
          focus: editor.focus,
          getMarkdown: () => editor.markdown,
          setMarkdown: vi.fn(),
        },
      };
      return builder;
    },
  })
);
vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: (props: { initialValue?: string; disabled?: boolean }) => (
    <div role="textbox" aria-readonly={props.disabled}>
      {props.initialValue}
    </div>
  ),
}));
vi.mock('@ui', () => ({
  Surface: (props: { children?: JSX.Element }) => props.children,
  Button: (props: {
    label?: string;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    />
  ),
}));

beforeEach(() => {
  vi.useFakeTimers();
  editor.markdown = 'Queued request';
  editor.focus.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('queued prompt access', () => {
  it('collapses every message and opens only the selected editor', () => {
    render(() => (
      <QueuedPrompts
        items={[
          {
            actionId: 'first',
            kind: 'prompt',
            prompt: 'First request\nMore detail',
          },
          { actionId: 'second', kind: 'prompt', prompt: 'Second request' },
        ]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    expect(screen.queryByRole('textbox')).toBeNull();
    const first = screen.getByRole('button', {
      name: /First request\s+More detail/,
    });
    const second = screen.getByRole('button', { name: 'Second request' });
    fireEvent.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(editor.focus).toHaveBeenCalledOnce();

    fireEvent.click(second);
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('textbox').textContent).toBe('Second request');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(second);
  });

  it('opens the next prompt from composer keyboard navigation', () => {
    let focusFromBelow: (() => void) | undefined;
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'first', kind: 'prompt', prompt: 'Next to send' },
          { actionId: 'second', kind: 'prompt', prompt: 'Newest request' },
        ]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        registerFocusFromBelow={(focus) => (focusFromBelow = focus)}
      />
    ));
    focusFromBelow?.();
    expect(screen.getByRole('textbox').textContent).toBe('Next to send');
    expect(editor.focus).toHaveBeenCalledOnce();
  });

  it('keeps the edited preview and editor mounted when collapsed', () => {
    const onEdit = vi.fn();
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'first', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={onEdit}
        onRemove={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    const textbox = screen.getByRole('textbox');
    editor.markdown = 'Updated request';
    editor.change?.(editor.markdown);
    expect(editor.escape?.()).toBe(true);
    expect(onEdit).toHaveBeenCalledWith('first', 'Updated request');
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Updated request' }));
    expect(screen.getByRole('textbox')).toBe(textbox);
  });

  it('shows queued text without permitting edits or removal for viewers', () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <QueuedPrompts
        disabled
        items={[
          { actionId: 'queued-1', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    const textbox = screen.getByRole('textbox');
    expect(textbox.textContent).toBe('Queued request');
    expect(textbox.getAttribute('aria-readonly')).toBe('true');
    const remove = screen.getByRole('button', {
      name: 'Remove queued message',
    }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    fireEvent.click(remove);
    editor.markdown = 'Attempted edit';
    editor.change?.(editor.markdown);
    fireEvent.focusOut(textbox);
    vi.advanceTimersByTime(400);

    expect(onEdit).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('drops a pending autosave after edit access is removed', () => {
    const [disabled, setDisabled] = createSignal(false);
    const onEdit = vi.fn();
    render(() => (
      <QueuedPrompts
        disabled={disabled()}
        items={[
          { actionId: 'queued-1', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={onEdit}
        onRemove={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    editor.markdown = 'An unsaved edit';
    editor.change?.(editor.markdown);

    setDisabled(true);
    vi.advanceTimersByTime(400);

    expect(onEdit).not.toHaveBeenCalled();
  });

  it('retains edit autosave and removal for editors', () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'queued-1', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    editor.markdown = 'An edited request';
    editor.change?.(editor.markdown);
    vi.advanceTimersByTime(400);
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove queued message' })
    );

    expect(onEdit).toHaveBeenCalledWith('queued-1', 'An edited request');
    expect(onRemove).toHaveBeenCalledWith('queued-1');
  });
});
