// @vitest-environment jsdom
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agendaShift } from './agenda-window';
import { createAgendaPaging } from './create-agenda-paging';

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
});
