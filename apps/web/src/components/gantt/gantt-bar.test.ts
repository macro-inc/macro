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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pointer(target: Element | Window, type: string, x: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

function fixture(
  save: (date: Date) => Promise<void>,
  pointToDay: ReturnType<typeof useGantt>['pointToDay'] = () => ({
    day: toGanttDay('2026-03-13')!,
  }),
  drawer = false
) {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const [editable, setEditable] = createSignal(true);
  const viewport = document.createElement('div');
  let context!: ReturnType<typeof useGantt>;
  Object.defineProperty(viewport, 'clientWidth', { value: 1000 });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
  render(() =>
    createComponent(Gantt.Root, {
      labelWidth: drawer ? 0 : undefined,
      range: {
        start: toGanttDay('2026-03-01')!,
        end: toGanttDay('2026-06-01')!,
      },
      get children() {
        return createComponent(() => {
          const gantt = useGantt();
          context = gantt;
          gantt.setViewport(viewport);
          gantt.updateViewport();
          gantt.pointToDay = pointToDay;
          insert(
            viewport,
            createComponent(Gantt.Row, {
              get children() {
                return createComponent(Gantt.Bar, {
                  start: '2026-03-08',
                  end: '2026-03-10',
                  title: 'Example',
                  get onEndChange() {
                    return editable() ? save : undefined;
                  },
                  children: 'Example',
                });
              },
            })
          );
          return viewport;
        }, {});
      },
    })
  );
  const element = viewport.querySelector<HTMLElement>('[data-gantt-bar]')!;
  element.getBoundingClientRect = () =>
    new DOMRect(
      Number.parseFloat(element.style.left),
      0,
      Number.parseFloat(element.style.width),
      28
    );
  return {
    setEditable,
    element: () => element,
    scrollTo: (left: number) => {
      viewport.scrollLeft = left;
      context.updateViewport();
    },
    handle: () =>
      screen.getByRole('button', { name: 'Resize end date for Example' }),
    end: () =>
      Number(
        viewport.querySelector<HTMLElement>('[data-gantt-bar]')?.dataset
          .ganttEnd
      ),
  };
}

it('cancels clicks, Escape, and revoked editing without persisting resize previews', () => {
  const save = vi.fn(async (_date: Date) => {});
  const bar = fixture(save);
  const original = toGanttDay('2026-03-10')!;
  pointer(bar.handle(), 'pointerdown', 500);
  pointer(window, 'pointerup', 500);
  expect(save).not.toHaveBeenCalled();

  pointer(bar.handle(), 'pointerdown', 500);
  pointer(window, 'pointermove', 540);
  expect(bar.end()).toBe(toGanttDay('2026-03-12'));
  fireEvent.keyDown(bar.handle(), { key: 'ArrowRight' });
  expect(save).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(bar.end()).toBe(original);

  pointer(bar.handle(), 'pointerdown', 500);
  pointer(window, 'pointermove', 540);
  bar.setEditable(false);
  pointer(window, 'pointerup', 540);
  expect(bar.end()).toBe(original);
  expect(save).not.toHaveBeenCalled();
});

it('commits an inclusive end once and restores the displayed date when saving fails', async () => {
  const save = vi.fn(async (_date: Date) => {
    throw new Error('Save failed');
  });
  const bar = fixture(save);
  pointer(bar.handle(), 'pointerdown', 500);
  pointer(window, 'pointermove', 540);
  pointer(window, 'pointerup', 540);
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not save end date'
    )
  );
  expect(save).toHaveBeenCalledTimes(1);
  expect(toGanttDay(save.mock.calls[0][0])).toBe(toGanttDay('2026-03-12'));
  expect(bar.end()).toBe(toGanttDay('2026-03-10'));
});

it('follows fractional pointer movement and writes the displayed calendar date', async () => {
  const save = vi.fn(async (_date: Date) => {});
  const boundary = toGanttDay('2026-03-13')!;
  const bar = fixture(save, (x, _exclude, snap = true) => ({
    day: boundary + (snap ? 0 : (x - 540) / 20),
  }));
  pointer(
    bar.handle(),
    'pointerdown',
    bar.element().getBoundingClientRect().right
  );
  pointer(window, 'pointermove', 541);
  const width = Number.parseFloat(bar.element().style.width);
  pointer(window, 'pointermove', 542);
  expect(Number.parseFloat(bar.element().style.width)).toBeCloseTo(width + 1);
  expect(screen.getByRole('status').textContent).toBe('Mar 12, 2026');
  pointer(window, 'pointerup', 542);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(toGanttDay(save.mock.calls[0][0])).toBe(boundary - 1);
});

it.each([false, true])(
  'keeps the resize tooltip above group headers and outside sidebar clipping (drawer: %s)',
  (drawer) => {
    const bar = fixture(async (_date: Date) => {}, undefined, drawer);
    bar.scrollTo(170);
    pointer(bar.handle(), 'pointerdown', 500);
    pointer(window, 'pointermove', 540);
    const body = bar
      .element()
      .querySelector<HTMLElement>('[data-gantt-bar-body]')!;
    const clip = body.closest<HTMLElement>('[data-gantt-calendar-clip]')!;
    expect(clip.style.left).toBe(drawer ? '0px' : '260px');
    expect(clip.classList.contains('sticky')).toBe(true);
    const boundary = clip.style.clipPath;
    const tooltip = screen.getByRole('status');
    const preview = tooltip.closest<HTMLElement>(
      '[data-gantt-resize-preview]'
    )!;
    expect(preview.classList.contains('z-50')).toBe(true);
    expect(bar.element().contains(preview)).toBe(false);
    expect(bar.element().classList.contains('z-10')).toBe(true);
    expect(clip.contains(tooltip)).toBe(false);
    expect(tooltip.classList.contains('top-full')).toBe(true);
    expect(tooltip.style.maxWidth).toBe(drawer ? '704px' : '724px');
    expect(tooltip.style.translate).toContain('clamp(');
    bar.scrollTo(190);
    expect(clip.style.clipPath).toBe(boundary);
    fireEvent.keyDown(window, { key: 'Escape' });
  }
);

it('uses native sticky text bounded by the bar through scrolling, zoom, and narrow panes', async () => {
  const viewport = document.createElement('div');
  let width = 500;
  Object.defineProperty(viewport, 'clientWidth', { get: () => width });
  let gantt!: ReturnType<typeof useGantt>;
  const view = render(() =>
    createComponent(Gantt.Root, {
      range: { start: 0, end: 100 },
      get children() {
        return createComponent(() => {
          gantt = useGantt();
          gantt.setViewport(viewport);
          gantt.updateViewport();
          return createComponent(Gantt.Bar, {
            start: '1970-01-06',
            end: '1970-02-10',
            children: 'A long timeline',
          });
        }, {});
      },
    })
  );
  const bar = view.container.querySelector<HTMLElement>('[data-gantt-bar]')!;
  const label = bar.querySelector<HTMLElement>('[data-gantt-bar-label]')!;
  const button = label.closest('button')!;
  expect(label.classList.contains('sticky')).toBe(true);
  expect(label.classList.contains('max-w-full')).toBe(true);
  expect(label.classList.contains('overflow-hidden')).toBe(true);
  expect(button.classList.contains('overflow-hidden')).toBe(false);
  expect(label.style.left).toBe('150px');
  expect(label.style.width).toBe('');
  expect(bar.style.width).toBe('720px');

  viewport.scrollLeft = 200;
  gantt.updateViewport();
  expect(label.style.left).toBe('150px');
  gantt.setScale('month');
  await Promise.resolve();
  expect(bar.style.width).toBe('216px');
  expect(label.style.left).toBe('150px');

  width = 300;
  gantt.updateViewport();
  expect(label.style.left).toBe('128px');
  viewport.scrollLeft = 41 * gantt.pixelsPerDay();
  gantt.updateViewport();
  expect(label.style.left).toBe('128px');
  expect(label.style.width).toBe('');
  expect(bar.querySelector('[data-gantt-calendar-clip]')).not.toBeNull();
});

it('keeps sticky bar text outside the open drawer without scrolling calculations', () => {
  const bar = fixture(async (_date: Date) => {}, undefined, true);
  const label = bar
    .element()
    .querySelector<HTMLElement>('[data-gantt-bar-label]')!;
  expect(label.style.left).toBe('280px');
  bar.scrollTo(190);
  expect(label.style.left).toBe('280px');
});
