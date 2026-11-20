import { touchHandler } from '@core/directive/touchHandler';
import { fireEvent } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRowPress, holdRowPress, installRowPress } from './rowPress';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/mobile/haptics', () => ({ hapticImpact: () => {} }));

let uninstall: () => void;
let row: HTMLElement;
let label: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<div data-press-surface id="row"><span id="label">Row</span></div>';
  row = document.getElementById('row')!;
  label = document.getElementById('label')!;
  uninstall = installRowPress();
});

afterEach(() => {
  uninstall();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const pressed = () => row.classList.contains('touch-highlight');
const touchAt = (clientY: number) => ({
  touches: [{ clientX: 20, clientY }],
});

describe('row press', () => {
  it('shows after a still finger rests 100ms and stays 350ms after it lifts', () => {
    fireEvent.touchStart(label, touchAt(20));
    vi.advanceTimersByTime(99);
    expect(pressed()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(pressed()).toBe(true);

    fireEvent.touchEnd(label, { changedTouches: [{ clientX: 20 }] });
    vi.advanceTimersByTime(349);
    expect(pressed()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(pressed()).toBe(false);
  });

  it('shows a quick tap once its click arrives, and nothing for a tap without a click', () => {
    fireEvent.touchStart(label, touchAt(20));
    vi.advanceTimersByTime(40);
    fireEvent.touchEnd(label, { changedTouches: [{ clientX: 20 }] });
    vi.advanceTimersByTime(200);
    // A tap that stopped a scroll gets no click.
    expect(pressed()).toBe(false);

    fireEvent.touchStart(label, touchAt(20));
    vi.advanceTimersByTime(40);
    fireEvent.touchEnd(label, { changedTouches: [{ clientX: 20 }] });
    fireEvent.click(label);
    expect(pressed()).toBe(true);
    vi.advanceTimersByTime(350);
    expect(pressed()).toBe(false);
  });

  it('never shows for a press that turns into a scroll, and clears one that does after showing', () => {
    fireEvent.touchStart(label, touchAt(20));
    vi.advanceTimersByTime(60);
    fireEvent.touchMove(label, touchAt(26));
    vi.advanceTimersByTime(500);
    expect(pressed()).toBe(false);
    fireEvent.touchEnd(label, { changedTouches: [{ clientX: 20 }] });
    fireEvent.click(label);
    expect(pressed()).toBe(false);

    fireEvent.touchStart(label, touchAt(20));
    vi.advanceTimersByTime(100);
    expect(pressed()).toBe(true);
    fireEvent.touchMove(label, touchAt(24));
    expect(pressed()).toBe(true);
    fireEvent.touchMove(label, touchAt(26));
    expect(pressed()).toBe(false);
  });

  it('clears on a cancelled touch or a second finger', () => {
    fireEvent.touchStart(label, touchAt(20));
    vi.advanceTimersByTime(100);
    fireEvent.touchCancel(label);
    expect(pressed()).toBe(false);

    fireEvent.touchStart(label, touchAt(20));
    vi.advanceTimersByTime(100);
    fireEvent.touchStart(label, {
      touches: [
        { clientX: 20, clientY: 20 },
        { clientX: 80, clientY: 20 },
      ],
    });
    expect(pressed()).toBe(false);
  });

  it('clears on a context menu, and when a row menu clears the press', () => {
    fireEvent.touchStart(label, touchAt(20));
    vi.advanceTimersByTime(100);
    fireEvent.contextMenu(label);
    expect(pressed()).toBe(false);
    fireEvent.touchEnd(label, { changedTouches: [{ clientX: 20 }] });
    fireEvent.click(label);
    expect(pressed()).toBe(false);

    // A long press opens the row's action drawer, even mid-navigation.
    fireEvent.touchStart(label, touchAt(20));
    vi.advanceTimersByTime(100);
    const event = new MouseEvent('click', { bubbles: true });
    label.dispatchEvent(event);
    holdRowPress(event);
    clearRowPress(label);
    expect(pressed()).toBe(false);
    fireEvent.touchEnd(label, { changedTouches: [{ clientX: 20 }] });
    vi.advanceTimersByTime(1000);
    expect(pressed()).toBe(false);

    // A menu trigger that wraps the row clears the row inside it.
    fireEvent.touchStart(label, touchAt(20));
    vi.advanceTimersByTime(100);
    clearRowPress(document.body);
    expect(pressed()).toBe(false);
  });

  it('clears when a long press opens the row menu', () => {
    const onLongPress = vi.fn();
    createRoot((dispose) => {
      touchHandler(row, () => ({ onLongPress }));
      fireEvent.touchStart(label, touchAt(20));
      vi.advanceTimersByTime(499);
      expect(pressed()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(onLongPress).toHaveBeenCalledOnce();
      expect(pressed()).toBe(false);
      fireEvent.touchEnd(label, { changedTouches: [{ clientX: 20 }] });
      vi.advanceTimersByTime(1000);
      expect(pressed()).toBe(false);
      dispose();
    });
  });

  it('ends a press whose touched element left the page under the finger', () => {
    fireEvent.touchStart(label, touchAt(20));
    label.remove();
    vi.advanceTimersByTime(100);
    expect(pressed()).toBe(true);

    // The lift goes to the removed element, never reaching the document.
    fireEvent.touchEnd(label, { changedTouches: [{ clientX: 20 }] });
    vi.advanceTimersByTime(350);
    expect(pressed()).toBe(false);
  });

  it('presses the soup row container rather than the surface inside it', () => {
    document.body.innerHTML =
      '<div data-soup-entity id="container"><div data-press-surface><span id="inner">Row</span></div></div>';
    const container = document.getElementById('container')!;
    fireEvent.touchStart(document.getElementById('inner')!, touchAt(20));
    vi.advanceTimersByTime(100);
    expect(container.classList.contains('touch-highlight')).toBe(true);
  });

  it('holds a tapped row through its navigation, for at least 500ms', () => {
    const event = new MouseEvent('click', { bubbles: true });
    label.dispatchEvent(event);
    const release = holdRowPress(event);
    expect(pressed()).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(pressed()).toBe(true);

    release?.();
    expect(pressed()).toBe(true);
    vi.advanceTimersByTime(500);
    expect(pressed()).toBe(false);
  });

  it('holds a quickly opened row until 500ms after the tap', () => {
    const event = new MouseEvent('click', { bubbles: true });
    label.dispatchEvent(event);
    const release = holdRowPress(event);
    vi.advanceTimersByTime(200);
    release?.();
    vi.advanceTimersByTime(299);
    expect(pressed()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(pressed()).toBe(false);
  });

  it('keeps the row pressed while a later navigation from it still runs', () => {
    const first = new MouseEvent('click', { bubbles: true });
    label.dispatchEvent(first);
    const releaseFirst = holdRowPress(first);
    vi.advanceTimersByTime(200);
    const second = new MouseEvent('click', { bubbles: true });
    label.dispatchEvent(second);
    const releaseSecond = holdRowPress(second);

    vi.advanceTimersByTime(400);
    releaseFirst?.();
    releaseFirst?.();
    vi.advanceTimersByTime(1000);
    expect(pressed()).toBe(true);

    releaseSecond?.();
    vi.advanceTimersByTime(0);
    expect(pressed()).toBe(false);
  });
});
