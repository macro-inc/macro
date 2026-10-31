import { afterEach, expect, it } from 'vitest';
import { focusPopoverInput } from './focusPopoverInput';

afterEach(() => {
  document.body.replaceChildren();
});

function popover(markup: string) {
  const container = document.createElement('div');
  container.innerHTML = markup;
  document.body.append(container);
  return container;
}

const initialFocus = () => new Event('initial-focus', { cancelable: true });

it('focuses a declared input in place of the first control', () => {
  const container = popover('<button>Close</button><input autofocus />');
  const event = initialFocus();
  focusPopoverInput(event, container);
  expect(document.activeElement).toBe(container.querySelector('input'));
  expect(event.defaultPrevented).toBe(true);
});

it('leaves focus with a field the content already focused', () => {
  const container = popover(
    '<button>Close</button><div contenteditable="true"></div>'
  );
  const title = container.querySelector<HTMLElement>('[contenteditable]');
  title?.focus();
  const event = initialFocus();
  focusPopoverInput(event, container);
  expect(document.activeElement).toBe(title);
  expect(event.defaultPrevented).toBe(true);
});

it("leaves focus with the opening tap's stand-in input", () => {
  const container = popover('<button>Close</button>');
  const standIn = document.createElement('input');
  standIn.setAttribute('data-focus-stand-in', '');
  document.body.append(standIn);
  standIn.focus();
  const event = initialFocus();
  focusPopoverInput(event, container);
  expect(document.activeElement).toBe(standIn);
  expect(event.defaultPrevented).toBe(true);
});

it('leaves a field outside the popover to the default focus', () => {
  const outside = document.createElement('input');
  document.body.append(outside);
  outside.focus();
  const event = initialFocus();
  focusPopoverInput(event, popover('<button>Close</button>'));
  expect(event.defaultPrevented).toBe(false);
});
