import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepSearchFocused } from './model-catalog-search';

let dispose: () => void;
let menu: HTMLDivElement;
let search: HTMLInputElement;
let trigger: HTMLButtonElement;
let row: HTMLButtonElement;

beforeEach(() => {
  vi.useFakeTimers();
  menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-labelledby', 'catalog-trigger');
  search = document.createElement('input');
  row = document.createElement('button');
  row.setAttribute('role', 'menuitemradio');
  trigger = document.createElement('button');
  trigger.id = 'catalog-trigger';
  menu.append(search, row);
  document.body.append(trigger, menu);
  createRoot((cleanup) => {
    dispose = cleanup;
    keepSearchFocused(() => search);
  });
});

afterEach(() => {
  dispose();
  menu.remove();
  trigger.remove();
  vi.useRealTimers();
});

describe('catalog search focus ownership', () => {
  it('wins deferred menu autofocus and parent-trigger focus without stealing intentional row focus', async () => {
    row.focus();
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe(search);

    trigger.focus();
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe(search);

    row.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    row.focus();
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe(row);
  });

  it.each(['ArrowDown', 'ArrowUp'])(
    'does not undo %s navigation before startup autofocus settles',
    async (key) => {
      search.focus();
      search.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true })
      );
      row.focus();
      await vi.runAllTimersAsync();
      expect(document.activeElement).toBe(row);
    }
  );

  it('cancels deferred autofocus when the owner is disposed', async () => {
    dispose();
    trigger.focus();
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not restore search from an already queued blur after disposal', async () => {
    await vi.runAllTimersAsync();
    trigger.focus();
    dispose();
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe(trigger);
  });
});
