import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { type InputClassOptions, inputClasses } from './Input';
import { InputGroup } from './InputGroup';
import { ToggleSwitch } from './ToggleSwitch';

const device = vi.hoisted(() => ({ touch: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  device.touch = false;
});

const tokens = (classes: string) => new Set(classes.split(/\s+/));

// Desktop inputs are pills; touch keeps rounded fields and their old inset,
// and a caller's own shape always wins.
it.each<{
  touch: boolean;
  options: InputClassOptions;
  has: string[];
  lacks: string[];
}>([
  {
    touch: false,
    options: {},
    has: ['rounded-full', 'px-3'],
    lacks: ['rounded-lg'],
  },
  {
    touch: true,
    options: {},
    has: ['rounded-lg', 'px-2'],
    lacks: ['rounded-full', 'px-3'],
  },
  {
    touch: true,
    options: { size: 'lg' },
    has: ['rounded-lg', 'px-3'],
    lacks: ['px-3.5'],
  },
  {
    touch: true,
    options: { class: 'rounded-none' },
    has: ['rounded-none'],
    lacks: ['rounded-lg'],
  },
  { touch: true, options: { class: 'px-0' }, has: ['px-0'], lacks: ['px-2'] },
  {
    touch: false,
    options: { class: 'rounded-[32px]' },
    has: ['rounded-[32px]'],
    lacks: ['rounded-full'],
  },
])('touch=$touch $options keeps the input shape', (row) => {
  device.touch = row.touch;
  const classes = tokens(inputClasses(row.options));
  for (const token of row.has) expect(classes).toContain(token);
  for (const token of row.lacks) expect(classes).not.toContain(token);
});

it.each([
  {
    touch: false,
    groupClass: undefined,
    has: 'rounded-full',
    lacks: 'rounded-lg',
  },
  {
    touch: true,
    groupClass: undefined,
    has: 'rounded-lg',
    lacks: 'rounded-full',
  },
  {
    touch: true,
    groupClass: 'rounded-none',
    has: 'rounded-none',
    lacks: 'rounded-lg',
  },
])('an input group on touch=$touch keeps its shape', (row) => {
  device.touch = row.touch;
  render(() => (
    <InputGroup aria-label="Search" class={row.groupClass}>
      <InputGroup.Input aria-label="Query" />
    </InputGroup>
  ));
  const group = tokens(screen.getByRole('group', { name: 'Search' }).className);
  expect(group).toContain(row.has);
  expect(group).not.toContain(row.lacks);
});

it('keeps an addon switch interactive without returning focus to the name', () => {
  const [checked, setChecked] = createSignal(false);
  render(() => (
    <InputGroup>
      <InputGroup.Input aria-label="Name" />
      <InputGroup.Addon align="inline-end">
        <ToggleSwitch
          label="Share with team"
          checked={checked()}
          onChange={setChecked}
        />
      </InputGroup.Addon>
    </InputGroup>
  ));
  const input = screen.getByRole('switch', { name: 'Share with team' });
  if (!(input instanceof HTMLInputElement) || !input.nextElementSibling)
    throw new Error('Missing native switch');
  const name = screen.getByRole('textbox', { name: 'Name' });
  name.focus();
  const focusName = vi.spyOn(name, 'focus');
  fireEvent.click(input.nextElementSibling);
  expect(input.checked).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(focusName).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Share with team'));
  expect(input.checked).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(focusName).not.toHaveBeenCalled();
  name.focus();
  focusName.mockClear();
  if (!input.parentElement) throw new Error('Missing switch root');
  fireEvent.click(input.parentElement);
  expect(input.checked).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(focusName).not.toHaveBeenCalled();
});
