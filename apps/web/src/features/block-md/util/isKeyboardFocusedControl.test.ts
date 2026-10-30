import { afterEach, expect, it } from 'vitest';
import { isKeyboardFocusedControl } from './isKeyboardFocusedControl';

afterEach(() => {
  document.body.replaceChildren();
});

function focused(html: string) {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild as HTMLElement;
  element.focus();
  return element;
}

it('leaves Enter to a focused button or link', () => {
  expect(isKeyboardFocusedControl(focused('<button>Open</button>'))).toBe(true);
  expect(isKeyboardFocusedControl(focused('<a href="/x">Open</a>'))).toBe(true);
  expect(
    isKeyboardFocusedControl(focused('<div role="button" tabindex="0"></div>'))
  ).toBe(true);
});

it('keeps Enter for the document everywhere else', () => {
  expect(isKeyboardFocusedControl(focused('<div tabindex="0"></div>'))).toBe(
    false
  );
  expect(isKeyboardFocusedControl(undefined)).toBe(false);

  document.body.innerHTML = '<button>Open</button><button>Other</button>';
  (document.body.lastElementChild as HTMLElement).focus();
  expect(isKeyboardFocusedControl(document.body.firstElementChild)).toBe(false);
});
