import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createComponent, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { Gantt, useGantt } from './gantt';
import { toGanttDay } from './gantt-date';
import {
  MAX_GANTT_PIXELS_PER_DAY,
  MIN_GANTT_PIXELS_PER_DAY,
} from './gantt-interaction';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type Item = { id: string; name: string };

it('updates immutable rows with reused keys and keeps their new order when not virtualized', () => {
  const [items, setItems] = createSignal<Item[]>([
    { id: 'a', name: 'Old A' },
    { id: 'b', name: 'Old B' },
  ]);
  const view = render(() =>
    createComponent(Gantt.Root, {
      range: { start: 0, end: 30 },
      get children() {
        return createComponent(Gantt.Rows<Item>, {
          get items() {
            return items();
          },
          getKey: (item) => item.id,
          children: (item) =>
            createComponent(Gantt.Row, {
              get children() {
                return createComponent(Gantt.Label, {
                  get children() {
                    return item.name;
                  },
                });
              },
            }),
        });
      },
    })
  );

  expect(view.container.textContent).toBe('Old AOld B');
  setItems([
    { id: 'b', name: 'New B' },
    { id: 'a', name: 'New A' },
  ]);
  expect(view.container.textContent).toBe('New BNew A');
  setItems([{ id: 'a', name: 'Latest A' }]);
  expect(view.container.textContent).toBe('Latest A');
});

it('fills resized viewports without losing the calendar anchor on zoom and range expansion', async () => {
  const [range, setRange] = createSignal({ start: 0, end: 100 });
  const viewport = document.createElement('div');
  let viewportWidth = 1200;
  Object.defineProperty(viewport, 'clientWidth', { get: () => viewportWidth });
  let gantt!: ReturnType<typeof useGantt>;
  const view = render(() =>
    createComponent(Gantt.Root, {
      get range() {
        return range();
      },
      get children() {
        return createComponent(() => {
          gantt = useGantt();
          gantt.setViewport(viewport);
          gantt.updateViewport();
          return createComponent(Gantt.Row, {
            class: 'gantt-probe',
            children: 'Viewport probe',
          });
        }, {});
      },
    })
  );

  expect(
    view.container.querySelector<HTMLDivElement>('.gantt-probe')?.style.width
  ).toBe('2260px');
  viewport.scrollLeft = 300;
  gantt.updateViewport();
  const anchor = gantt.visibleRange().start;
  expect(gantt.range().end).toBe(100);

  gantt.setScale('month');
  await Promise.resolve();
  expect(gantt.visibleRange().start).toBe(anchor);
  expect(gantt.width() - viewportWidth).toBeGreaterThanOrEqual(
    viewport.scrollLeft
  );

  viewportWidth = 1800;
  gantt.updateViewport();
  expect(gantt.width() - viewportWidth).toBeGreaterThanOrEqual(
    viewport.scrollLeft
  );

  setRange({ start: -20, end: 100 });
  await Promise.resolve();
  expect(gantt.visibleRange().start).toBe(anchor);
  expect(gantt.width() - viewportWidth).toBeGreaterThanOrEqual(
    viewport.scrollLeft
  );

  setRange({ start: -20, end: 365 });
  await Promise.resolve();
  expect(gantt.range().end).toBe(365);
  expect(gantt.visibleRange().start).toBe(anchor);
});

it('rebases growing calendar edges without moving the visible dates or recursively extending', async () => {
  const viewport = document.createElement('div');
  let gantt!: ReturnType<typeof useGantt>;
  Object.defineProperty(viewport, 'clientWidth', { value: 1200 });
  Object.defineProperty(viewport, 'scrollWidth', { get: () => gantt.width() });
  render(() =>
    createComponent(Gantt.Root, {
      range: { start: 0, end: 100 },
      get children() {
        return createComponent(() => {
          gantt = useGantt();
          gantt.setViewport(viewport);
          gantt.updateViewport();
          return viewport;
        }, {});
      },
    })
  );
  await Promise.resolve();
  expect(gantt.visibleRange().start).toBe(0);
  const initial = gantt.range();
  expect(initial.start).toBeLessThan(0);
  gantt.updateViewport();
  await Promise.resolve();
  expect(gantt.range()).toEqual(initial);

  viewport.scrollLeft = 10;
  const dayBefore =
    gantt.range().start + viewport.scrollLeft / gantt.pixelsPerDay();
  gantt.updateViewport();
  await Promise.resolve();
  expect(gantt.range().start).toBeLessThan(initial.start);
  expect(gantt.visibleRange().start).toBe(dayBefore);
});

it('keeps month headings anchored to their calendar cells while horizontally scrolling', () => {
  const start = toGanttDay('2026-03-01')!;
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', { value: 1000 });
  let gantt!: ReturnType<typeof useGantt>;
  const view = render(() =>
    createComponent(Gantt.Root, {
      range: { start, end: toGanttDay('2026-06-01')! },
      get children() {
        return createComponent(() => {
          gantt = useGantt();
          gantt.setViewport(viewport);
          gantt.updateViewport();
          return createComponent(Gantt.Header, {});
        }, {});
      },
    })
  );
  viewport.scrollLeft =
    (toGanttDay('2026-03-31')! - start) * gantt.pixelsPerDay();
  gantt.updateViewport();
  const march = view.getByText("Mar '26");
  expect(march.style.left).toBe('');
  expect(march.parentElement?.style.left).toBe('0px');
  expect(march.parentElement?.classList.contains('overflow-hidden')).toBe(true);
  viewport.scrollLeft =
    (toGanttDay('2026-04-01')! - start) * gantt.pixelsPerDay();
  gantt.updateViewport();
  expect(view.getByText("Apr '26").parentElement?.style.left).toBe('620px');
  expect(view.queryByText("Mar '26")).toBeNull();
});

it('opens timeline settings and updates the calendar grid without changing zoom', async () => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  let gantt!: ReturnType<typeof useGantt>;
  render(() =>
    createComponent(Gantt.Root, {
      range: { start: 0, end: 100 },
      get children() {
        return createComponent(() => {
          gantt = useGantt();
          return createComponent(Gantt.Settings, {});
        }, {});
      },
    })
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'Timeline settings' }), {
    key: 'ArrowDown',
  });
  await screen.findByRole('menu');
  fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'Monthly' }), {
    key: 'Enter',
  });
  await waitFor(() => expect(gantt.gridScale()).toBe('month'));
  expect(gantt.scale()).toBe('week');
  fireEvent.keyDown(
    screen.getByRole('menuitemcheckbox', { name: 'Show grid lines' }),
    { key: 'Enter' }
  );
  expect(gantt.gridVisible()).toBe(false);
  fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'Dashed' }), {
    key: 'Enter',
  });

  expect(gantt.gridStyle()).toBe('dashed');
  fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'Month' }), {
    key: 'Enter',
  });
  expect(gantt.scale()).toBe('month');
  expect(gantt.gridScale()).toBe('month');
});
function chartFixture(initialWidth = 1000) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T12:00:00'));
  const today = toGanttDay(new Date())!;
  const [range, setRange] = createSignal({
    start: today - 60,
    end: today + 60,
  });
  let width = initialWidth;
  let gantt!: ReturnType<typeof useGantt>;
  const measurements: (() => void)[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(measure: () => void) {
        measurements.push(measure);
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    () => width
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() =>
    gantt.width()
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, width, 600)
  );
  const view = render(() =>
    createComponent(Gantt.Root, {
      get range() {
        return range();
      },
      get children() {
        return createComponent(() => {
          gantt = useGantt();
          return createComponent(Gantt.Chart, {
            get children() {
              return [
                createComponent(Gantt.Header, {}),
                createComponent(Gantt.TodayMarker, {}),
              ];
            },
          });
        }, {});
      },
    })
  );
  return {
    ...view,
    gantt,
    today,
    viewport: view.getByLabelText('Gantt timeline'),
    setRange,
    resize(next: number) {
      width = next;
      measurements.forEach((measure) => measure());
    },
  };
}

it('bounds Ctrl-wheel zoom while retaining the pointer date through rapid wheel events', async () => {
  const { gantt, viewport } = chartFixture();
  await waitFor(() => expect(gantt.viewport()).toBe(viewport));
  await Promise.resolve();
  await Promise.resolve();
  const clientX = 760;
  const day = () => gantt.pointToDay(clientX, undefined, false)!.day;
  const anchor = day();
  const wheel = (deltaY: number, ctrlKey = true, deltaMode = 0) => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX,
      ctrlKey,
      deltaY,
      deltaMode,
    });
    fireEvent(viewport, event);
    return event;
  };
  expect(wheel(-100, false).defaultPrevented).toBe(false);
  expect(gantt.pixelsPerDay()).toBe(20);
  expect(wheel(-100).defaultPrevented).toBe(true);
  wheel(-100);
  await Promise.resolve();
  expect(day()).toBeCloseTo(anchor);
  for (let i = 0; i < 12; i++) wheel(-100);
  await Promise.resolve();
  expect(gantt.pixelsPerDay()).toBe(MAX_GANTT_PIXELS_PER_DAY);
  expect(day()).toBeCloseTo(anchor);
  for (let i = 0; i < 12; i++) wheel(100);
  await Promise.resolve();
  await Promise.resolve();
  expect(gantt.pixelsPerDay()).toBe(MIN_GANTT_PIXELS_PER_DAY);
  expect(day()).toBeCloseTo(anchor);
  expect(gantt.scale()).toBe('month');
  wheel(-1, true, 1);
  await Promise.resolve();
  expect(gantt.pixelsPerDay()).toBeGreaterThan(MIN_GANTT_PIXELS_PER_DAY);
  expect(day()).toBeCloseTo(anchor);
});

it('centers today once after delayed measurement and keeps both today lines out of sticky labels', async () => {
  const { gantt, viewport, today, resize, setRange, container } =
    chartFixture(0);
  await Promise.resolve();
  expect(viewport.scrollLeft).toBe(0);
  resize(1200);
  await waitFor(() =>
    expect(
      (gantt.visibleRange().start + gantt.visibleRange().end) / 2
    ).toBeCloseTo(today + 0.5)
  );
  const header = container.querySelector<HTMLElement>(
    '[data-gantt-today="header"]'
  )!;
  const body = container.querySelector<HTMLElement>(
    '[data-gantt-today="body"]'
  )!;
  expect(
    header.closest('[data-gantt-header]')!.firstElementChild!.contains(header)
  ).toBe(false);
  expect(header.classList.contains('inset-y-0')).toBe(true);
  expect(body.classList.contains('z-0')).toBe(true);
  expect(
    Number.parseFloat(body.style.left) - Number.parseFloat(header.style.left)
  ).toBe(gantt.labelWidth());
  fireEvent(
    viewport,
    new MouseEvent('pointermove', { bubbles: true, clientX: 760, clientY: 300 })
  );
  const cursorLabel = container.querySelector<HTMLElement>(
    '[data-gantt-cursor-label]'
  )!;
  expect(cursorLabel.closest('[data-gantt-header]')).not.toBeNull();
  const cursorX = cursorLabel.style.left;
  viewport.scrollTop = 400;
  fireEvent.scroll(viewport);
  await Promise.resolve();
  expect(cursorLabel.style.left).toBe(cursorX);
  expect(cursorLabel.classList.contains('bottom-1')).toBe(true);
  viewport.scrollLeft += 200;
  fireEvent.scroll(viewport);
  const anchor = gantt.visibleRange().start;
  resize(1500);
  setRange({ start: today - 200, end: today + 100 });
  await Promise.resolve();
  expect(gantt.visibleRange().start).toBeCloseTo(anchor);
  viewport.scrollLeft =
    (today + 1 - gantt.range().start) * gantt.pixelsPerDay();
  fireEvent.scroll(viewport);
  expect(container.querySelector('[data-gantt-today]')).toBeNull();
  gantt.scrollToToday();
  await waitFor(() =>
    expect(
      (gantt.visibleRange().start + gantt.visibleRange().end) / 2
    ).toBeCloseTo(today + 0.5)
  );
  expect(container.querySelectorAll('[data-gantt-today]')).toHaveLength(2);
});

function creationFixture(minDate?: string) {
  const onCreate = vi.fn();
  const [canCreate, setCanCreate] = createSignal(true);
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', { value: 1000 });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
  let gantt!: ReturnType<typeof useGantt>;
  render(() =>
    createComponent(Gantt.Root, {
      range: { start: 0, end: 100 },
      get children() {
        return createComponent(() => {
          gantt = useGantt();
          gantt.setViewport(viewport);
          gantt.updateViewport();
          return [
            viewport,
            createComponent(Gantt.CreateArea, {
              get onCreate() {
                return canCreate() ? onCreate : undefined;
              },
              minDate,
            }),
          ];
        }, {});
      },
    })
  );
  const pointer = (
    target: Element | Window,
    type: string,
    x: number,
    y = 200
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(target, event);
  };
  return { viewport, gantt, pointer, onCreate, setCanCreate };
}

it('opens a composer only after a completed range drag, including reverse selections', () => {
  const { viewport, pointer, onCreate } = creationFixture();
  pointer(viewport, 'pointerdown', 660);
  pointer(window, 'pointermove', 580);
  expect(onCreate).not.toHaveBeenCalled();
  pointer(window, 'pointerup', 580);
  expect(onCreate).toHaveBeenCalledOnce();
  const dates = onCreate.mock.calls[0][0];
  expect(toGanttDay(dates.start)).toBe(16);
  expect(toGanttDay(dates.end)).toBe(20);
});

it('keeps creation within the host minimum date instead of creating reversed intervals', () => {
  const { viewport, gantt, pointer, onCreate } = creationFixture('1970-01-21');
  const scrim = document.querySelector<HTMLElement>(
    '[data-gantt-create-scrim]'
  )!;
  expect(scrim.style.left).toBe('260px');
  expect(scrim.style.width).toBe('400px');
  pointer(viewport, 'pointerdown', 500);
  pointer(window, 'pointermove', 700);
  pointer(window, 'pointerup', 700);
  expect(onCreate).not.toHaveBeenCalled();
  pointer(viewport, 'pointerdown', 700);
  pointer(window, 'pointermove', 500);
  pointer(window, 'pointerup', 500);
  expect(toGanttDay(onCreate.mock.calls[0][0].start)).toBe(20);
  expect(toGanttDay(onCreate.mock.calls[0][0].end)).toBe(22);
  viewport.scrollLeft = 200;
  gantt.updateViewport();
  expect(scrim.style.left).toBe('260px');
  expect(scrim.style.width).toBe('400px');
  viewport.scrollLeft = 600;
  gantt.updateViewport();
  expect(
    scrim.closest<HTMLElement>('[data-gantt-calendar-clip]')!.style.left
  ).toBe('260px');
});

it('cancels range creation and ignores clicks, labels, bars, and header space', () => {
  const { viewport, gantt, pointer, onCreate, setCanCreate } =
    creationFixture();
  pointer(viewport, 'pointerdown', 500);
  pointer(window, 'pointermove', 580);
  fireEvent.keyDown(window, { key: 'Escape' });
  pointer(window, 'pointerup', 580);
  expect(gantt.editing()).toBe(false);
  pointer(viewport, 'pointerdown', 500);
  pointer(window, 'pointerup', 500);
  pointer(viewport, 'pointerdown', 200);
  pointer(window, 'pointerup', 500);
  pointer(viewport, 'pointerdown', 500, 30);
  pointer(window, 'pointerup', 580, 30);
  for (const attribute of [
    'data-gantt-label',
    'data-gantt-bar',
    'data-gantt-header',
  ]) {
    const item = document.createElement('div');
    item.setAttribute(attribute, '');
    viewport.append(item);
    pointer(item, 'pointerdown', 500);
    pointer(window, 'pointermove', 580);
    pointer(window, 'pointerup', 580);
  }
  pointer(viewport, 'pointerdown', 500);
  pointer(window, 'pointermove', 580);
  setCanCreate(false);
  const scrim = document.querySelector<HTMLElement>(
    '[data-gantt-create-scrim]'
  )!;
  expect(scrim.style.width).toBe('2000px');
  pointer(window, 'pointerup', 580);
  pointer(viewport, 'pointerdown', 500);
  expect(gantt.editing()).toBe(false);
  pointer(window, 'pointerup', 580);
  setCanCreate(true);
  expect(document.querySelector('[data-gantt-create-scrim]')).toBeNull();
  expect(onCreate).not.toHaveBeenCalled();
});

it('hides the today marker before horizontal scrolling carries it behind sticky labels', () => {
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', { value: 1000 });
  let gantt!: ReturnType<typeof useGantt>;
  const view = render(() =>
    createComponent(Gantt.Root, {
      range: { start: 0, end: 100 },
      get children() {
        return createComponent(() => {
          gantt = useGantt();
          gantt.setViewport(viewport);
          gantt.updateViewport();
          return createComponent(Gantt.TodayMarker, { date: '1970-01-21' });
        }, {});
      },
    })
  );
  expect(view.container.querySelector('[data-gantt-today]')).not.toBeNull();
  viewport.scrollLeft = 21 * gantt.pixelsPerDay();
  gantt.updateViewport();
  expect(view.container.querySelector('[data-gantt-today]')).toBeNull();
  viewport.scrollLeft = 20 * gantt.pixelsPerDay();
  gantt.updateViewport();
  expect(view.container.querySelector('[data-gantt-today]')).not.toBeNull();
});
