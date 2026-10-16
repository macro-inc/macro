import { afterEach, expect, it } from 'vitest';
import { createKanbanWheelScroll } from './kanban-wheel-scroll';

afterEach(() => document.body.replaceChildren());

function fixture() {
  const viewport = document.createElement('div');
  const first = document.createElement('div');
  const second = document.createElement('div');
  first.dataset.lane = '';
  second.dataset.lane = '';
  viewport.append(first, second);
  document.body.append(viewport);
  for (const element of [viewport, first, second]) {
    Object.defineProperties(element, {
      clientWidth: { value: 100 },
      scrollWidth: { value: 1000 },
      clientHeight: { value: 100 },
      scrollHeight: { value: 1000 },
    });
  }
  let now = 0;
  const scroll = createKanbanWheelScroll({
    viewport: () => viewport,
    verticalViewport: (target) => target.closest('[data-lane]'),
    now: () => now,
  });
  viewport.addEventListener('wheel', scroll.onWheel);
  const wheel = (
    target: HTMLElement,
    deltaY = 80,
    extra: WheelEventInit = {}
  ) => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY,
      ...extra,
    });
    target.dispatchEvent(event);
    now += 16;
    return event;
  };
  return {
    viewport,
    first,
    second,
    wheel,
    idle: () => {
      now += 181;
    },
  };
}

it('keeps horizontal momentum when a column moves underneath the pointer', () => {
  const board = fixture();
  board.wheel(board.viewport);
  board.wheel(board.first);
  board.wheel(board.second);
  expect(board.viewport.scrollLeft).toBe(240);
  expect(board.first.scrollTop).toBe(0);
  expect(board.second.scrollTop).toBe(0);
  board.idle();
  board.wheel(board.second);
  expect(board.viewport.scrollLeft).toBe(240);
  expect(board.second.scrollTop).toBe(80);
});

it('keeps vertical momentum with its original column and consumes boundary events', () => {
  const board = fixture();
  board.wheel(board.first);
  board.wheel(board.second);
  board.wheel(board.viewport, 1000);
  expect(board.first.scrollTop).toBe(900);
  const boundary = board.wheel(board.second);
  expect(boundary.defaultPrevented).toBe(true);
  expect(board.second.scrollTop).toBe(0);
  expect(board.viewport.scrollLeft).toBe(0);
});

it('supports native horizontal deltas, line units, and releases ownership for zoom', () => {
  const board = fixture();
  board.wheel(board.first, 0, { deltaX: 4, deltaMode: 1 });
  expect(board.viewport.scrollLeft).toBe(64);
  const zoom = board.wheel(board.first, 80, { ctrlKey: true });
  expect(zoom.defaultPrevented).toBe(false);
  expect(board.viewport.scrollLeft).toBe(64);
  board.wheel(board.first);
  expect(board.first.scrollTop).toBe(80);
});
