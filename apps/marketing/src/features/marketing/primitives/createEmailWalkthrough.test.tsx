import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEmailWalkthrough } from './createEmailWalkthrough';

let observe: IntersectionObserverCallback;
let syncMotion: () => void;
let hidden = false;
let reduced = false;
beforeEach(() => {
  hidden = false;
  reduced = false;
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observe = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, callback: () => void) => {
      syncMotion = callback;
    },
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function visibility(ratio: number) {
  observe(
    [
      {
        isIntersecting: ratio > 0,
        intersectionRatio: ratio,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver
  );
}
function Scene(props: {
  advance: (step: number) => void;
  reset: () => void;
  reduced: () => void;
  loop?: { hold: number };
  entered?: boolean;
}) {
  let root!: HTMLDivElement;
  createEmailWalkthrough({
    ...props,
    root: () => root,
    steps: 2,
    delay: () => 1000,
  });
  return (
    <div
      class="demo-interaction-boundary"
      data-outer
      data-demo-interacted={props.entered}
    >
      <div class="demo-interaction-boundary">
        <div ref={root} />
      </div>
    </div>
  );
}
it('retains the remaining reading time offscreen and in hidden tabs', () => {
  const advance = vi.fn();
  render(() => <Scene advance={advance} reset={vi.fn()} reduced={vi.fn()} />);
  visibility(0.1);
  vi.advanceTimersByTime(3000);
  expect(advance).not.toHaveBeenCalled();
  visibility(1);
  vi.advanceTimersByTime(600);
  hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(5000);
  hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(399);
  expect(advance).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(advance).toHaveBeenLastCalledWith(1);
});

it('does not start a deferred scene after its containing demo was already entered', () => {
  const advance = vi.fn();
  render(() => (
    <Scene entered advance={advance} reset={vi.fn()} reduced={vi.fn()} />
  ));
  visibility(1);
  vi.advanceTimersByTime(10000);
  expect(advance).not.toHaveBeenCalled();
});
it('holds the result before a complete reset and starts the next sequence at step one', () => {
  const advance = vi.fn(),
    reset = vi.fn();
  render(() => (
    <Scene
      advance={advance}
      reset={reset}
      reduced={vi.fn()}
      loop={{ hold: 5000 }}
    />
  ));
  visibility(1);
  vi.advanceTimersByTime(6999);
  expect(advance.mock.calls).toEqual([[1], [2]]);
  expect(reset).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(reset).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000);
  expect(advance.mock.calls).toEqual([[1], [2], [1]]);
});
it('outer-boundary takeover permanently protects visitor edits from loops and motion changes', () => {
  const advance = vi.fn(),
    reset = vi.fn(),
    finish = vi.fn();
  const view = render(() => (
    <Scene
      advance={advance}
      reset={reset}
      reduced={finish}
      loop={{ hold: 5000 }}
    />
  ));
  visibility(1);
  vi.advanceTimersByTime(1000);
  view.container
    .querySelector('[data-outer]')!
    .dispatchEvent(new CustomEvent('macro-demo-interaction'));
  reduced = true;
  syncMotion();
  visibility(0);
  visibility(1);
  vi.advanceTimersByTime(20000);
  expect(advance.mock.calls).toEqual([[1]]);
  expect(reset).not.toHaveBeenCalled();
  expect(finish).not.toHaveBeenCalled();
});
