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
  })
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

it('clips the dragged bar body behind sticky labels while keeping its value tooltip outside the clip', () => {
  const bar = fixture(async (_date: Date) => {});
  bar.scrollTo(170);
  pointer(bar.handle(), 'pointerdown', 500);
  pointer(window, 'pointermove', 540);
  const body = bar
    .element()
    .querySelector<HTMLElement>('[data-gantt-bar-body]')!;
  const clip = body.closest<HTMLElement>('[data-gantt-calendar-clip]')!;
  expect(clip.style.left).toBe('260px');
  expect(clip.classList.contains('sticky')).toBe(true);
  const boundary = clip.style.clipPath;
  const tooltip = screen.getByRole('status');
  expect(clip.contains(tooltip)).toBe(false);
  expect(tooltip.classList.contains('top-full')).toBe(true);
  expect(tooltip.style.maxWidth).toBe('724px');
  expect(tooltip.style.translate).toContain('clamp(');
  bar.scrollTo(190);
  expect(clip.style.clipPath).toBe(boundary);
  fireEvent.keyDown(window, { key: 'Escape' });
});
