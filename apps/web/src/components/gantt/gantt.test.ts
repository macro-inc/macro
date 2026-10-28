import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createComponent, createSignal } from 'solid-js';
import { insert } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { Gantt } from './gantt';
import { useGantt } from './gantt-context';
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

type Item = { id: string; name: string; group?: string };

it('refreshes immutable rows and panel boundaries when reused keys change order or group', () => {
  const [items, setItems] = createSignal<Item[]>([
    { id: 'a', name: 'Old A', group: 'first' },
    { id: 'b', name: 'Old B', group: 'first' },
  ]);
  const view = render(() =>
    createComponent(Gantt.Root, {
      labelWidth: 0,
      range: { start: 0, end: 30 },
      get children() {
        return createComponent(Gantt.Rows<Item>, {
          get items() {
            return items();
          },
          getKey: (item) => item.id,
          getPanelKey: (item) => item.group,
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
  const panelEdges = (edge: 'start' | 'end') =>
    [...view.container.querySelectorAll(`[data-gantt-panel-${edge}]`)].map(
      (label) => label.textContent
    );
  expect(panelEdges('start')).toEqual(['Old A']);
  expect(panelEdges('end')).toEqual(['Old B']);
  setItems([
    { id: 'b', name: 'New B', group: 'second' },
    { id: 'a', name: 'New A', group: 'first' },
  ]);
  expect(view.container.textContent).toBe('New BNew A');
  expect(panelEdges('start')).toEqual(['New B', 'New A']);
  expect(panelEdges('end')).toEqual(['New B', 'New A']);
  setItems([{ id: 'a', name: 'Latest A', group: 'first' }]);
  expect(view.container.textContent).toBe('Latest A');
  expect(panelEdges('start')).toEqual(['Latest A']);
  expect(panelEdges('end')).toEqual(['Latest A']);
});

it.each([1, 100])(
  'preserves the date at native scroll edges (range end %i)',
  async (end) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const viewport = document.createElement('div');
    let left = 0;
    const writeScroll = vi.fn((value: number) => {
      left = Math.max(
        0,
        Math.min(value, viewport.scrollWidth - viewport.clientWidth)
      );
    });
    Object.defineProperty(viewport, 'scrollLeft', {
      get: () => left,
      set: writeScroll,
    });
    Object.defineProperty(viewport, 'clientWidth', { value: 1200 });
    Object.defineProperty(viewport, 'scrollWidth', {
      get: () =>
        Number.parseFloat(
          (viewport.firstElementChild as HTMLElement).style.width
        ),
    });
    let gantt!: ReturnType<typeof useGantt>;
    render(() =>
      createComponent(Gantt.Root, {
        range: { start: 0, end },
        get children() {
          return createComponent(() => {
            gantt = useGantt();
            insert(
              viewport,
              createComponent(Gantt.Row, { children: 'Extent probe' })
            );
            return viewport;
          }, {});
        },
      })
    );
    gantt.setViewport(viewport);
    gantt.updateViewport();
    viewport.scrollTop = 77;
    for (const offset of [120.5, 0]) {
      const before = gantt.range();
      left = offset;
      const anchor = before.start + left / gantt.pixelsPerDay();
      writeScroll.mockClear();
      gantt.updateViewport();
      expect(gantt.range().start).toBeLessThan(before.start);
      expect(gantt.visibleRange().start).toBeCloseTo(anchor);
      expect(writeScroll).toHaveBeenCalledOnce();
      expect(viewport.scrollTop).toBe(77);
      gantt.updateViewport();
      left -= 20.5;
      gantt.updateViewport();
      const moved = gantt.visibleRange().start;
      await Promise.resolve();
      vi.advanceTimersByTime(40);
      expect(gantt.visibleRange().start).toBeCloseTo(moved);
      expect(writeScroll).toHaveBeenCalledOnce();
    }
    const rebased = gantt.range();
    writeScroll.mockClear();
    left = viewport.scrollWidth - viewport.clientWidth - 10;
    gantt.updateViewport();
    expect(gantt.range().end).toBeGreaterThan(rebased.end);
    expect(gantt.range().start).toBe(rebased.start);
    expect(writeScroll).not.toHaveBeenCalled();
  }
);

it('pins the correct year and aligns date marks across month boundaries', async () => {
  const start = toGanttDay('2026-12-01')!;
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', { value: 1000 });
  let gantt!: ReturnType<typeof useGantt>;
  const view = render(() =>
    createComponent(Gantt.Root, {
      range: { start, end: toGanttDay('2027-04-01')! },
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
  const scrollTo = (date: string) => {
    viewport.scrollLeft = (toGanttDay(date)! - start) * gantt.pixelsPerDay();
    gantt.updateViewport();
  };
  for (const [date, month, year] of [
    ['2026-12-31', 'December', '2026'],
    ['2027-01-01', 'January', '2027'],
    ['2027-02-01', 'February', '2027'],
  ]) {
    scrollTo(date);
    expect(
      view.getByText(month).parentElement?.querySelector('[data-gantt-year]')
        ?.textContent
    ).toBe(year);
  }
  expect(
    view.getByText('March').parentElement?.querySelector('[data-gantt-year]')
  ).toBeNull();
  gantt.setScale('month');
  await Promise.resolve();
  expect(
    view.getByText('Feb').parentElement?.querySelector('[data-gantt-year]')
      ?.textContent
  ).toBe('2027');
  gantt.setScale('day');
  await Promise.resolve();
  for (const lastDay of ['2026-12-31', '2027-01-31', '2027-02-28']) {
    scrollTo(lastDay);
    const position = (toGanttDay(lastDay)! - start) * gantt.pixelsPerDay();
    const ticks = [
      ...view.container.querySelectorAll<HTMLElement>('[data-gantt-date-tick]'),
    ].slice(0, 3);
    expect(ticks.map((tick) => Number.parseFloat(tick.style.left))).toEqual([
      position,
      position + gantt.pixelsPerDay(),
      position + 2 * gantt.pixelsPerDay(),
    ]);
    expect(
      ticks.map(
        (tick) => tick.querySelectorAll('[data-gantt-date-mark]').length
      )
    ).toEqual([1, 1, 1]);
  }
});

it('opens timeline settings without crashing and changes the calendar grid independently of zoom', async () => {
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
  expect(await screen.findByRole('menu')).not.toBeNull();
  fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'Monthly' }), {
    key: 'Enter',
  });
  await waitFor(() => expect(gantt.gridScale()).toBe('month'));
  expect(gantt.scale()).toBe('week');
});
function chartFixture(initialWidth = 1000, drawer = false) {
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
  const item = document.createElement('button');
  item.type = 'button';
  item.textContent = 'Item list entry';
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
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      const content = this.firstElementChild;
      return content instanceof HTMLElement
        ? Number.parseFloat(content.style.width) || 0
        : 0;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, width, 600)
  );
  const view = render(() =>
    createComponent(Gantt.Root, {
      labelWidth: drawer ? 0 : undefined,
      get range() {
        return range();
      },
      get children() {
        return createComponent(() => {
          gantt = useGantt();
          return [
            createComponent(Gantt.Chart, {
              get children() {
                return [
                  createComponent(Gantt.Header, {}),
                  ...(drawer
                    ? [
                        createComponent(Gantt.Row, {
                          get children() {
                            return [
                              createComponent(Gantt.Label, { children: item }),
                              createComponent(Gantt.Bar, {
                                start: '2026-09-01',
                                end: '2026-10-04',
                                title: 'Timeline item',
                                children: 'Timeline item',
                              }),
                            ];
                          },
                        }),
                      ]
                    : []),
                  createComponent(Gantt.TodayMarker, {}),
                ];
              },
            }),
            ...(drawer ? [createComponent(Gantt.SidebarToggle, {})] : []),
            createComponent(Gantt.ZoomControls, {}),
          ];
        }, {});
      },
    })
  );
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    view.getByLabelText('Gantt timeline').scrollLeft = options.left ?? 0;
  });
  Object.defineProperty(view.getByLabelText('Gantt timeline'), 'scrollTo', {
    value: scrollTo,
  });
  return {
    ...view,
    gantt,
    today,
    viewport: view.getByLabelText('Gantt timeline'),
    setRange,
    scrollTo,
    resize(next: number) {
      width = next;
      measurements.forEach((measure) => measure());
    },
  };
}

it('starts middle-button panning from sidebar items and bars without activating them', async () => {
  const { gantt, viewport, container } = chartFixture(1000, true);
  await waitFor(() => expect(gantt.viewport()).toBe(viewport));
  await Promise.resolve();
  const initialLeft = viewport.scrollLeft;
  viewport.scrollTop = 200;
  const targets = [
    screen.getByText('Item list entry'),
    container.querySelector<HTMLElement>('[data-gantt-bar-body]')!,
  ];
  const activate = vi.fn();
  for (const target of targets) {
    target.addEventListener('mousedown', activate);
    const down = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 1,
      buttons: 4,
      clientX: 500,
      clientY: 300,
    });
    fireEvent(target, down);
    expect(down.defaultPrevented).toBe(true);
    expect(gantt.editing()).toBe(true);
    fireEvent.mouseMove(window, { buttons: 4, clientX: 450, clientY: 260 });
    fireEvent.mouseUp(window, { button: 0, buttons: 4 });
    expect(gantt.editing()).toBe(true);
    fireEvent.mouseUp(window, { button: 1 });
    expect(gantt.editing()).toBe(false);
  }
  expect(activate).not.toHaveBeenCalled();
  gantt.setEditing(true);
  fireEvent.mouseDown(viewport, { button: 1, buttons: 4 });
  expect(gantt.editing()).toBe(true);
  const stoppedLeft = viewport.scrollLeft;
  fireEvent.mouseMove(window, { buttons: 4, clientX: 100, clientY: 0 });
  expect(viewport.scrollLeft).toBe(stoppedLeft);
  gantt.setEditing(false);
  expect(viewport.scrollLeft).toBe(initialLeft + 100);
  expect(viewport.scrollTop).toBe(280);
  expect(gantt.sidebar.open()).toBe(true);
});

it.each(['escape', 'blur', 'release', 'unmount'])(
  'cleans up middle-mouse panning on %s',
  async (reason) => {
    const { gantt, viewport, unmount } = chartFixture(1000, true);
    await waitFor(() => expect(gantt.viewport()).toBe(viewport));
    await Promise.resolve();
    const events: EventTarget = window;
    const listeners = vi.spyOn(events, 'addEventListener');
    const removed = vi.spyOn(events, 'removeEventListener');
    fireEvent.mouseDown(viewport, {
      button: 1,
      buttons: 4,
      clientX: 500,
      clientY: 300,
    });
    expect(gantt.editing()).toBe(true);
    const move = listeners.mock.calls.find(
      ([type]) => type === 'mousemove'
    )?.[1];
    const release = listeners.mock.calls.find(
      ([type]) => type === 'mouseup'
    )?.[1];
    if (typeof move !== 'function' || typeof release !== 'function')
      throw new Error('Pan listeners were not registered');

    if (reason === 'escape') fireEvent.keyDown(viewport, { key: 'Escape' });
    if (reason === 'blur') fireEvent.blur(window);
    if (reason === 'release')
      fireEvent.mouseMove(window, { buttons: 0, clientX: 400, clientY: 200 });
    if (reason === 'unmount') unmount();
    expect(gantt.editing()).toBe(false);
    expect(removed).toHaveBeenCalledWith('mousemove', move, true);
    expect(removed).toHaveBeenCalledWith('mouseup', release, true);

    const left = viewport.scrollLeft;
    // A queued callback from the ended gesture must not disturb another editing owner.
    gantt.setEditing(true);
    move.call(
      window,
      new MouseEvent('mousemove', { buttons: 4, clientX: 400, clientY: 200 })
    );
    release.call(window, new MouseEvent('mouseup', { button: 1 }));
    expect(viewport.scrollLeft).toBe(left);
    expect(gantt.editing()).toBe(true);
    gantt.setEditing(false);
  }
);

it.each([-5_000, -300, 300, 5_000])(
  'preserves the full %ipx middle-drag distance across native scroll boundaries',
  async (delta) => {
    const { gantt, viewport } = chartFixture();
    await waitFor(() => expect(gantt.viewport()).toBe(viewport));
    await Promise.resolve();
    let left =
      delta < 0 ? 170 : viewport.scrollWidth - viewport.clientWidth - 170;
    Object.defineProperty(viewport, 'scrollLeft', {
      get: () => left,
      set: (value: number) => {
        left = Math.max(
          0,
          Math.min(value, viewport.scrollWidth - viewport.clientWidth)
        );
      },
      configurable: true,
    });
    fireEvent.scroll(viewport);
    const anchor = gantt.visibleRange().start;
    const pixels = gantt.pixelsPerDay();
    fireEvent.mouseDown(viewport, {
      button: 1,
      buttons: 4,
      clientX: 500,
      clientY: 300,
    });
    fireEvent.mouseMove(window, {
      buttons: 4,
      clientX: 500 - delta,
      clientY: 300,
    });
    expect(gantt.visibleRange().start).toBeCloseTo(anchor + delta / pixels);
    fireEvent.mouseMove(window, {
      buttons: 4,
      clientX: 500 - delta * 1.5,
      clientY: 300,
    });
    expect(gantt.visibleRange().start).toBeCloseTo(
      anchor + (delta * 1.5) / pixels
    );
    fireEvent.mouseUp(window, { button: 1 });
  }
);

it('defaults the drawer open and preserves explicit choices across responsive resizing', async () => {
  const view = chartFixture(1000, true);
  const { gantt, viewport, resize } = view;
  await waitFor(() => expect(gantt.viewport()).toBe(viewport));
  await Promise.resolve();
  await Promise.resolve();
  const anchor = gantt.visibleRange().start;
  expect(gantt.sidebar.open()).toBe(true);
  const toggle = view.getByRole('button', { name: 'Hide timeline items' });
  view.getByRole('button', { name: 'Item list entry' }).focus();
  resize(320);
  expect(gantt.sidebar.open()).toBe(false);
  expect(document.activeElement).toBe(toggle);
  resize(1000);
  expect(gantt.sidebar.open()).toBe(true);
  fireEvent.click(toggle);
  resize(320);
  resize(1000);
  expect(gantt.sidebar.open()).toBe(false);
  fireEvent.click(toggle);
  resize(320);
  expect(gantt.sidebar.open()).toBe(true);
  expect(gantt.visibleRange().start).toBeCloseTo(anchor);
});
it('preserves dates and restores focus when the item drawer opens and closes', async () => {
  const view = chartFixture(1000, true);
  const { gantt, viewport } = view;
  await waitFor(() => expect(gantt.viewport()).toBe(viewport));
  await Promise.resolve();
  gantt.sidebar.setOpen(false);
  const anchor = gantt.visibleRange().start;
  const left = viewport.scrollLeft;
  const toggle = view.getByRole('button', { name: 'Show timeline items' });
  expect(view.queryByRole('button', { name: 'Item list entry' })).toBeNull();
  fireEvent.click(toggle);
  const item = view.getByRole('button', { name: 'Item list entry' });
  expect(gantt.visibleRange().start).toBe(anchor);
  expect(viewport.scrollLeft).toBe(left);
  expect(gantt.pointToDay(20)).toBeUndefined();
  const wheel = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: 20,
    metaKey: true,
    deltaY: -100,
  });
  fireEvent(item, wheel);
  expect(wheel.defaultPrevented).toBe(true);
  expect(gantt.pixelsPerDay()).toBe(20);
  item.focus();
  const consume = (event: KeyboardEvent) => event.preventDefault();
  item.addEventListener('keydown', consume);
  fireEvent.keyDown(item, { key: 'Escape' });
  expect(gantt.sidebar.open()).toBe(true);
  item.removeEventListener('keydown', consume);
  fireEvent.keyDown(item, { key: 'Escape' });
  expect(gantt.sidebar.open()).toBe(false);
  expect(document.activeElement).toBe(toggle);
  expect(gantt.visibleRange().start).toBe(anchor);
});

it('keeps the drawer open on chart clicks', async () => {
  const view = chartFixture(1000, true);
  await waitFor(() => expect(view.gantt.viewport()).toBe(view.viewport));
  await Promise.resolve();
  const bar = view.getByRole('button', { name: /^Timeline item:/ });
  fireEvent(bar, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  expect(view.gantt.sidebar.open()).toBe(true);
});

it('bounds Ctrl/Cmd-wheel zoom while retaining the pointer date through rapid wheel events', async () => {
  const { gantt, viewport } = chartFixture();
  await waitFor(() => expect(gantt.viewport()).toBe(viewport));
  await Promise.resolve();
  await Promise.resolve();
  const clientX = 760;
  const day = () => gantt.pointToDay(clientX, undefined, false)!.day;
  const anchor = day();
  const wheel = (
    deltaY: number,
    ctrlKey = true,
    deltaMode = 0,
    metaKey = false
  ) => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX,
      ctrlKey,
      metaKey,
      deltaY,
      deltaMode,
    });
    fireEvent(viewport, event);
    return event;
  };
  expect(wheel(-100, false).defaultPrevented).toBe(false);
  expect(gantt.pixelsPerDay()).toBe(20);
  expect(wheel(-100).defaultPrevented).toBe(true);
  for (let i = 0; i < 12; i++) wheel(-100);
  await Promise.resolve();
  expect(gantt.pixelsPerDay()).toBe(MAX_GANTT_PIXELS_PER_DAY);
  expect(day()).toBeCloseTo(anchor);
  for (let i = 0; i < 12; i++) wheel(100);
  await Promise.resolve();
  await Promise.resolve();
  expect(gantt.pixelsPerDay()).toBe(MIN_GANTT_PIXELS_PER_DAY);
  expect(day()).toBeCloseTo(anchor);
  expect(wheel(-100, false, 0, true).defaultPrevented).toBe(true);
  await Promise.resolve();
  expect(day()).toBeCloseTo(anchor);
});

it('preserves the date anchor through zoom, resizing, and loading earlier dates', async () => {
  const { gantt, viewport, resize, setRange } = chartFixture();
  await waitFor(() => expect(gantt.viewport()).toBe(viewport));
  const anchor = gantt.visibleRange().start;
  gantt.setScale('month');
  await Promise.resolve();
  expect(gantt.visibleRange().start).toBeCloseTo(anchor);
  resize(1800);
  setRange({ start: gantt.range().start - 20, end: gantt.range().end + 365 });
  await Promise.resolve();
  expect(gantt.visibleRange().start).toBeCloseTo(anchor);
  expect(gantt.width() - viewport.clientWidth).toBeGreaterThanOrEqual(
    viewport.scrollLeft
  );
});

it('anchors zoom buttons to the calendar center and blocks them during active edits', async () => {
  const { gantt, viewport } = chartFixture();
  await waitFor(() => expect(gantt.viewport()).toBe(viewport));
  const center = () =>
    (gantt.visibleRange().start + gantt.visibleRange().end) / 2;
  const anchor = center();
  const zoom = screen.getByRole('button', { name: 'Zoom in' });
  const reset = screen.getByRole('button', { name: 'Reset zoom' });
  fireEvent.click(zoom);
  await Promise.resolve();
  expect(gantt.pixelsPerDay()).toBe(25);
  expect(center()).toBeCloseTo(anchor);
  fireEvent.click(reset);
  await Promise.resolve();
  expect(gantt.pixelsPerDay()).toBe(20);
  expect(center()).toBeCloseTo(anchor);
  gantt.setEditing(true);
  for (const name of ['Zoom in', 'Zoom out', 'Reset zoom']) {
    expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(
      true
    );
  }
});
it('initializes Today after delayed measurement and respects reduced motion', async () => {
  const { gantt, viewport, today, resize, setRange, container, scrollTo } =
    chartFixture(0);
  await Promise.resolve();
  expect(viewport.scrollLeft).toBe(0);
  resize(1200);
  await waitFor(() =>
    expect(
      (gantt.visibleRange().start + gantt.visibleRange().end) / 2
    ).toBeCloseTo(today + 0.5)
  );
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
  expect(scrollTo).toHaveBeenLastCalledWith({
    left: viewport.scrollLeft,
    behavior: 'smooth',
  });
  const left = viewport.scrollLeft;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true }))
  );
  viewport.scrollLeft += 100;
  fireEvent.scroll(viewport);
  gantt.scrollToToday();
  await Promise.resolve();
  expect(viewport.scrollLeft).toBe(left);
  expect(scrollTo).toHaveBeenCalledOnce();
});

it('pads the complete Today animation path without shifting its start or rebasing during animation frames', async () => {
  const { gantt, viewport, scrollTo, today } = chartFixture();
  await waitFor(() => expect(gantt.viewport()).toBe(viewport));
  await Promise.resolve();
  gantt.setScale('month');
  await Promise.resolve();
  viewport.scrollLeft += 200;
  fireEvent.scroll(viewport);
  const anchor = gantt.visibleRange().start;
  let left = viewport.scrollLeft;
  const writeScroll = vi.fn((value: number) => {
    left = Math.max(
      0,
      Math.min(value, viewport.scrollWidth - viewport.clientWidth)
    );
  });
  Object.defineProperty(viewport, 'scrollLeft', {
    get: () => left,
    set: writeScroll,
  });
  scrollTo.mockImplementationOnce(() => {});
  gantt.scrollToToday();
  await Promise.resolve();
  const days =
    (viewport.clientWidth - gantt.labelWidth()) / gantt.pixelsPerDay();
  const padding = Math.max(
    30,
    Math.ceil(viewport.clientWidth / gantt.pixelsPerDay())
  );
  const destination = today + 0.5 - days / 2;
  expect(gantt.range().start).toBeLessThanOrEqual(
    Math.floor(Math.min(anchor, destination) - padding)
  );
  expect(gantt.range().end).toBeGreaterThanOrEqual(
    Math.ceil(Math.max(anchor, destination) + days + padding)
  );
  expect(gantt.range().start + left / gantt.pixelsPerDay()).toBeCloseTo(anchor);
  const animation = scrollTo.mock.calls[0][0];
  expect(animation.behavior).toBe('smooth');
  const start = left;
  writeScroll.mockClear();
  for (let frame = 1; frame <= 10; frame++) {
    left = start + ((animation.left! - start) * frame) / 10;
    fireEvent.scroll(viewport);
    await Promise.resolve();
  }
  expect(writeScroll).not.toHaveBeenCalled();
  expect(
    (gantt.visibleRange().start + gantt.visibleRange().end) / 2
  ).toBeCloseTo(today + 0.5);
});
function creationFixture(minDate?: string) {
  const onCreate = vi.fn();
  const [canCreate, setCanCreate] = createSignal(true);
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', { value: 1000 });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
  let gantt!: ReturnType<typeof useGantt>;
  const view = render(() =>
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
    return event;
  };
  return { ...view, viewport, gantt, pointer, onCreate, setCanCreate };
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
  const { viewport, pointer, onCreate } = creationFixture('1970-01-21');
  pointer(viewport, 'pointerdown', 500);
  pointer(window, 'pointermove', 700);
  pointer(window, 'pointerup', 700);
  expect(onCreate).not.toHaveBeenCalled();
  pointer(viewport, 'pointerdown', 700);
  pointer(window, 'pointermove', 500);
  pointer(window, 'pointerup', 500);
  expect(toGanttDay(onCreate.mock.calls[0][0].start)).toBe(20);
  expect(toGanttDay(onCreate.mock.calls[0][0].end)).toBe(22);
});

it.each(['blur', 'pointercancel', 'unmount', 'viewport-replacement'])(
  'cancels creation and invalidates queued callbacks on %s',
  (reason) => {
    const { viewport, gantt, pointer, onCreate, unmount } = creationFixture();
    const events: EventTarget = window;
    const listeners = vi.spyOn(events, 'addEventListener');
    const removed = vi.spyOn(events, 'removeEventListener');
    pointer(viewport, 'pointerdown', 500);
    pointer(window, 'pointermove', 580);
    expect(gantt.editing()).toBe(true);
    const finish = listeners.mock.calls.find(
      ([type]) => type === 'pointerup'
    )?.[1];
    const update = listeners.mock.calls.find(
      ([type]) => type === 'pointermove'
    )?.[1];
    if (typeof finish !== 'function' || typeof update !== 'function')
      throw new Error('Creation listeners were not registered');

    switch (reason) {
      case 'blur':
        fireEvent.blur(window);
        break;
      case 'pointercancel':
        pointer(window, 'pointercancel', 580);
        break;
      case 'unmount':
        unmount();
        break;
      case 'viewport-replacement':
        gantt.setViewport(document.createElement('div'));
        break;
    }
    expect(gantt.editing()).toBe(false);
    expect(removed).toHaveBeenCalledWith('pointerup', finish);
    expect(removed).toHaveBeenCalledWith('pointermove', update);

    gantt.setEditing(true);
    update.call(window, pointer(window, 'pointermove', 620));
    finish.call(window, pointer(window, 'pointerup', 620));
    expect(onCreate).not.toHaveBeenCalled();
    expect(gantt.editing()).toBe(true);
    gantt.setEditing(false);
  }
);

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
    'data-gantt-pagination',
    'data-gantt-group-header',
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
  pointer(window, 'pointerup', 580);
  pointer(viewport, 'pointerdown', 500);
  expect(gantt.editing()).toBe(false);
  pointer(window, 'pointerup', 580);
  setCanCreate(true);
  expect(onCreate).not.toHaveBeenCalled();
});
