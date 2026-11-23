import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCalendarComposerPinning } from './create-calendar-composer-pinning';
import { createCalendarComposerSession } from './create-calendar-composer-session';

const observers = new Map<Element, () => void>();
let width = 928;
beforeEach(() => {
  width = 928;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        observers.set(target, () =>
          this.callback(
            [
              {
                target,
                contentRect: new DOMRect(0, 0, width, 800),
                borderBoxSize: [],
                contentBoxSize: [],
                devicePixelContentBoxSize: [],
              },
            ],
            this
          )
        );
      }
      unobserve(target: Element) {
        observers.delete(target);
      }
      disconnect() {
        observers.clear();
      }
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, width, 800)
  );
});
afterEach(() => {
  cleanup();
  observers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('gates pinning on the calendar container instead of the browser width', () => {
  let pinning!: ReturnType<typeof createCalendarComposerPinning>;
  render(() => {
    const [element, setElement] = createSignal<HTMLElement>();
    pinning = createCalendarComposerPinning({
      boundary: element,
      requested: () => true,
      enabled: () => true,
    });
    return <div ref={setElement} />;
  });
  for (const [nextWidth, expected] of [
    [927, false],
    [928, true],
    [929, true],
  ] as const) {
    width = nextWidth;
    for (const notify of observers.values()) notify();
    expect(pinning.canPin()).toBe(expected);
    expect(pinning.pinned()).toBe(expected);
  }
});

it('floats and restores a pinned dirty draft without changing its session or preference', async () => {
  let pinning!: ReturnType<typeof createCalendarComposerPinning>;
  let sessions!: ReturnType<typeof createCalendarComposerSession>;
  const confirmDiscard = vi.fn().mockResolvedValue(false);
  render(() => {
    const [element, setElement] = createSignal<HTMLElement>();
    sessions = createCalendarComposerSession({ confirmDiscard });
    pinning = createCalendarComposerPinning({
      boundary: element,
      requested: () => sessions.state.pinned,
      enabled: () => true,
    });
    return <div ref={setElement} />;
  });
  const key = await sessions.open({
    initialValues: {
      title: 'Unfinished event',
      allDay: false,
      start: '2030-01-01T10:00',
      end: '2030-01-01T11:00',
      recurrenceLines: [],
      guests: '',
      location: '',
      description: '',
      conference: 'none',
    },
  });
  if (key === undefined) throw new Error('Session did not open');
  sessions.setDirty(key, true);
  sessions.setPinned(key, true);
  const draft = sessions.state.session;
  expect(pinning.pinned()).toBe(true);
  width = 700;
  for (const notify of observers.values()) notify();
  expect(pinning.canPin()).toBe(false);
  expect(pinning.pinned()).toBe(false);
  expect(sessions.state.pinned).toBe(true);
  expect(sessions.state.session).toBe(draft);
  expect(sessions.hasUnsavedChanges()).toBe(true);
  expect(draft?.request.initialValues?.title).toBe('Unfinished event');
  width = 1000;
  for (const notify of observers.values()) notify();
  expect(pinning.pinned()).toBe(true);
  expect(sessions.state.session).toBe(draft);
  expect(confirmDiscard).not.toHaveBeenCalled();
});
