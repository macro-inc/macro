import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import HomepageCollaborativeDoc from './HomepageCollaborativeDoc';

let intersections: IntersectionObserverCallback[];
let reduced = false;
beforeEach(() => {
  intersections = [];
  reduced = false;
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({
    matches: reduced,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersections.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function show() {
  for (const callback of intersections)
    callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
}

it('restores actual document content in both directions and holds the chosen edit', () => {
  const view = render(() => <HomepageCollaborativeDoc />);
  const slider = view.getByRole('slider', { name: 'Document version history' });
  const scene = view.container.querySelector('.mds')!;
  show();
  fireEvent.input(slider, { target: { value: '1000' } });
  const finished = scene.textContent;
  expect(finished).toContain('Q3 launch plan');
  fireEvent.input(slider, { target: { value: '200' } });
  const earlier = scene.textContent;
  expect(earlier).not.toBe(finished);
  vi.advanceTimersByTime(10000);
  expect(scene.textContent).toBe(earlier);
  fireEvent.input(slider, { target: { value: '1000' } });
  expect(scene.textContent).toBe(finished);
  fireEvent.input(slider, { target: { value: '0' } });
  expect(scene.textContent).not.toContain('Launch owner:');
});

it('pauses autoplay immediately when the handle is grabbed', () => {
  const view = render(() => <HomepageCollaborativeDoc />);
  const slider = view.getByRole('slider') as HTMLInputElement;
  show();
  vi.advanceTimersByTime(2000);
  expect(Number(slider.value)).toBeGreaterThan(0);
  fireEvent.pointerDown(slider);
  const position = slider.value;
  vi.advanceTimersByTime(5000);
  expect(slider.value).toBe(position);
});

it('shows the completed document with reduced motion but still permits scrubbing', () => {
  reduced = true;
  const view = render(() => <HomepageCollaborativeDoc />);
  const slider = view.getByRole('slider') as HTMLInputElement;
  show();
  expect(slider.value).toBe('1000');
  fireEvent.input(slider, { target: { value: '300' } });
  vi.advanceTimersByTime(5000);
  expect(slider.value).toBe('300');
});
