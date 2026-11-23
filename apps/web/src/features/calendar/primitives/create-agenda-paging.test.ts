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
      viewport.dispatchEvent(new WheelEvent('wheel'));
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

  it('preserves the requested day through late data and browser-initiated scrolling', () => {
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

  it('keeps the logical date anchored when late results collapse its day group', () => {
    let resize: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    const window = document.createElement('section');
    window.dataset.agendaWindow = '0';
    viewport.append(window);
    let earlierHeight = 1000;
    const renderGroup = (start: number) => {
      const day = document.createElement('section');
      day.dataset.agendaDay = new Date(2026, 10, start).toDateString();
      day.dataset.agendaGroupEnd = new Date(2026, 10, 16).toDateString();
      day.getBoundingClientRect = () =>
        ({
          top: 100 + earlierHeight - viewport.scrollTop,
          bottom: 700 + earlierHeight - viewport.scrollTop,
        }) as DOMRect;
      window.replaceChildren(day);
      return day;
    };
    const initial = renderGroup(16);
    const { paging, dispose } = createRoot((dispose) => ({
      paging: createAgendaPaging(() => viewport, new Date(2026, 10, 16)),
      dispose,
    }));
    paging.positionInitial();
    resize?.();
    expect(viewport.scrollTop).toBe(1000);
    viewport.dispatchEvent(new WheelEvent('wheel'));

    earlierHeight = 1500;
    resize?.();
    expect(viewport.scrollTop).toBe(1500);
    expect(initial.getBoundingClientRect().top).toBe(100);

    // Agenda keeps a zero-height day marker when an earlier empty group absorbs it.
    earlierHeight = 1800;
    const collapsed = renderGroup(14);
    window.append(initial);
    initial.getBoundingClientRect = () =>
      ({
        top: 196 + earlierHeight - viewport.scrollTop,
        bottom: 196 + earlierHeight - viewport.scrollTop,
      }) as DOMRect;
    expect(viewport.contains(initial)).toBe(true);
    resize?.();
    expect(viewport.scrollTop).toBe(1800);
    expect(collapsed.getBoundingClientRect().top).toBe(100);
    dispose();
  });
  it('does not rotate a short initial window before the reader takes over', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const day = document.createElement('section');
    day.dataset.agendaDay = new Date(2026, 10, 16).toDateString();
    day.getBoundingClientRect = () => ({ top: 0, bottom: 100 }) as DOMRect;
    viewport.append(day);
    const { paging, dispose } = createRoot((dispose) => ({
      paging: createAgendaPaging(() => viewport, new Date(2026, 10, 16)),
      dispose,
    }));
    paging.positionInitial();
    paging.onScroll();
    expect(paging.indices()).toEqual([-2, -1, 0, 1, 2]);
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    expect(paging.indices()).toEqual([-3, -2, -1, 0, 1]);
    dispose();
  });
  it('keeps initial positioning when a shrinking list clamps the browser scroll', () => {
    let resize: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    let height = 6000;
    Object.defineProperty(viewport, 'scrollHeight', { get: () => height });
    Object.defineProperty(viewport, 'clientHeight', { value: 400 });
    const day = document.createElement('section');
    day.dataset.agendaDay = new Date(2026, 10, 16).toDateString();
    day.getBoundingClientRect = () =>
      ({
        top: 1000 - viewport.scrollTop,
        bottom: 1100 - viewport.scrollTop,
      }) as DOMRect;
    viewport.append(day);
    const { paging, dispose } = createRoot((dispose) => ({
      paging: createAgendaPaging(() => viewport, new Date(2026, 10, 16)),
      dispose,
    }));
    paging.positionInitial();
    expect(viewport.scrollTop).toBe(1000);
    height = 900;
    viewport.scrollTop = 500;
    paging.onScroll();
    height = 6000;
    resize?.();
    expect(viewport.scrollTop).toBe(1000);
    expect(paging.indices()).toEqual([-2, -1, 0, 1, 2]);
    dispose();
  });
  it.each([0, 60])(
    'preserves a fling to %i through a prepend and late results',
    (latestScrollTop) => {
      let resize: (() => void) | undefined;
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            resize = callback;
          }
          observe() {}
          disconnect() {}
        }
      );
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
        frames.push(callback)
      );
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
      const viewport = document.createElement('div');
      viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
      Object.defineProperty(viewport, 'scrollHeight', { value: 7000 });
      Object.defineProperty(viewport, 'clientHeight', { value: 400 });
      const date = new Date(2026, 2, 7);
      let first = -2;
      let lateGrowth = 0;
      const render = () => {
        viewport.replaceChildren();
        for (let index = first; index < first + 5; index++) {
          const section = document.createElement('section');
          section.dataset.agendaWindow = String(index);
          for (let day = 0; day < 14; day++) {
            const row = document.createElement('section');
            row.dataset.agendaDay = agendaShift(
              date,
              index * 14 + day
            ).toDateString();
            const position = (index - first) * 1400 + day * 100;
            row.getBoundingClientRect = () => {
              const y = position + (index > first ? lateGrowth : 0);
              return {
                top: y - viewport.scrollTop,
                bottom: y + 100 - viewport.scrollTop,
              } as DOMRect;
            };
            section.append(row);
          }
          viewport.append(section);
        }
      };
      render();
      const { paging, dispose } = createRoot((dispose) => ({
        paging: createAgendaPaging(() => viewport, date),
        dispose,
      }));
      viewport.scrollTop = 100;
      paging.move(-1);
      first--;
      render();
      viewport.scrollTop = latestScrollTop;
      paging.onScroll();
      frames.shift()?.(0);
      expect(viewport.scrollTop).toBe(1400 + latestScrollTop);
      lateGrowth = 300;
      resize?.();
      expect(viewport.scrollTop).toBe(1700 + latestScrollTop);
      viewport.scrollTop = 20;
      paging.onScroll();
      expect(paging.indices()[0]).toBe(-4);
      dispose();
    }
  );

  it('anchors a prepended empty range to its visible heading instead of a hidden marker', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback)
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const date = new Date(2026, 2, 7);
    const oldDay = agendaShift(date, -28);
    const row = document.createElement('section');
    row.dataset.agendaDay = oldDay.toDateString();
    row.getBoundingClientRect = () =>
      ({
        top: -viewport.scrollTop,
        bottom: 96 - viewport.scrollTop,
      }) as DOMRect;
    viewport.append(row);
    const { paging, dispose } = createRoot((dispose) => ({
      paging: createAgendaPaging(() => viewport, date),
      dispose,
    }));
    paging.move(-1);
    const group = document.createElement('section');
    group.dataset.agendaDay = agendaShift(date, -42).toDateString();
    group.dataset.agendaGroupEnd = oldDay.toDateString();
    group.getBoundingClientRect = () =>
      ({
        top: -viewport.scrollTop,
        bottom: 96 - viewport.scrollTop,
      }) as DOMRect;
    row.getBoundingClientRect = () =>
      ({
        top: 96 - viewport.scrollTop,
        bottom: 96 - viewport.scrollTop,
      }) as DOMRect;
    viewport.replaceChildren(group, row);
    frames.shift()?.(0);
    expect(viewport.scrollTop).toBe(0);
    dispose();
  });
  it('keeps loading upward at a collapsed edge and stops at the supported boundary', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback)
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const date = new Date(2026, 2, 7);
    const row = document.createElement('section');
    row.dataset.agendaDay = date.toDateString();
    row.getBoundingClientRect = () => ({ top: 0, bottom: 96 }) as DOMRect;
    viewport.append(row);
    const { paging, dispose } = createRoot((dispose) => ({
      paging: createAgendaPaging(() => viewport, date, {
        canLoadWindow: (index) => index >= -4,
      }),
      dispose,
    }));
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    expect(paging.indices()[0]).toBe(-3);
    // A second fling event arrives before the prepend finishes, at scrollTop 0.
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    frames.shift()?.(0);
    expect(paging.indices()[0]).toBe(-4);
    frames.shift()?.(0);
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    expect(paging.indices()).toEqual([-4, -3, -2, -1, 0]);
    expect(frames).toHaveLength(0);
    dispose();
  });
  it('does not interpret a shorter rotated list clamping scrollTop as reader movement', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback)
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    let height = 900;
    Object.defineProperty(viewport, 'scrollHeight', { get: () => height });
    Object.defineProperty(viewport, 'clientHeight', { value: 500 });
    let rowTop = 400;
    const date = new Date(2026, 2, 7);
    const row = document.createElement('section');
    row.dataset.agendaDay = date.toDateString();
    row.getBoundingClientRect = () =>
      ({
        top: rowTop - viewport.scrollTop,
        bottom: rowTop + 500 - viewport.scrollTop,
      }) as DOMRect;
    viewport.append(row);
    const { paging, dispose } = createRoot((dispose) => ({
      paging: createAgendaPaging(() => viewport, date),
      dispose,
    }));
    viewport.scrollTop = 400;
    paging.move(1);
    height = 800;
    rowTop = 300;
    viewport.scrollTop = 300;
    paging.onScroll();
    frames.shift()?.(0);
    expect(viewport.scrollTop).toBe(300);
    expect(frames).toHaveLength(0);
    dispose();
  });
  it('restores a history window and visible day offset through late results', () => {
    let resize: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const date = new Date(2026, 2, 7);
    let y = 1200;
    const row = document.createElement('section');
    row.dataset.agendaDay = date.toDateString();
    row.getBoundingClientRect = () =>
      ({
        top: y - viewport.scrollTop,
        bottom: y + 200 - viewport.scrollTop,
      }) as DOMRect;
    viewport.append(row);
    const initialPosition = { first: -5, date: date.getTime(), top: -40 };
    const { paging, dispose } = createRoot((dispose) => ({
      paging: createAgendaPaging(() => viewport, date, { initialPosition }),
      dispose,
    }));
    paging.positionInitial();
    expect(viewport.scrollTop).toBe(1240);
    expect(paging.indices()).toEqual([-5, -4, -3, -2, -1]);
    expect(paging.capturePosition()).toEqual(initialPosition);
    y = 1500;
    resize?.();
    expect(viewport.scrollTop).toBe(1540);
    expect(paging.capturePosition()).toEqual(initialPosition);
    dispose();
  });
  it.each([-1, 1] as const)(
    'loads in direction %i from a touch gesture on a non-scrollable collapsed list',
    (direction) => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect() {}
        }
      );
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
        frames.push(callback)
      );
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
      const viewport = document.createElement('div');
      viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
      Object.defineProperty(viewport, 'clientHeight', { value: 600 });
      Object.defineProperty(viewport, 'scrollHeight', { value: 96 });
      const date = new Date(2026, 2, 7);
      const row = document.createElement('section');
      row.dataset.agendaDay = date.toDateString();
      row.getBoundingClientRect = () => ({ top: 0, bottom: 96 }) as DOMRect;
      viewport.append(row);
      const { paging, dispose } = createRoot((dispose) => ({
        paging: createAgendaPaging(() => viewport, date),
        dispose,
      }));
      const touch = (type: string, x: number, y: number) => {
        const event = new Event(type);
        Object.defineProperty(event, 'touches', {
          value: [{ identifier: 1, clientX: x, clientY: y }],
        });
        viewport.dispatchEvent(event);
      };
      touch('touchstart', 100, 100);
      expect(paging.indices()[0]).toBe(-2);
      touch('touchmove', 150, 105);
      expect(paging.indices()[0]).toBe(-2);
      // Native vertical panning cancels Pointer Events, but Touch Events continue.
      viewport.dispatchEvent(new Event('pointercancel'));
      touch('touchmove', 100, 100 - direction * 40);
      expect(paging.indices()[0]).toBe(-2 + direction);
      frames.shift()?.(0);
      touch('touchmove', 100, 100 - direction * 80);
      expect(paging.indices()[0]).toBe(-2 + direction * 2);
      viewport.dispatchEvent(new Event('touchcancel'));
      frames.shift()?.(0);
      touch('touchmove', 100, 100 - direction * 120);
      expect(paging.indices()[0]).toBe(-2 + direction * 2);
      dispose();
      touch('touchmove', 100, 100 - direction * 120);
      expect(paging.indices()[0]).toBe(-2 + direction * 2);
    }
  );

  it('loads toward the reader on a short list instead of reversing at both edges', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback)
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    Object.defineProperty(viewport, 'clientHeight', { value: 600 });
    Object.defineProperty(viewport, 'scrollHeight', { value: 700 });
    const date = new Date(2026, 2, 7);
    const day = document.createElement('section');
    day.dataset.agendaDay = date.toDateString();
    day.getBoundingClientRect = () =>
      ({
        top: 0 - viewport.scrollTop,
        bottom: 700 - viewport.scrollTop,
      }) as DOMRect;
    viewport.append(day);
    const { paging, dispose } = createRoot((dispose) => ({
      paging: createAgendaPaging(() => viewport, date),
      dispose,
    }));
    paging.positionInitial();
    viewport.dispatchEvent(new Event('pointerdown'));
    viewport.scrollTop = 100;
    paging.onScroll();
    expect(paging.indices()).toEqual([-1, 0, 1, 2, 3]);
    frames.shift()?.(0);
    expect(paging.indices()).toEqual([-1, 0, 1, 2, 3]);
    viewport.scrollTop = 0;
    paging.onScroll();
    expect(paging.indices()).toEqual([-2, -1, 0, 1, 2]);
    dispose();
  });

  it('does not load an older range on a stationary short-list scroll event', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    Object.defineProperty(viewport, 'clientHeight', { value: 600 });
    Object.defineProperty(viewport, 'scrollHeight', { value: 700 });
    const day = document.createElement('section');
    day.dataset.agendaDay = new Date(2026, 2, 7).toDateString();
    day.getBoundingClientRect = () => ({ top: 0, bottom: 700 }) as DOMRect;
    viewport.append(day);
    const { paging, dispose } = createRoot((dispose) => ({
      paging: createAgendaPaging(() => viewport, new Date(2026, 2, 7)),
      dispose,
    }));
    paging.positionInitial();
    viewport.dispatchEvent(new Event('pointerdown'));
    paging.onScroll();
    expect(paging.indices()).toEqual([-2, -1, 0, 1, 2]);
    dispose();
  });

  it('queues newer input during a short-list rotation without reversing or skipping windows', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback)
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    Object.defineProperty(viewport, 'clientHeight', { value: 600 });
    Object.defineProperty(viewport, 'scrollHeight', { value: 700 });
    const day = document.createElement('section');
    day.dataset.agendaDay = new Date(2026, 2, 7).toDateString();
    day.getBoundingClientRect = () =>
      ({
        top: -viewport.scrollTop,
        bottom: 700 - viewport.scrollTop,
      }) as DOMRect;
    viewport.append(day);
    const { paging, dispose } = createRoot((dispose) => ({
      paging: createAgendaPaging(() => viewport, new Date(2026, 2, 7)),
      dispose,
    }));
    paging.move(1);
    viewport.scrollTop = 100;
    paging.onScroll();
    frames.shift()?.(0);
    expect(paging.indices()).toEqual([0, 1, 2, 3, 4]);
    dispose();
  });

  it('can wheel toward newer windows from a collapsed list at the lower supported bound', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    Object.defineProperty(viewport, 'clientHeight', { value: 600 });
    Object.defineProperty(viewport, 'scrollHeight', { value: 96 });
    const date = new Date(2026, 2, 7);
    const row = document.createElement('section');
    row.dataset.agendaDay = date.toDateString();
    row.getBoundingClientRect = () => ({ top: 0, bottom: 96 }) as DOMRect;
    viewport.append(row);
    const { paging, dispose } = createRoot((dispose) => ({
      paging: createAgendaPaging(() => viewport, date, {
        canLoadWindow: (index) => index >= -2,
      }),
      dispose,
    }));
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    expect(paging.indices()[0]).toBe(-2);
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    expect(paging.indices()[0]).toBe(-1);
    dispose();
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
