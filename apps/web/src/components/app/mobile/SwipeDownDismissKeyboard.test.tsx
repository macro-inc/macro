import {
  setVirtualKeyboardHeight,
  setVirtualKeyboardVisible,
} from '@core/mobile/virtualKeyboard';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SwipeDownDismissKeyboard } from './SwipeDownDismissKeyboard';

vi.mock('@core/util/platform', () => ({ isPlatform: () => true }));

// jsdom's window is 768px tall; with a 300px keyboard its top is at 468px,
// and the dismiss zone covers 448-468px.
beforeEach(() => {
  setVirtualKeyboardVisible(true);
  setVirtualKeyboardHeight(300);
});
afterEach(() => {
  cleanup();
  setVirtualKeyboardVisible(false);
  setVirtualKeyboardHeight(0);
});

function touch(target: Element, type: string, y: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'touches', {
    value: [{ clientX: 100, clientY: y }],
  });
  target.dispatchEvent(event);
}

function renderComposer(textScrollTop: number) {
  render(() => (
    <div>
      <div>Messages</div>
      <SwipeDownDismissKeyboard />
      <div data-composer-scroll>
        <div contentEditable tabIndex={0}>
          Long draft
        </div>
      </div>
    </div>
  ));
  const editor = screen.getByText('Long draft');
  const textScroll = editor.parentElement!;
  let scrollTop = textScrollTop;
  Object.defineProperty(textScroll, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  editor.focus();
  return { editor, textScroll, messages: screen.getByText('Messages') };
}

it('dismisses the keyboard on a swipe down from outside the composer text', () => {
  const { editor, messages } = renderComposer(120);

  touch(messages, 'touchstart', 300);
  touch(messages, 'touchmove', 400);
  touch(messages, 'touchmove', 455);

  expect(document.activeElement).not.toBe(editor);
});

it('scrolls a long draft without dismissing while its text can scroll up', () => {
  const { editor } = renderComposer(120);

  touch(editor, 'touchstart', 400);
  touch(editor, 'touchmove', 430);
  touch(editor, 'touchmove', 455);
  touch(editor, 'touchmove', 465);

  expect(document.activeElement).toBe(editor);
});

it('dismisses once the draft reaches its top and the drag keeps going down', () => {
  const { editor, textScroll } = renderComposer(40);

  touch(editor, 'touchstart', 400);
  touch(editor, 'touchmove', 450);
  textScroll.scrollTop = 0;
  touch(editor, 'touchmove', 452);
  expect(document.activeElement).toBe(editor);

  touch(editor, 'touchmove', 460);
  expect(document.activeElement).not.toBe(editor);
});

it('does not count the move that scrolled the draft to its top', () => {
  const { editor, textScroll } = renderComposer(8);

  touch(editor, 'touchstart', 400);
  touch(editor, 'touchmove', 450);
  textScroll.scrollTop = 0;
  touch(editor, 'touchmove', 460);
  expect(document.activeElement).toBe(editor);

  touch(editor, 'touchmove', 467);
  expect(document.activeElement).not.toBe(editor);
});

it('dismisses on a swipe down inside a draft that is already at its top', () => {
  const { editor } = renderComposer(0);

  touch(editor, 'touchstart', 400);
  touch(editor, 'touchmove', 455);

  expect(document.activeElement).not.toBe(editor);
});
