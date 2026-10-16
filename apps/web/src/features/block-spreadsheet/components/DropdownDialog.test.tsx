import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DropdownDialog, type DropdownDialogState } from './DropdownDialog';

// App hotkey registries are outside this dialog fixture.
vi.mock('@ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));

let animationStyle: HTMLStyleElement;
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // jsdom reports an empty animation name, which keeps Presence waiting.
  animationStyle = document.createElement('style');
  animationStyle.textContent = '* { animation-name: none !important; }';
  document.head.append(animationStyle);
});
afterEach(() => {
  cleanup();
  animationStyle.remove();
  vi.restoreAllMocks();
});

function dialog(
  state: DropdownDialogState,
  rangeChoices: (range: string) => string[] | undefined = () => undefined
) {
  const onSave = vi.fn();
  render(() => (
    <DropdownDialog
      dialog={state}
      rangeChoices={rangeChoices}
      onSave={onSave}
      onRemove={() => {}}
      onClose={() => {}}
      onRestoreFocus={() => {}}
    />
  ));
  return onSave;
}

const swatch = (choice: string) =>
  screen
    .getByRole('button', { name: `Color of ${choice}` })
    .querySelector('[data-choice-color]')
    ?.getAttribute('data-choice-color');

async function pickColor(choice: string, color: string) {
  fireEvent.keyDown(
    screen.getByRole('button', { name: `Color of ${choice}` }),
    {
      key: 'ArrowDown',
    }
  );
  fireEvent.keyDown(await screen.findByRole('menuitem', { name: color }), {
    key: 'Enter',
  });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}

describe('dropdown dialog colors', () => {
  it('gives new choices the next unused color and saves each choice color', async () => {
    const onSave = dialog({ range: 'C2:C5', removable: false });
    const first = await screen.findByRole('textbox', { name: 'Choice 1' });
    fireEvent.input(first, { target: { value: 'Low' } });
    fireEvent.keyDown(first, { key: 'Enter' });
    const second = screen.getByRole('textbox', { name: 'Choice 2' });
    expect(document.activeElement).toBe(second);
    fireEvent.paste(second, {
      clipboardData: { getData: () => 'Medium\r\nHigh\n' },
    });
    expect(
      screen
        .getAllByRole('textbox', { name: /^Choice \d$/ })
        .map((input) => (input as HTMLInputElement).value)
    ).toEqual(['Low', 'Medium', 'High']);
    expect([swatch('Low'), swatch('Medium'), swatch('High')]).toEqual([
      '#bfdbfe',
      '#bbf7d0',
      '#fef08a',
    ]);

    await pickColor('High', 'Red');
    await pickColor('Low', 'No color');
    expect(swatch('High')).toBe('#fecaca');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      items: ['Low', 'Medium', 'High'],
      rejectInvalid: true,
      colors: [
        { item: 'Medium', color: '#bbf7d0' },
        { item: 'High', color: '#fecaca' },
      ],
    });
  });

  it('keeps a dropdown without colors plain until one of its choices is colored', async () => {
    const onSave = dialog({
      range: 'B2:B9',
      removable: true,
      current: { items: ['Open', 'Done'], rejectInvalid: true },
    });
    await screen.findByRole('textbox', { name: 'Choice 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Add choice' }));
    expect(swatch('choice 3')).toBe('');
    await pickColor('Done', 'Green');
    fireEvent.input(screen.getByRole('textbox', { name: 'Choice 3' }), {
      target: { value: 'Later' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add choice' }));
    expect(swatch('choice 4')).toBe('#bfdbfe');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      items: ['Open', 'Done', 'Later'],
      rejectInvalid: true,
      colors: [{ item: 'Done', color: '#bbf7d0' }],
    });
  });

  it('colors the values of a range source', async () => {
    const onSave = dialog(
      {
        range: 'D2',
        removable: true,
        current: {
          range: 'A2:A4',
          rejectInvalid: false,
          colors: [
            { item: 'Engineering', color: '#fecaca' },
            { item: 'Marketing', color: '#fed7aa' },
          ],
        },
      },
      (range) =>
        range === 'A2:A4' || range === 'A2:A3'
          ? ['Design', 'Engineering']
          : undefined
    );
    await screen.findByRole('textbox', { name: 'Range of choices' });
    expect(swatch('Design')).toBe('#bfdbfe');
    expect(swatch('Engineering')).toBe('#fecaca');
    await pickColor('Design', 'Teal');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // Marketing is not in the range now, such as a cleared source cell, but
    // keeps its color while the dropdown reads the same range.
    expect(onSave).toHaveBeenLastCalledWith({
      range: 'A2:A4',
      rejectInvalid: false,
      colors: [
        { item: 'Design', color: '#99f6e4' },
        { item: 'Engineering', color: '#fecaca' },
        { item: 'Marketing', color: '#fed7aa' },
      ],
    });
    fireEvent.input(screen.getByRole('textbox', { name: 'Range of choices' }), {
      target: { value: 'A2:A3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenLastCalledWith({
      range: 'A2:A3',
      rejectInvalid: false,
      colors: [
        { item: 'Design', color: '#99f6e4' },
        { item: 'Engineering', color: '#fecaca' },
      ],
    });
  });
});
