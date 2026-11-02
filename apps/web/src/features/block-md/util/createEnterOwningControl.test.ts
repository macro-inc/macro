import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createEnterOwningControl } from './createEnterOwningControl';

let dispose = () => {};

function track() {
  return createRoot((disposer) => {
    dispose = disposer;
    return createEnterOwningControl();
  });
}

function add(html: string) {
  document.body.insertAdjacentHTML('beforeend', html);
  return document.body.lastElementChild as HTMLElement;
}

function press(element: Element) {
  element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
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

  press(button);
  button.focus();

  expect(ownsEnter(button)).toBe(false);
});

it('keeps Enter for the document after a click on a control icon', () => {
  const ownsEnter = track();
  const button = add('<button><svg></svg></button>');

  press(button.querySelector('svg') as SVGElement);
  button.focus();

  expect(ownsEnter(button)).toBe(false);
});

it('leaves Enter to a control given focus back after a press elsewhere', () => {
  const ownsEnter = track();
  const trigger = add('<button>Project</button>');
  const outside = add('<div></div>');
  // A browser doesn't count this focus as :focus-visible; jsdom always does.
  const matches = trigger.matches.bind(trigger);
  vi.spyOn(trigger, 'matches').mockImplementation(
    (selector) => selector !== ':focus-visible' && matches(selector)
  );

  press(outside);
  trigger.focus();

  expect(ownsEnter(trigger)).toBe(true);
});

it('leaves Enter to a clicked control that keyboard focus comes back to', () => {
  const ownsEnter = track();
  const button = add('<button>Copy</button>');
  const pane = add('<div tabindex="0"></div>');

  press(button);
  button.focus();
  pane.focus();
  button.focus();

  expect(ownsEnter(button)).toBe(true);
});

it('hands Enter back after a click on the control keyboard focus is on', () => {
  const ownsEnter = track();
  const button = add('<button>Copy</button>');

  button.focus();
  expect(ownsEnter(button)).toBe(true);

  press(button);

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
