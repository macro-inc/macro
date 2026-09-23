import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueuedPrompts } from './QueuedPrompts';

const editor = vi.hoisted(() => ({
  change: undefined as ((markdown: string) => void) | undefined,
  markdown: 'Queued request',
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
        lexical: { getRootElement: () => null },
        controls: {
          focus: vi.fn(),
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
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('queued prompt access', () => {
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
