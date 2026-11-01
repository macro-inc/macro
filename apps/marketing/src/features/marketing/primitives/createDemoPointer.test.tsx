import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DemoCursor } from '../components/DemoCursor';
import { createDemoPointer } from './createDemoPointer';

let resize: () => void;
let select: (value: string | undefined) => void;
let targetLeft = 100;
beforeEach(() => {
  vi.useFakeTimers();
  targetLeft = 100;
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
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const frame = this.hasAttribute('data-frame');
      const x = frame ? 0 : targetLeft;
      const width = frame ? 800 : 80,
        height = frame ? 600 : 40;
      return {
        x,
        y: 0,
        left: x,
        top: 0,
        width,
        height,
        right: x + width,
        bottom: height,
        toJSON: () => ({}),
      };
    }
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Scene() {
  let frame!: HTMLDivElement;
  const [target, setTarget] = createSignal<string | undefined>(
    '[data-control]'
  );
  select = setTarget;
  const point = createDemoPointer({ frame: () => frame, target });
  return (
    <div class="demo-interaction-boundary">
      <div ref={frame} data-frame>
        <button data-control>Open menu</button>
        <Show when={point()}>
          {(p) => (
            <DemoCursor
              style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
            />
          )}
        </Show>
      </div>
    </div>
  );
}
it('keeps the same pointer node and position while a target is replaced, then follows layout changes', () => {
  const view = render(Scene);
  vi.advanceTimersByTime(32);
  const cursor = view.container.querySelector('.demo-cursor');
  expect(cursor?.getAttribute('style')).toContain('136px');
  select(undefined);
  vi.advanceTimersByTime(32);
  expect(view.container.querySelector('.demo-cursor')).toBe(cursor);
  targetLeft = 300;
  select('[data-control]');
  vi.advanceTimersByTime(32);
  expect(cursor?.getAttribute('style')).toContain('336px');
  targetLeft = 400;
  resize();
  vi.advanceTimersByTime(32);
  expect(cursor?.getAttribute('style')).toContain('436px');
});
it('does not bring the demonstration pointer back after visitor takeover', () => {
  const view = render(Scene);
  vi.advanceTimersByTime(32);
  view.container
    .querySelector('.demo-interaction-boundary')!
    .dispatchEvent(new CustomEvent('macro-demo-interaction'));
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
  resize();
  select('[data-control]');
  vi.advanceTimersByTime(32);
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('hides the pointer during the result hold and starts fresh for the next untouched sequence', () => {
  const view = render(Scene);
  const frame = view.container.querySelector('[data-frame]')!;
  vi.advanceTimersByTime(32);
  expect(view.container.querySelector('.demo-cursor')).toBeTruthy();
  frame.dispatchEvent(
    new CustomEvent('macro-demo-finished', { bubbles: true })
  );
  resize();
  vi.advanceTimersByTime(32);
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
  frame.dispatchEvent(new CustomEvent('macro-demo-reset', { bubbles: true }));
  vi.advanceTimersByTime(32);
  expect(view.container.querySelector('.demo-cursor')).toBeTruthy();
  view.container
    .querySelector('.demo-interaction-boundary')!
    .dispatchEvent(new CustomEvent('macro-demo-interaction'));
  frame.dispatchEvent(new CustomEvent('macro-demo-reset', { bubbles: true }));
  vi.advanceTimersByTime(32);
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});
