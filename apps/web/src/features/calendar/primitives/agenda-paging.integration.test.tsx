import { cleanup, render } from '@solidjs/testing-library';
import { For, onMount } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { agendaEventsByDay, agendaShift, agendaWindow } from './agenda-window';
import { createAgendaPaging } from './create-agenda-paging';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps consecutive mounted days and the visible anchor through repeated older/newer rotations', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    frames.push(callback)
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  const date = new Date(2026, 5, 15);
  let viewport!: HTMLDivElement;
  let paging!: ReturnType<typeof createAgendaPaging>;
  render(() => {
    paging = createAgendaPaging(() => viewport, date);
    onMount(() => {
      Object.defineProperty(viewport, 'clientHeight', { value: 400 });
      Object.defineProperty(viewport, 'scrollHeight', {
        get: () => viewport.querySelectorAll('[data-agenda-day]').length * 30,
      });
      viewport.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
      paging.positionInitial();
    });
    return (
      <div ref={viewport} onScroll={() => paging.onScroll()}>
        <For each={paging.indices()}>
          {(index) => (
            <div data-agenda-window={index}>
              <For
                each={agendaEventsByDay([], agendaWindow(date, index).start)}
              >
                {(day) => (
                  <section
                    data-agenda-day={day.date.toDateString()}
                    ref={(element) => {
                      element.getBoundingClientRect = () => {
                        const row = [
                          ...viewport.querySelectorAll('[data-agenda-day]'),
                        ].indexOf(element);
                        return {
                          top: row * 30 - viewport.scrollTop,
                          bottom: (row + 1) * 30 - viewport.scrollTop,
                        } as DOMRect;
                      };
                    }}
                  />
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    );
  });
  const checkDays = () => {
    const days = [
      ...viewport.querySelectorAll<HTMLElement>('[data-agenda-day]'),
    ].map((day) => day.dataset.agendaDay);
    expect(days).toHaveLength(70);
    expect(new Set(days).size).toBe(70);
    for (let i = 1; i < days.length; i++)
      expect(days[i]).toBe(
        agendaShift(new Date(days[i - 1]!), 1).toDateString()
      );
  };
  const rotate = (direction: -1 | 1) => {
    viewport.dispatchEvent(new Event('pointerdown'));
    viewport.scrollTop =
      direction < 0 ? 0 : viewport.scrollHeight - viewport.clientHeight;
    const anchor = paging.capturePosition();
    const before = paging.indices()[0];
    viewport.dispatchEvent(new Event('scroll'));
    expect(paging.indices()[0]).toBe(before + direction);
    frames.shift()?.(0);
    expect(paging.capturePosition()?.date).toBe(anchor?.date);
    expect(paging.capturePosition()?.top).toBe(anchor?.top);
    checkDays();
  };
  checkDays();
  for (let i = 0; i < 4; i++) rotate(-1);
  for (let i = 0; i < 8; i++) rotate(1);
  for (let i = 0; i < 4; i++) rotate(-1);
  expect(paging.indices()).toEqual([-2, -1, 0, 1, 2]);
});
