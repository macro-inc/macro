// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyOpenEventOutsidePress,
  consumeSuppressedCalendarDateSelection,
  handleOpenEventOutsidePress,
} from './open-event-outside-press';

// This jsdom build has no PointerEvent. The handler identifies primary
// presses with `instanceof PointerEvent`, so the stand-in has to be global.
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerType: string;
    constructor(
      type: string,
      init: MouseEventInit & { pointerType?: string } = {}
    ) {
      super(type, init);
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  globalThis.PointerEvent =
    PointerEventPolyfill as unknown as typeof PointerEvent;
}

function mountGrid() {
  document.body.innerHTML = `
    <div class="calendar-view">
      <div class="fc">
        <div id="slot" class="fc-timegrid-slot-lane"></div>
        <a id="event" class="fc-event"><span id="event-label">Standup</span></a>
        <div id="background" class="fc-bg-event fc-event"></div>
        <a id="nav" data-navlink></a>
        <div id="more" class="fc-popover"></div>
        <button id="event-target" data-calendar-event-target-navigation></button>
      </div>
    </div>
    <div class="fc">
      <div id="foreign-slot" class="fc-timegrid-slot-lane"></div>
    </div>
    <button id="outside" type="button">Sidebar</button>
  `;
}

function dispatchedPress(
  target: Element,
  init: PointerEventInit = { button: 0, pointerType: 'mouse' }
) {
  let action: ReturnType<typeof classifyOpenEventOutsidePress> | undefined;
  let outsidePrevented = false;
  let pointerPrevented = false;
  const listener = (event: Event) => {
    action = classifyOpenEventOutsidePress(event);
    const originalPreventDefault = event.preventDefault.bind(event);
    event.preventDefault = () => {
      pointerPrevented = true;
      originalPreventDefault();
    };
    handleOpenEventOutsidePress({
      preventDefault: () => {
        outsidePrevented = true;
      },
      detail: { originalEvent: event },
    });
  };
  target.addEventListener('pointerdown', listener);
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      ...init,
    })
  );
  target.removeEventListener('pointerdown', listener);
  return { action, outsidePrevented, pointerPrevented };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  consumeSuppressedCalendarDateSelection();
  document.body.innerHTML = '';
});

describe('open event outside press', () => {
  it('closes event details on an empty grid press without starting a new event', () => {
    mountGrid();
    const slot = document.getElementById('slot');
    if (!slot) throw new Error('missing slot');

    const result = dispatchedPress(slot);

    expect(result.action).toBe('close-without-creating');
    expect(result.outsidePrevented).toBe(false);
    expect(result.pointerPrevented).toBe(true);
    expect(consumeSuppressedCalendarDateSelection()).toBe(true);
    expect(consumeSuppressedCalendarDateSelection()).toBe(false);
  });

  it('keeps the details open when the press is another event or an event target', () => {
    mountGrid();
    for (const id of ['event', 'event-label', 'background', 'event-target']) {
      const target = document.getElementById(id);
      if (!target) throw new Error(`missing ${id}`);
      const result = dispatchedPress(target);
      expect(result.action, id).toBe('keep-open');
      expect(result.outsidePrevented, id).toBe(true);
      expect(result.pointerPrevented, id).toBe(false);
      expect(consumeSuppressedCalendarDateSelection(), id).toBe(false);
    }
  });

  it('still closes for presses that do not create an event', () => {
    mountGrid();
    for (const id of ['nav', 'more', 'foreign-slot', 'outside']) {
      const target = document.getElementById(id);
      if (!target) throw new Error(`missing ${id}`);
      const result = dispatchedPress(target);
      expect(result.action, id).toBe('close');
      expect(result.outsidePrevented, id).toBe(false);
      expect(result.pointerPrevented, id).toBe(false);
    }
  });

  it('does not cancel a touch or secondary press on empty grid time', () => {
    mountGrid();
    const slot = document.getElementById('slot');
    if (!slot) throw new Error('missing slot');

    expect(
      dispatchedPress(slot, { button: 0, pointerType: 'touch' }).action
    ).toBe('close');
    expect(
      dispatchedPress(slot, { button: 2, pointerType: 'mouse' }).action
    ).toBe('close');
    expect(consumeSuppressedCalendarDateSelection()).toBe(false);
  });

  it('suppresses only the selection reported by the dismissing gesture', () => {
    vi.useFakeTimers();
    mountGrid();
    const slot = document.getElementById('slot');
    if (!slot) throw new Error('missing slot');
    dispatchedPress(slot);

    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    // mouseup, where FullCalendar reports the selection, follows pointerup.
    expect(consumeSuppressedCalendarDateSelection()).toBe(true);

    vi.runAllTimers();
    expect(consumeSuppressedCalendarDateSelection()).toBe(false);
  });

  it('drops the suppression when the gesture ends without a selection', () => {
    vi.useFakeTimers();
    mountGrid();
    const slot = document.getElementById('slot');
    if (!slot) throw new Error('missing slot');
    dispatchedPress(slot);

    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    vi.runAllTimers();

    expect(consumeSuppressedCalendarDateSelection()).toBe(false);
  });
});
