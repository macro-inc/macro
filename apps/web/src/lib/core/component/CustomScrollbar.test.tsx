import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { createScrollTopFade } from '../util/createScrollTopFade';
import { CustomScrollbar } from './CustomScrollbar';

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => false,
}));

vi.mock('@ui', () => ({
  cn: (...classes: string[]) => classes.filter(Boolean).join(' '),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('activates the scroller fade through a sibling scrollbar click and drag', () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        callback([], this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const element = document.createElement('div');
  Object.defineProperties(element, {
    clientHeight: { value: 100 },
    scrollHeight: { value: 1000 },
  });
  element.scrollTop = 400;
  const { container } = render(() => {
    createScrollTopFade(() => element);
    return (
      <div>
        {element}
        <CustomScrollbar scrollContainer={() => element} gutterSize={16} />
      </div>
    );
  });
  vi.advanceTimersByTime(20);
  const gutter = container.querySelector<HTMLElement>('[aria-hidden="true"]');
  if (!gutter) throw new Error('Expected a scrollable gutter');
  Object.defineProperties(gutter, {
    setPointerCapture: { value: () => {} },
    hasPointerCapture: { value: () => true },
    releasePointerCapture: { value: () => {} },
  });
  vi.spyOn(gutter, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 16, 100)
  );
  expect(element.style.maskImage).toBe('');

  gutter.dispatchEvent(
    new MouseEvent('pointerdown', { button: 0, clientY: 80, bubbles: true })
  );
  expect(element.scrollTop).toBeGreaterThan(400);
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toContain('black 32px');

  gutter.dispatchEvent(
    new MouseEvent('pointermove', { clientY: 40, bubbles: true })
  );
  expect(element.scrollTop).toBeLessThan(400);
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toContain('black 32px');
});

it('ignores zoom gestures over an enlarged scrollbar gutter', () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        callback([], this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const element = document.createElement('div');
  Object.defineProperties(element, {
    clientHeight: { value: 100 },
    scrollHeight: { value: 1000 },
  });
  element.scrollTop = 400;
  const { container } = render(() => {
    createScrollTopFade(() => element);
    return (
      <div>
        {element}
        <CustomScrollbar scrollContainer={() => element} gutterSize={16} />
      </div>
    );
  });
  vi.advanceTimersByTime(20);
  const gutter = container.querySelector<HTMLElement>('[aria-hidden="true"]');
  if (!gutter) throw new Error('Expected a scrollable gutter');

  gutter.dispatchEvent(
    new WheelEvent('wheel', { deltaY: 40, ctrlKey: true, bubbles: true })
  );
  expect(element.scrollTop).toBe(400);
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toBe('');

  gutter.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true }));
  expect(element.scrollTop).toBe(440);
  element.dispatchEvent(new Event('scroll'));
  expect(element.style.maskImage).toContain('black 32px');
});
