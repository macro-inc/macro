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

it.each([1, 100])(
  'continues leftward scrolling through edge extensions without stale corrections or clamping (range end %i)',
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
            const content = createComponent(Gantt.Row, {
              children: 'Extent probe',
            });
            insert(viewport, content);
            return viewport;
          }, {});
        },
      })
    );
    gantt.setViewport(viewport);
    gantt.updateViewport();
    viewport.scrollTop = 77;
    let previousDay = gantt.visibleRange().start;
    for (const offset of [120.5, 0, 40.25, 0]) {
      const before = gantt.range();
      left = offset;
      const anchor = before.start + left / gantt.pixelsPerDay();
      writeScroll.mockClear();
      gantt.updateViewport();
      expect(gantt.range().start).toBeLessThan(before.start);
      expect(gantt.visibleRange().start).toBeCloseTo(anchor);
      expect(gantt.visibleRange().start).toBeLessThan(previousDay);
      expect(writeScroll).toHaveBeenCalledOnce();
      expect(viewport.scrollTop).toBe(77);
      // A compensation scroll event must not prepend twice or schedule old-position restoration.
      gantt.updateViewport();
      left -= 20.5;
      gantt.updateViewport();
      const moved = gantt.visibleRange().start;
      await Promise.resolve();
      vi.advanceTimersByTime(40);
      expect(gantt.visibleRange().start).toBeCloseTo(moved);
      expect(writeScroll).toHaveBeenCalledOnce();
      previousDay = moved;
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

it('keeps month and year labels aligned across year boundaries and changes month length with zoom', async () => {
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
  viewport.scrollLeft =
    (toGanttDay('2026-12-31')! - start) * gantt.pixelsPerDay();
  gantt.updateViewport();
  const december = view.getByText('December');
  const decemberLabel = december.parentElement!;
  const decemberYear = decemberLabel.querySelector('[data-gantt-year]')!;
  expect(decemberYear.textContent).toBe('2026');
  expect(december.nextElementSibling).toBe(decemberYear);
  expect(decemberLabel.classList.contains('sticky')).toBe(true);
  expect(decemberLabel.classList.contains('items-baseline')).toBe(true);
  const monthCell = decemberLabel.parentElement!;
  expect(monthCell.style.left).toBe('0px');
  expect(monthCell.classList.contains('overflow-clip')).toBe(true);
  expect(Number(decemberLabel.style.opacity)).toBe(0);
  const marks = view.container.querySelectorAll<HTMLElement>(
    '[data-gantt-date-mark]'
  );
  expect(marks.length).toBeGreaterThan(0);
  expect(
    [...marks].every(
      (mark) =>
        mark.classList.contains('top-full') &&
        mark.classList.contains('left-1/2') &&
        mark.parentElement?.textContent?.trim()
    )
  ).toBe(true);
  viewport.scrollLeft =
    (toGanttDay('2027-01-01')! - start) * gantt.pixelsPerDay();
  gantt.updateViewport();
  expect(
    view.getByText('January').closest<HTMLElement>('[data-gantt-month]')?.style
      .left
  ).toBe('620px');
  expect(view.queryByText('December')).toBeNull();
  viewport.scrollLeft =
    (toGanttDay('2027-02-01')! - start) * gantt.pixelsPerDay();
  gantt.updateViewport();
  const february = view.getByText('February');
  expect(Number(february.parentElement!.style.opacity)).toBe(1);
  const februaryLabel = february.parentElement!;
  const year = february.nextElementSibling!;
  expect(year.textContent).toBe('2027');
  viewport.scrollLeft += 20;
  gantt.updateViewport();
  expect(view.getByText('February').parentElement).toBe(februaryLabel);
  expect(view.getByText('February').nextElementSibling).toBe(year);
  gantt.setScale('month');
  await Promise.resolve();
  expect(view.getByText('Feb').parentElement).toBe(februaryLabel);
  expect(view.queryByText('February')).toBeNull();
  expect(view.getByText('Feb').nextElementSibling).toBe(year);
  gantt.setScale('day');
  await Promise.resolve();
  expect(view.getByText('February')).toBeTruthy();
  expect(view.queryByText('Feb')).toBeNull();
  for (const tick of view.container.querySelectorAll<HTMLElement>(
    '[data-gantt-date-tick]'
  )) {
    const day = Number.parseFloat(tick.style.left) / gantt.pixelsPerDay();
    expect(day).toBeCloseTo(Math.round(day));
  }
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
  const more = document.createElement('button');
  more.type = 'button';
  more.textContent = 'Load more rows';
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
                            return createComponent(Gantt.GroupHeader, {
                              children: 'Group heading',
                            });
                          },
                        }),
                      ]
                    : []),
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
                        createComponent(Gantt.Row, {
                          get children() {
                            return createComponent(Gantt.Pagination, {
                              children: more,
                            });
                          },
                        }),
                      ]
                    : []),
                  createComponent(Gantt.TodayMarker, {}),
                ];
              },
            }),
            ...(drawer
              ? [
                  createComponent(Gantt.SidebarToggle, {}),
                  createComponent(Gantt.Controls, {
                    get children() {
                      return [
                        createComponent(Gantt.TodayButton, {}),
                        createComponent(Gantt.Settings, {}),
                      ];
                    },
                  }),
                ]
              : []),
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
it('opens the item drawer without shifting dates and restores focus after dismissal', async () => {
  const view = chartFixture(1000, true);
  const { gantt, viewport, container } = view;
  await waitFor(() => expect(gantt.viewport()).toBe(viewport));
  await Promise.resolve();
  await Promise.resolve();
  gantt.sidebar.setOpen(false);
  viewport.scrollTop = 100;
  const left = viewport.scrollLeft;
  const width = gantt.width();
  const anchor = gantt.visibleRange().start;
  const barLabel = container.querySelector<HTMLElement>(
    '[data-gantt-bar-label]'
  )!;
  const barLabelLeft = Number.parseFloat(barLabel.style.left);
  const toggle = view.getByRole('button', { name: 'Show timeline items' });
  expect(view.queryByRole('button', { name: 'Item list entry' })).toBeNull();
  const drawerLabel = view
    .getByText('Item list entry')
    .closest<HTMLElement>('[data-gantt-label]')!;
  expect(drawerLabel.inert).toBe(true);
  expect(
    container.querySelector('[data-gantt-header]')?.childElementCount
  ).toBe(1);
  expect(viewport.contains(view.getByRole('button', { name: 'Today' }))).toBe(
    false
  );
  expect(container.querySelector('[data-gantt-sidebar-surface]')).toBeNull();
  expect(drawerLabel.style.width).toBe('264px');
  expect(drawerLabel.classList.contains('overflow-clip')).toBe(true);

  fireEvent.click(toggle);
  const item = view.getByRole('button', { name: 'Item list entry' });
  expect(Number.parseFloat(barLabel.style.left)).toBeCloseTo(
    barLabelLeft + gantt.sidebar.width()
  );
  expect(gantt.labelWidth()).toBe(0);
  expect(gantt.width()).toBe(width);
  expect(viewport.scrollLeft).toBe(left);
  expect(viewport.scrollTop).toBe(100);
  const monthLabel = container.querySelector<HTMLElement>(
    '[data-gantt-month] > .sticky'
  )!;
  expect(monthLabel.style.left).toBe('64px');
  expect(container.querySelector('[data-gantt-toggle-mask]')).not.toBeNull();
  expect(gantt.visibleRange().start).toBe(anchor);
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
  expect(monthLabel.style.left).toBe('64px');
  expect(Number.parseFloat(barLabel.style.left)).toBeCloseTo(barLabelLeft);

  fireEvent.click(toggle);
  view.getByRole('button', { name: /^Timeline item:/ }).focus();
  expect(gantt.sidebar.open()).toBe(true);
  expect(
    view.queryByRole('button', { name: 'Item list entry' })
  ).not.toBeNull();
  expect(drawerLabel.inert).toBe(false);
  expect(viewport.scrollLeft).toBe(left);
});

it('keeps pagination in the visible calendar without closing the drawer on chart clicks', async () => {
  const view = chartFixture(1000, true);
  const { gantt, viewport, container } = view;
  await waitFor(() => expect(gantt.viewport()).toBe(viewport));
  await Promise.resolve();
  await Promise.resolve();
  const pagination = container.querySelector<HTMLElement>(
    '[data-gantt-pagination]'
  )!;
  expect(pagination.style.width).toBe('720px');
  expect(pagination.style.left).toBe('280px');
  const group = container.querySelector<HTMLElement>(
    '[data-gantt-group-header]'
  )!;
  expect(group.style.width).toBe('992px');
  expect(group.style.left).toBe('');
  expect(group.closest('[data-gantt-label]')).toBeNull();
  const fades = container.querySelector<HTMLElement>(
    '[data-gantt-timeline-fades]'
  )!;
  expect(fades.closest('[data-gantt-header]')).not.toBeNull();
  expect(viewport.style.maskImage).toBe('');
  const fadeWindow = fades.firstElementChild as HTMLElement;
  expect(fadeWindow.style.left).toBe('0px');
  expect(fadeWindow.style.width).toBe('1000px');
  viewport.scrollLeft += 500;
  fireEvent.scroll(viewport);
  expect(pagination.style.width).toBe('720px');
  expect(fadeWindow.style.width).toBe('1000px');
  expect(group.style.width).toBe('992px');
  view.resize(320);
  expect(pagination.style.width).toBe('320px');
  expect(group.style.width).toBe('312px');
  expect(
    view.getByText('Group heading').closest('[aria-hidden="true"]')
  ).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Show timeline items' }));
  expect(view.queryByRole('button', { name: 'Load more rows' })).toBeNull();
  view.getByRole('button', { name: 'Item list entry' }).focus();
  view.resize(1000);
  const more = view.getByRole('button', { name: 'Load more rows' });
  fireEvent(more, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  expect(gantt.sidebar.open()).toBe(true);
  more.focus();
  expect(document.activeElement).toBe(more);
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
  expect(wheel(-100, false, 0, true).defaultPrevented).toBe(true);
  await Promise.resolve();
  expect(day()).toBeCloseTo(anchor);
});

it('retains wheel-zoom controls during momentum and hides them after inactivity', async () => {
  const { gantt, viewport, unmount } = chartFixture();
  await waitFor(() => expect(gantt.viewport()).toBe(viewport));
  await Promise.resolve();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const wheel = (ctrlKey: boolean) =>
    fireEvent(
      viewport,
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 760,
        ctrlKey,
        deltaY: -10,
      })
    );

  wheel(false);
  expect(gantt.scrollZooming()).toBe(false);
  wheel(true);
  expect(gantt.scrollZooming()).toBe(true);
  vi.advanceTimersByTime(600);
  wheel(true);
  vi.advanceTimersByTime(600);
  expect(gantt.scrollZooming()).toBe(true);
  vi.advanceTimersByTime(200);
  expect(gantt.scrollZooming()).toBe(false);
  gantt.setEditing(true);
  wheel(true);
  expect(gantt.scrollZooming()).toBe(false);
  gantt.setEditing(false);
  wheel(true);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('anchors floating zoom controls to the calendar center and disables them during editing or at bounds', async () => {
  const { gantt, viewport } = chartFixture();
  await waitFor(() => expect(gantt.viewport()).toBe(viewport));
  await Promise.resolve();
  await Promise.resolve();
  const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
  const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
  const reset = screen.getByRole('button', { name: 'Reset zoom' });
  const center = () =>
    (gantt.visibleRange().start + gantt.visibleRange().end) / 2;
  const anchor = center();
  expect(viewport.contains(zoomIn)).toBe(false);

  fireEvent.click(zoomIn);
  fireEvent.click(zoomIn);
  await Promise.resolve();
  expect(gantt.pixelsPerDay()).toBeCloseTo(31.25);
  expect(center()).toBeCloseTo(anchor);
  fireEvent.click(reset);
  await Promise.resolve();
  expect(gantt.pixelsPerDay()).toBe(20);
  expect(reset.textContent).toBe('100%');
  expect(center()).toBeCloseTo(anchor);

  gantt.setEditing(true);
  expect(zoomIn.hasAttribute('disabled')).toBe(true);
  expect(zoomOut.hasAttribute('disabled')).toBe(true);
  expect(reset.hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBe(zoomIn);
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBe(zoomOut);
  gantt.setEditing(false);
  gantt.zoomAt(630, -10_000);
  await Promise.resolve();
  expect(zoomIn.hasAttribute('disabled')).toBe(true);
  expect(zoomOut.hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBe(zoomIn);
  gantt.zoomAt(630, 10_000);
  await Promise.resolve();
  expect(zoomOut.hasAttribute('disabled')).toBe(true);
  expect(zoomIn.hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBe(zoomOut);
});

it('shrinks the default sidebar in narrow panes while retaining the current dates', async () => {
  const { gantt, viewport, resize } = chartFixture();
  await waitFor(() => expect(gantt.viewport()).toBe(viewport));
  await Promise.resolve();
  await Promise.resolve();
  const anchor = gantt.visibleRange().start;
  expect(gantt.labelWidth()).toBe(260);
  resize(600);
  expect(gantt.labelWidth()).toBe(180);
  resize(320);
  expect(gantt.labelWidth()).toBe(128);
  resize(280);
  expect(screen.getByRole('button', { name: 'Reset zoom' })).not.toBeNull();
  resize(288);
  expect(screen.getByRole('button', { name: 'Reset zoom' })).not.toBeNull();
  resize(200);
  expect(screen.getByRole('button', { name: 'Reset zoom' })).not.toBeNull();
  expect(
    screen.getByRole('button', { name: 'Zoom in' }).hasAttribute('disabled')
  ).toBe(false);
  expect(gantt.labelWidth()).toBe(100);
  resize(1200);
  await Promise.resolve();
  expect(gantt.labelWidth()).toBe(260);
  expect(screen.getByRole('button', { name: 'Reset zoom' })).not.toBeNull();
  expect(gantt.visibleRange().start).toBeCloseTo(anchor);
});

it('centers today once after delayed measurement and keeps both today lines out of sticky labels', async () => {
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
