import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MarkdownEditable,
  MarkdownPlaceholder,
  MarkdownShellContext,
} from './MarkdownShellParts';

afterEach(cleanup);

describe('MarkdownShell composition', () => {
  it('connects one editable element and retains its contents as presentation and disabled state change', () => {
    const connectRoot = vi.fn();
    const [disabled, setDisabled] = createSignal(false);
    const [className, setClassName] = createSignal('min-h-8');
    render(() => (
      <MarkdownShellContext.Provider
        value={{
          connectRoot,
          disabled,
          showPlaceholder: () => false,
          placeholder: () => '',
        }}
      >
        <MarkdownEditable
          role="textbox"
          aria-label="Message"
          class={className()}
        />
      </MarkdownShellContext.Provider>
    ));

    const editable = screen.getByRole('textbox', { name: 'Message' });
    editable.textContent = 'Unsent draft';
    setClassName('min-h-12');
    setDisabled(true);

    expect(screen.getByRole('textbox')).toBe(editable);
    expect(editable.textContent).toBe('Unsent draft');
    expect(editable.getAttribute('contenteditable')).toBe('false');
    expect(connectRoot.mock.calls[0][0]).toBe(editable);

    setDisabled(false);
    expect(editable.getAttribute('contenteditable')).toBe('true');
    expect(connectRoot).toHaveBeenCalledOnce();
  });

  it('shares reactive placeholder visibility and text with composed markup', () => {
    const [showPlaceholder, setShowPlaceholder] = createSignal(true);
    const [placeholder, setPlaceholder] = createSignal('Write a message');
    render(() => (
      <MarkdownShellContext.Provider
        value={{
          connectRoot: vi.fn(),
          disabled: () => false,
          showPlaceholder,
          placeholder,
        }}
      >
        <MarkdownPlaceholder>
          {(text) => <span>{text()}</span>}
        </MarkdownPlaceholder>
      </MarkdownShellContext.Provider>
    ));

    expect(screen.getByText('Write a message').tagName).toBe('SPAN');
    setPlaceholder('Reply to thread');
    expect(screen.queryByText('Write a message')).toBeNull();
    expect(screen.getByText('Reply to thread')).toBeTruthy();
    setShowPlaceholder(false);
    expect(screen.queryByText('Reply to thread')).toBeNull();
    setShowPlaceholder(true);
    expect(screen.getByText('Reply to thread')).toBeTruthy();
  });
});
