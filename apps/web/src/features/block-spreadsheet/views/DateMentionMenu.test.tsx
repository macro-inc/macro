import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateMentionMenu } from './DateMentionMenu';

describe('dates from the @ menu', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function renderMenu(term: string) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 16, 23, 30));
    const pick = vi.fn();
    const [open, setOpen] = createSignal(true);
    const anchor = document.createElement('span');
    document.body.append(anchor);
    render(() => (
      <Show when={open()}>
        <DateMentionMenu
          menu={{ searchTerm: () => term, closeMenu: () => setOpen(false) }}
          anchor={anchor}
          pick={pick}
        >
          {(pickDate) => (
            <button type="button" onClick={() => pickDate(new Date())}>
              Today
            </button>
          )}
        </DateMentionMenu>
      </Show>
    ));
    return { pick, open };
  }

  it('enters a picked day as typed date text, not a chip', () => {
    const { pick } = renderMenu('tod');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(pick).toHaveBeenCalledWith('10/16/2026');
  });

  it('shows a calendar for @date whose keys pick a day before the editor sees them', () => {
    const { pick } = renderMenu('date');
    const editor = document.createElement('div');
    document.body.append(editor);
    const editorKeys = vi.fn();
    editor.addEventListener('keydown', editorKeys);
    expect(document.querySelector('[data-cell-date-picker]')).not.toBeNull();
    fireEvent.keyDown(editor, { key: 'ArrowRight' });
    fireEvent.keyDown(editor, { key: 'ArrowDown' });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(pick).toHaveBeenCalledWith('10/24/2026');
    expect(editorKeys).not.toHaveBeenCalled();
    editor.remove();
  });

  it('closes the @date calendar on Escape without picking', () => {
    const { pick, open } = renderMenu('Date');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(open()).toBe(false);
    expect(pick).not.toHaveBeenCalled();
    expect(document.querySelector('[data-cell-date-picker]')).toBeNull();
  });
});
