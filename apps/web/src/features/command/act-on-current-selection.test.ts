import { flushableDebouncedDependent } from '@core/util/debounce';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { actOnCurrentSelection } from './act-on-current-selection';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const RESULTS: Record<string, string> = { jac: 'Jacob', jack: 'Jack' };

function setup() {
  const [typed, setTyped] = createSignal('jac');
  let dispose = () => {};
  const menu = createRoot((cleanup) => {
    dispose = cleanup;
    const [query, flushQuery] = flushableDebouncedDependent(typed, 60);
    return { flushQuery, selectedItem: () => RESULTS[query()] };
  });
  return { ...menu, setTyped, dispose };
}

it.each([
  ['Enter', (item: string) => `open ${item}`],
  ['Shift+Enter', (item: string) => `open ${item} in a new split`],
  ['Cmd+Enter', (item: string) => `open ${item} in a new tab`],
])(
  '%s within the debounce acts on the row for the text on screen, in the same keypress',
  (_key, describe) => {
    const menu = setup();
    const acted: string[] = [];
    menu.setTyped('jack');

    const handled = actOnCurrentSelection({
      flushQuery: menu.flushQuery,
      selectedItem: menu.selectedItem,
      act: (item) => acted.push(describe(item)),
    });

    expect(handled).toBe(true);
    expect(acted).toEqual([describe('Jack')]);
    menu.dispose();
  }
);

it('reports nothing to act on when the typed text has no row', () => {
  const menu = setup();
  const act = vi.fn();
  menu.setTyped('zzq');

  expect(
    actOnCurrentSelection({
      flushQuery: menu.flushQuery,
      selectedItem: menu.selectedItem,
      act,
    })
  ).toBe(false);
  expect(act).not.toHaveBeenCalled();
  menu.dispose();
});
