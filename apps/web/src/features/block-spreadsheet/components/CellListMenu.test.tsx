import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CellListMenu } from './CellListMenu';

let animationStyle: HTMLStyleElement;
beforeEach(() => {
  // jsdom reports an empty animation name, which keeps Presence waiting.
  animationStyle = document.createElement('style');
  animationStyle.textContent = '* { animation-name: none !important; }';
  document.head.append(animationStyle);
});
afterEach(() => {
  cleanup();
  animationStyle.remove();
});

it('shows each colored choice as a chip of its color', async () => {
  const onPick = vi.fn();
  render(() => {
    const [open, setOpen] = createSignal(false);
    return (
      <CellListMenu
        address="B2"
        items={['Low', 'High']}
        colors={new Map([['high', '#fecaca']])}
        open={open()}
        onOpenChange={setOpen}
        style={{}}
        buttonSize={16}
        onPick={onPick}
        onRestoreFocus={() => {}}
        onPointerDownOutside={() => {}}
      />
    );
  });
  fireEvent.keyDown(
    screen.getByRole('button', { name: 'Choose a value for B2' }),
    { key: 'ArrowDown' }
  );
  const high = await screen.findByRole('menuitem', { name: 'High' });
  expect(
    high.querySelector<HTMLElement>('[data-choice-chip]')?.style.backgroundColor
  ).toBe('rgb(254, 202, 202)');
  expect(
    screen
      .getByRole('menuitem', { name: 'Low' })
      .querySelector('[data-choice-chip]')
  ).toBeNull();
  fireEvent.keyDown(high, { key: 'Enter' });
  expect(onPick).toHaveBeenCalledWith('High');
});
