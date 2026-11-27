import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrmRecordDemo } from './CrmRecordDemo';

let observe: IntersectionObserverCallback;
let reduced = false;
beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') && reduced,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: HTMLElement) {
        if (target.classList.contains('crm-demo-frame'))
          observe = this.callback;
      }
      disconnect() {}
      unobserve() {}
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.advanceTimersByTime(100);
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function visible(value: boolean) {
  observe(
    [
      {
        isIntersecting: value,
        intersectionRatio: value ? 1 : 0,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver
  );
}

it('shows the same files and tasks in the preceding customer-record tour', () => {
  const view = render(() => <CrmRecordDemo />);
  visible(true);
  vi.advanceTimersByTime(5400);
  expect(view.getByLabelText('Company files').textContent).toContain(
    'Setup guide'
  );
  vi.advanceTimersByTime(2000);
  expect(view.getByLabelText('Company tasks').textContent).toContain(
    'Verify folder uploads in production'
  );
  fireEvent.click(view.getByRole('radio', { name: 'Files' }));
  vi.advanceTimersByTime(20000);
  expect(view.getByLabelText('Company files')).toBeTruthy();
});
