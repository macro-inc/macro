import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createKeyboardFocusedControl } from './createKeyboardFocusedControl';

let dispose = () => {};

function track() {
  return createRoot((disposer) => {
    dispose = disposer;
    return createKeyboardFocusedControl();
  });
}

function add(html: string) {
  document.body.insertAdjacentHTML('beforeend', html);
  return document.body.lastElementChild as HTMLElement;
}

afterEach(() => {
  dispose();
  document.body.replaceChildren();
});

it('leaves Enter to a control keyboard focus landed on', () => {
  const ownsEnter = track();

  for (const html of [
    '<button>Open</button>',
    '<a href="/x">Open</a>',
    '<div role="button" tabindex="0"></div>',
  ]) {
    const control = add(html);
    control.focus();
    expect(ownsEnter(control)).toBe(true);
  }
});

it('keeps Enter for the document everywhere else', () => {
  const ownsEnter = track();
  const button = add('<button>Open</button>');
  const pane = add('<div tabindex="0"></div>');

  pane.focus();

  expect(ownsEnter(pane)).toBe(false);
  expect(ownsEnter(button)).toBe(false);
  expect(ownsEnter(undefined)).toBe(false);
});

it('keeps Enter for the document after a click on a control', () => {
  const ownsEnter = track();
  const button = add('<button>Copy</button>');
  const matches = vi.spyOn(button, 'matches').mockReturnValue(false);

  button.focus();
  matches.mockRestore();

  expect(button.matches(':focus-visible')).toBe(true);
  expect(ownsEnter(button)).toBe(false);
});

it('hands Enter back after a click on the control keyboard focus is on', () => {
  const ownsEnter = track();
  const button = add('<button>Copy</button>');

  button.focus();
  expect(ownsEnter(button)).toBe(true);

  button.dispatchEvent(new Event('pointerdown', { bubbles: true }));

  expect(ownsEnter(button)).toBe(false);
});

it('forgets a control once focus moves on', () => {
  const ownsEnter = track();
  const button = add('<button>Open</button>');
  const pane = add('<div tabindex="0"></div>');

  button.focus();
  pane.focus();

  expect(ownsEnter(button)).toBe(false);
});
