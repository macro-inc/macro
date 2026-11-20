/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../menu/MentionsMenu', () => ({ MentionsMenu: () => null }));
vi.mock('../menu/EmojiMenu', () => ({ EmojiMenu: () => null }));
vi.mock('../menu/SnippetsMenu', () => ({ SnippetsMenu: () => null }));

import {
  COMMAND_PRIORITY_HIGH,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { MarkdownTextarea } from './MarkdownTextarea';

/** Reports each observed element once, which is how the editor learns it is mounted. */
class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    queueMicrotask(() => this.callback([], this));
  }
  unobserve() {}
  disconnect() {}
}
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const escapes = vi.fn();
const listen = (event: KeyboardEvent) => {
  if (event.key === 'Escape') escapes();
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  // jsdom lays nothing out; Lexical measures the caret to keep it in view.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('IntersectionObserver', ObserverStub);
  vi.stubGlobal('scrollTo', vi.fn() as unknown as typeof window.scrollTo);
  escapes.mockClear();
  // Where a dialog around the editor listens for Escape.
  document.addEventListener('keydown', listen);
});
afterEach(() => {
  document.removeEventListener('keydown', listen);
  cleanup();
  vi.unstubAllGlobals();
});

function showEditor(releaseEscape: boolean) {
  let editor!: LexicalEditor;
  render(() => (
    <MarkdownTextarea
      type="calendar"
      editable={() => true}
      initialHtml="<p>Agenda</p>"
      releaseEscape={releaseEscape}
      captureEditor={(captured) => {
        editor = captured;
      }}
      domRef={(element) => element.setAttribute('aria-label', 'Description')}
    />
  ));
  return {
    field: screen.findByLabelText('Description'),
    /** Takes Escape as the editor's menus do while one is open. */
    openMenu: () =>
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => true,
        COMMAND_PRIORITY_HIGH
      ),
  };
}

it('lets an Escape no menu takes leave the editor', async () => {
  const user = userEvent.setup();
  const editor = showEditor(true);
  await user.click(await editor.field);

  const closeMenu = editor.openMenu();
  await user.keyboard('{Escape}');
  expect(escapes).not.toHaveBeenCalled();

  closeMenu();
  await user.keyboard('{Escape}');
  expect(escapes).toHaveBeenCalledTimes(1);
});

it('keeps Escape to itself unless asked to release it', async () => {
  const user = userEvent.setup();
  await user.click(await showEditor(false).field);

  await user.keyboard('{Escape}');
  expect(escapes).not.toHaveBeenCalled();
});
