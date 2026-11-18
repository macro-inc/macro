// @vitest-environment jsdom
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agendaShift } from './agenda-window';
import {
  createAgendaPaging,
  findAgendaDayAnchor,
} from './create-agenda-paging';

const end = vi.fn();
vi.mock('@app/observability/flow', () => ({
  beginInteraction: () => ({ end }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  end.mockClear();
});

describe('agenda paging', () => {
  it.each([-1, 1] as const)(
    'preserves the visible day when shifting %i',
    (direction) => {
      const callbacks: FrameRequestCallback[] = [];
      vi.stubGlobal(
        'requestAnimationFrame',
        (callback: FrameRequestCallback) => {
          callbacks.push(callback);
          return callbacks.length;
        }
      );
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
      const viewport = document.createElement('div');
      const start = new Date(2026, 2, 7);
      let first = -2;
      const render = () => {
        viewport.replaceChildren();
        for (let index = first; index < first + 5; index++) {
          for (let offset = 0; offset < 14; offset++) {
            const day = document.createElement('div');
            const date = agendaShift(start, index * 14 + offset);
            day.dataset.agendaDay = date.toDateString();
            const position = (index - first) * 1400 + offset * 100;
            day.getBoundingClientRect = () =>
              ({
                top: position - viewport.scrollTop,
                bottom: position + 100 - viewport.scrollTop,
              }) as DOMRect;
            viewport.append(day);
          }
        }
      };
      viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;

      createRoot((dispose) => {
        const paging = createAgendaPaging(() => viewport, start);
        render();
        viewport.scrollTop = direction === 1 ? 5500 : 100;
        const key = Array.from(viewport.children)
          .find((day) => day.getBoundingClientRect().bottom > 0)
          ?.getAttribute('data-agenda-day');
        const top = Array.from(viewport.children)
          .find((day) => day.getAttribute('data-agenda-day') === key)
          ?.getBoundingClientRect().top;
        paging.move(direction);
        expect(paging.indices()).toHaveLength(5);
        first += direction;
        render();
        callbacks.shift()?.(0);
        const restored = Array.from(viewport.children).find(
          (day) => day.getAttribute('data-agenda-day') === key
        );
        expect(restored?.getBoundingClientRect().top).toBe(top);
        expect(end).toHaveBeenCalledTimes(1);
        dispose();
      });
    }
  );

  it('moves polling ownership to the first visible window', () => {
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    Object.defineProperty(viewport, 'scrollHeight', { value: 4500 });
    Object.defineProperty(viewport, 'clientHeight', { value: 400 });
    const date = new Date(2026, 2, 7);
    for (const index of [-1, 0, 1]) {
      const window = document.createElement('section');
      window.dataset.agendaWindow = String(index);
      const day = document.createElement('div');
      day.dataset.agendaDay = agendaShift(date, index * 14).toDateString();
      const position = (index + 1) * 1500;
      day.getBoundingClientRect = () =>
        ({
          top: position - viewport.scrollTop,
          bottom: position + 1500 - viewport.scrollTop,
        }) as DOMRect;
      window.append(day);
      viewport.append(window);
    }
    createRoot((dispose) => {
      const paging = createAgendaPaging(() => viewport, date);
      paging.positionInitial();
      expect(viewport.scrollTop).toBe(1500);
      expect(paging.activeWindow()).toBe(0);
      viewport.scrollTop = 3100;
      paging.onScroll();
      expect(paging.activeWindow()).toBe(1);
      expect(paging.indices()).toEqual([-2, -1, 0, 1, 2]);
      dispose();
    });
  });

  it('starts on the requested day and closes pending work on unmount', () => {
    const callbacks: FrameRequestCallback[] = [];
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const day = document.createElement('div');
    day.dataset.agendaDay = new Date(2026, 2, 7).toDateString();
    day.getBoundingClientRect = () =>
      ({
        top: 2800 - viewport.scrollTop,
        bottom: 2900 - viewport.scrollTop,
      }) as DOMRect;
    viewport.append(day);
    createRoot((dispose) => {
      const paging = createAgendaPaging(() => viewport, new Date(2026, 2, 7));
      paging.positionInitial();
      expect(viewport.scrollTop).toBe(2800);
      paging.move(1);
      dispose();
      expect(cancel).toHaveBeenCalledWith(1);
      expect(end).toHaveBeenCalledTimes(1);
    });
  });

  it('preserves the requested day through late data and subsequent user scrolling', () => {
    const resize: Array<() => void> = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize.push(callback);
        }
        observe() {}
        disconnect = disconnect;
      }
    );
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    Object.defineProperty(viewport, 'scrollHeight', { value: 9000 });
    Object.defineProperty(viewport, 'clientHeight', { value: 400 });
    let earlierHeight = 1000;
    for (const index of [-1, 0]) {
      const window = document.createElement('section');
      window.dataset.agendaWindow = String(index);
      const day = document.createElement('section');
      day.dataset.agendaDay = new Date(
        2026,
        10,
        16 + index * 14
      ).toDateString();
      day.getBoundingClientRect = () => {
        const offset = index === -1 ? 0 : earlierHeight;
        const height = index === -1 ? earlierHeight : 600;
        return {
          top: 100 + offset - viewport.scrollTop,
          bottom: 100 + offset + height - viewport.scrollTop,
        } as DOMRect;
      };
      window.append(day);
      viewport.append(window);
    }
    const { paging, dispose } = createRoot((dispose) => ({
      paging: createAgendaPaging(() => viewport, new Date(2026, 10, 16)),
      dispose,
    }));
    paging.positionInitial();
    expect(viewport.scrollTop).toBe(1000);

    earlierHeight = 1500;
    // A queued initial scroll event must not adopt a different, now-visible day.
    paging.onScroll();
    resize[0]?.();
    expect(viewport.scrollTop).toBe(1500);
    expect(paging.activeWindow()).toBe(0);

    viewport.scrollTop = 1600;
    paging.onScroll();
    earlierHeight = 1900;
    resize[0]?.();
    expect(viewport.scrollTop).toBe(2000);
    expect(paging.activeWindow()).toBe(0);
    dispose();
    expect(disconnect).toHaveBeenCalled();
  });
});

it('anchors a date inside a collapsed empty range to the visible group', () => {
  const viewport = document.createElement('div');
  const group = document.createElement('section');
  group.dataset.agendaDay = new Date(2030, 10, 21).toDateString();
  group.dataset.agendaGroupEnd = new Date(2030, 10, 23).toDateString();
  const marker = document.createElement('section');
  marker.dataset.agendaDay = new Date(2030, 10, 22).toDateString();
  viewport.append(group, marker);
  expect(findAgendaDayAnchor(viewport, new Date(2030, 10, 22))).toBe(group);
  expect(findAgendaDayAnchor(viewport, new Date(2030, 10, 24))).toBeUndefined();
});
