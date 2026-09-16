import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownShellContent } from './MarkdownShellContent';

afterEach(cleanup);

describe('MarkdownShell content', () => {
  it('connects one editable element and retains its contents as presentation and disabled state change', () => {
    const connectRoot = vi.fn();
    const [disabled, setDisabled] = createSignal(false);
    const [showPlaceholder, setShowPlaceholder] = createSignal(false);
    const { container } = render(() => (
      <MarkdownShellContent
        connectRoot={connectRoot}
        disabled={disabled()}
        showPlaceholder={showPlaceholder()}
        placeholder="Message"
      />
    ));

    const editable =
      container.querySelector<HTMLDivElement>('[contenteditable]')!;
    expect(container.querySelectorAll('[contenteditable]')).toHaveLength(1);
    editable.textContent = 'Unsent draft';
    setShowPlaceholder(true);
    setDisabled(true);

    expect(container.querySelector('[contenteditable]')).toBe(editable);
    expect(editable.textContent).toBe('Unsent draft');
    expect(editable.getAttribute('contenteditable')).toBe('false');
    expect(connectRoot.mock.calls[0][0]).toBe(editable);

    setDisabled(false);
    expect(editable.getAttribute('contenteditable')).toBe('true');
    expect(connectRoot).toHaveBeenCalledOnce();
  });

  it('updates placeholder text and visibility without replacing the editable', () => {
    const [showPlaceholder, setShowPlaceholder] = createSignal(true);
    const [placeholder, setPlaceholder] = createSignal('Write a message');
    const { container } = render(() => (
      <MarkdownShellContent
        connectRoot={vi.fn()}
        disabled={false}
        showPlaceholder={showPlaceholder()}
        placeholder={placeholder()}
      />
    ));

    const editable = container.querySelector('[contenteditable]');
    expect(screen.getByText('Write a message')).toBeTruthy();
    setPlaceholder('Reply to thread');
    expect(screen.queryByText('Write a message')).toBeNull();
    expect(screen.getByText('Reply to thread')).toBeTruthy();
    setShowPlaceholder(false);
    expect(screen.queryByText('Reply to thread')).toBeNull();
    setShowPlaceholder(true);
    expect(screen.getByText('Reply to thread')).toBeTruthy();
    expect(container.querySelector('[contenteditable]')).toBe(editable);
  });
});
