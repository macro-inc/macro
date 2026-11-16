import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createProjectTasksSticky } from './create-project-tasks-sticky';

const observers: ControlledObserver[] = [];
class ControlledObserver implements IntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin = '0px';
  readonly scrollMargin = '0px';
  readonly thresholds = [0];
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
  takeRecords = () => [];
  constructor(
    private callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {
    this.root = options?.root ?? null;
    observers.push(this);
  }
  emit(target: Element, top: number, isIntersecting: boolean) {
    const bounds = new DOMRect(0, top, 1, 1);
    this.callback(
      [
        {
          target,
          isIntersecting,
          boundingClientRect: bounds,
          rootBounds: new DOMRect(0, 100, 390, 744),
          intersectionRect: bounds,
          intersectionRatio: isIntersecting ? 1 : 0,
          time: 0,
        },
      ],
      this
    );
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  observers.length = 0;
});

it('marks Tasks stuck only when the sentinel passes above its scroll root', () => {
  vi.stubGlobal('IntersectionObserver', ControlledObserver);
  const { root, marker, stuck, dispose } = createRoot((dispose) => {
    const root = document.createElement('div');
    const marker = document.createElement('div');
    const stuck = createProjectTasksSticky(
      () => root,
      () => marker
    );
    return { root, marker, stuck, dispose };
  });
  expect(stuck()).toBe(false);
  const observer = observers[0];
  expect(observer.root).toBe(root);
  expect(observer.observe).toHaveBeenCalledWith(marker);
  observer.emit(marker, 900, false);
  expect(stuck()).toBe(false);
  observer.emit(marker, 180, true);
  expect(stuck()).toBe(false);
  observer.emit(marker, 98, false);
  expect(stuck()).toBe(true);
  observer.emit(marker, 100, true);
  expect(stuck()).toBe(false);
  dispose();
  expect(observer.disconnect).toHaveBeenCalledOnce();
});

it('ignores late observations after rebinding or disposing the scroll root', () => {
  vi.stubGlobal('IntersectionObserver', ControlledObserver);
  const { marker, setRoot, stuck, dispose } = createRoot((dispose) => {
    const marker = document.createElement('div');
    const [root, setRoot] = createSignal<HTMLElement | undefined>(
      document.createElement('div')
    );
    const stuck = createProjectTasksSticky(root, () => marker);
    return { marker, setRoot, stuck, dispose };
  });
  const original = observers[0];
  original.emit(marker, 98, false);
  expect(stuck()).toBe(true);
  setRoot(document.createElement('div'));
  expect(original.disconnect).toHaveBeenCalledOnce();
  expect(stuck()).toBe(false);
  original.emit(marker, 98, false);
  expect(stuck()).toBe(false);
  const current = observers[1];
  current.emit(marker, 98, false);
  expect(stuck()).toBe(true);
  dispose();
  expect(current.disconnect).toHaveBeenCalledOnce();
  current.emit(marker, 180, true);
  expect(stuck()).toBe(true);
});
