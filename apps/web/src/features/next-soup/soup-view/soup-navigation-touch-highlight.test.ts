import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { soupNavigationTouchHighlight } from './soup-navigation-touch-highlight';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));

let dispose: (() => void) | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

function setup() {
  const container = document.createElement('div');
  const row = document.createElement('div');
  row.dataset.soupEntity = '';
  container.append(row);
  document.body.append(container);
  const clear = createRoot((cleanup) => {
    dispose = cleanup;
    return soupNavigationTouchHighlight(container);
  });
  if (!clear) throw new Error('Touch highlight did not attach');
  return { row, clear };
}

function touch(row: HTMLElement, type: string) {
  const event = new Event(type, { bubbles: true });
  const point = { clientX: 20, clientY: 20 };
  Object.defineProperties(event, {
    touches: { value: type === 'touchend' ? [] : [point] },
    changedTouches: { value: [point] },
  });
  row.dispatchEvent(event);
}

describe('touch highlight cancellation', () => {
  it.each(['pointerup', 'pointercancel', 'touchcancel', 'contextmenu'])(
    'clears an active press on %s',
    (event) => {
      const { row } = setup();
      touch(row, 'touchstart');
      vi.advanceTimersByTime(20);
      expect(row.classList.contains('touch-highlight')).toBe(true);
      row.dispatchEvent(new Event(event, { bubbles: true }));
      expect(row.classList.contains('touch-highlight')).toBe(false);
      vi.runAllTimers();
      expect(row.classList.contains('touch-highlight')).toBe(false);
    }
  );

  it('cancels a pending highlight when the action drawer opens', () => {
    const { row, clear } = setup();
    touch(row, 'touchstart');
    clear();
    vi.runAllTimers();
    expect(row.classList.contains('touch-highlight')).toBe(false);
  });

  it('clears the delayed touch-end highlight when the drawer closes', () => {
    const { row, clear } = setup();
    touch(row, 'touchstart');
    vi.advanceTimersByTime(20);
    touch(row, 'touchend');
    expect(row.classList.contains('touch-highlight')).toBe(true);
    clear();
    expect(row.classList.contains('touch-highlight')).toBe(false);
    vi.runAllTimers();
    expect(row.classList.contains('touch-highlight')).toBe(false);
  });
});
