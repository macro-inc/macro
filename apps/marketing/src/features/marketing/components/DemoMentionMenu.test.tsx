import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mentionAtCaret } from '../core/demo-mentions';
import { DemoMentionMenu } from './DemoMentionMenu';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('fetch', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
});
afterEach(() => {
  cleanup();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

function composer() {
  const send = vi.fn();
  let draft!: () => string;
  render(() => {
    const [value, setValue] = createSignal('');
    draft = value;
    return (
      <>
        <DemoMentionMenu />
        <div class="workspace-demo">
          <textarea
            aria-label="Message"
            value={value()}
            onInput={(event) => setValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') send();
            }}
          />
          <input aria-label="Search workspace" />
        </div>
        <input aria-label="Signup email" />
      </>
    );
  });
  const editor = screen.getByRole('textbox', {
    name: 'Message',
  }) as HTMLTextAreaElement;
  editor.focus();
  return { editor, draft: () => draft(), send };
}

it('shows standard groups, filters, and inserts through controlled input without sending', () => {
  const { editor, draft, send } = composer();
  fireEvent.input(editor, { target: { value: 'Please ask @' } });
  expect(screen.getByRole('listbox')).toBeTruthy();
  expect(screen.getByText('People')).toBeTruthy();
  expect(screen.getByText('Documents, Agents, & Tasks')).toBeTruthy();
  expect(screen.getByRole('option', { name: 'launch' })).toBeTruthy();
  fireEvent.input(editor, { target: { value: 'Please ask @julia' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.keyDown(editor, { key: 'Enter' });
  expect(draft()).toBe('Please ask @Julia Westphal ');
  expect(send).not.toHaveBeenCalled();
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.input(editor, { target: { value: `${draft()}to review this` } });
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.input(editor, { target: { value: `${draft()} with @cursor` } });
  expect(screen.getByRole('option', { name: 'Cursor' })).toBeTruthy();
  fireEvent.keyDown(editor, { key: 'Tab' });
  expect(draft()).toContain('@Cursor ');
});

it('supports arrow selection, mouse selection, dismissal, and empty results', () => {
  const { editor, draft } = composer();
  fireEvent.input(editor, { target: { value: '@' } });
  fireEvent.keyDown(editor, { key: 'ArrowDown' });
  expect(
    screen.getByRole('option', { name: 'Teo' }).getAttribute('aria-selected')
  ).toBe('true');
  fireEvent.keyDown(editor, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(editor.getAttribute('aria-controls')).toBeNull();
  fireEvent.input(editor, { target: { value: '@xyzunknown' } });
  expect(screen.getByText('No matching demo items')).toBeTruthy();
  expect(editor.getAttribute('aria-activedescendant')).toBeNull();
  fireEvent.keyDown(editor, { key: 'Tab' });
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.input(editor, { target: { value: '@checklist' } });
  fireEvent.click(
    screen.getByRole('option', { name: 'Prepare the launch checklist' })
  );
  expect(draft()).toBe('@Prepare the launch checklist ');
});

it('inserts into nested contenteditable markup while preserving surrounding text', () => {
  const input = vi.fn();
  render(() => (
    <>
      <DemoMentionMenu />
      <div class="workspace-demo">
        <div
          contentEditable
          role="textbox"
          aria-label="Document"
          onInput={input}
        >
          <p>
            <strong>Keep this </strong>
            <span>@q3</span> and this.
          </p>
        </div>
      </div>
    </>
  ));
  const editor = screen.getByRole('textbox', { name: 'Document' });
  editor.focus();
  const query = editor.querySelector('span')!.firstChild!;
  const range = document.createRange();
  range.setStart(query, 3);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.input(editor);
  fireEvent.keyDown(editor, { key: 'Enter' });
  expect(editor.textContent).toBe('Keep this Q3 launch plan  and this.');
  expect(
    editor
      .querySelector('[data-demo-mention="plan"]')
      ?.getAttribute('contenteditable')
  ).toBe('false');
  expect(editor.querySelector('.mention-document svg')).toBeTruthy();
  expect(editor.querySelector('strong')?.textContent).toBe('Keep this ');
  expect(input).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('leaves search, signup, and ordinary email addresses alone', () => {
  const { editor } = composer();
  fireEvent.input(editor, { target: { value: 'jacob@example.com' } });
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.input(screen.getByRole('textbox', { name: 'Search workspace' }), {
    target: { value: '@' },
  });
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.input(screen.getByRole('textbox', { name: 'Signup email' }), {
    target: { value: '@' },
  });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(mentionAtCaret('Hi (@Teo', 8)).toEqual({
    start: 4,
    end: 8,
    query: 'Teo',
  });
});

it('supports opted-in legacy demos without changing their style scope', () => {
  render(() => (
    <>
      <DemoMentionMenu />
      <div data-demo-mentions="on">
        <input aria-label="Legacy document" />
      </div>
    </>
  ));
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: '@metrics' },
  });
  expect(screen.getByRole('option', { name: 'Launch metrics' })).toBeTruthy();
});

it('uses the real menu category drilldown and return behavior', () => {
  const { editor } = composer();
  fireEvent.input(editor, { target: { value: '@' } });
  fireEvent.click(screen.getByRole('button', { name: 'View all (10)' }));
  expect(screen.queryByText('People')).toBeNull();
  expect(screen.getAllByRole('option')).toHaveLength(10);
  fireEvent.click(screen.getByRole('button', { name: '← Back to everything' }));
  expect(screen.getByText('People')).toBeTruthy();
  fireEvent.keyDown(editor, { key: 'ArrowRight' });
  expect(screen.getAllByRole('option')).toHaveLength(5);
  fireEvent.keyDown(editor, { key: 'ArrowLeft' });
  expect(screen.getByText('Channels')).toBeTruthy();
});
