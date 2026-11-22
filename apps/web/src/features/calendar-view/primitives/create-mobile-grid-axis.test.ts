// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMobileGridAxis } from './create-mobile-grid-axis';

let frame: FrameRequestCallback | undefined;
let resize: ResizeObserverCallback;
let observer: ResizeObserver;
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
        observer = this;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function setup() {
  const root = document.createElement('div');
  root.innerHTML =
    '<div class="fc-timegrid"><div class="fc-timegrid-axis-cushion">All day</div><div class="fc-scroller-harness-liquid"><div class="fc-scroller"><span class="fc-timegrid-slot-label-cushion">7 AM</span></div></div></div>';
  document.body.append(root);
  const scroller = root.querySelector<HTMLElement>('.fc-scroller')!;
  const label = root.querySelector<HTMLElement>(
    '.fc-timegrid-slot-label-cushion'
  )!;
  let left = 0;
  scroller.scrollTop = 420;
  Object.defineProperty(scroller, 'clientHeight', { value: 500 });
  scroller.getBoundingClientRect = () => new DOMRect(left, 100, 390, 500);
  root.getBoundingClientRect = () => new DOMRect(0, 0, 390, 700);
  label.getBoundingClientRect = () =>
    new DOMRect(left, 108 - (scroller.scrollTop - 420), 40, 14);
  let axis!: ReturnType<typeof createMobileGridAxis>;
  render(() => {
    axis = createMobileGridAxis(
      () => root,
      () => root
    );
    return null;
  });
  frame?.(0);
  return {
    axis,
    scroller,
    root,
    moveHorizontal(value: number) {
      left = value;
      resize([], observer);
      frame?.(1);
    },
  };
}

it('keeps hour geometry independent of horizontal page movement and follows vertical scroll', () => {
  const { axis, scroller, moveHorizontal } = setup();
  expect(axis.state.labels[0]).toEqual({ text: '7 AM', top: 428, height: 14 });
  expect(axis.faded()).toBe(false);
  moveHorizontal(-160);
  expect(axis.state.labels[0].top).toBe(428);
  expect(axis.state.top).toBe(100);
  fireEvent.wheel(scroller);
  scroller.scrollTop = 500;
  fireEvent.scroll(scroller);
  expect(axis.state.scrollTop).toBe(500);
  expect(axis.faded()).toBe(true);
  scroller.scrollTop = 420;
  fireEvent.scroll(scroller);
  expect(axis.faded()).toBe(false);
});

it('places the current-time label at the timed card line across scroll and paging', () => {
  const { axis, scroller, moveHorizontal } = setup();
  const line = document.createElement('div');
  line.className = 'fc-timegrid-now-indicator-line';
  line.innerHTML =
    '<span class="calendar-now-time" data-axis-label="10:30">10:30 AM</span>';
  scroller.append(line);
  let lineTop = 254;
  line.getClientRects = () =>
    Object.assign([line.getBoundingClientRect()], {
      item: (index: number) =>
        index === 0 ? line.getBoundingClientRect() : null,
    });
  line.getBoundingClientRect = () => new DOMRect(46, lineTop, 344, 1);

  moveHorizontal(-160);
  expect(axis.state.now).toEqual({ text: '10:30', top: 567, height: 14 });
  expect(axis.state.top + axis.currentTimeTop()!).toBe(lineTop);
  expect(axis.state.top + axis.state.now!.top - axis.state.scrollTop + 7).toBe(
    lineTop
  );

  scroller.scrollTop = 500;
  lineTop = 174;
  fireEvent.scroll(scroller);
  moveHorizontal(0);
  expect(axis.state.top + axis.state.now!.top - axis.state.scrollTop + 7).toBe(
    lineTop
  );
});

it('retires the old scroller listener with its owner', () => {
  const { axis, scroller } = setup();
  cleanup();
  scroller.scrollTop = 900;
  fireEvent.scroll(scroller);
  expect(axis.state.scrollTop).toBe(420);
});
