import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentAgentDemo, DocumentSharingDemo } from './DocumentStories';

let intersections: IntersectionObserverCallback[];
let motionListeners: (() => void)[];
let reduced = false;
let hidden = false;
beforeEach(() => {
  intersections = [];
  motionListeners = [];
  reduced = false;
  hidden = false;
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, callback: () => void) =>
      motionListeners.push(callback),
    removeEventListener: vi.fn(),
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
      unobserve() {}
      disconnect() {}
    }
  );
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
  for (const callback of intersections)
    callback(
      [{ isIntersecting: value } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
}
function reduce() {
  reduced = true;
  for (const callback of motionListeners) callback();
}
it('leaves the document editable and never replaces the visitor’s text', () => {
  const view = render(() => <DocumentAgentDemo />);
  visible(true);
  const body = view.getByRole('textbox', { name: 'Document body' });
  fireEvent.pointerDown(body);
  body.innerHTML = '<p>Our team’s revised launch plan.</p>';
  fireEvent.blur(body);
  reduce();
  vi.advanceTimersByTime(30000);
  expect(body.textContent).toContain('Our team’s revised launch plan.');
  expect(body.textContent).not.toContain('Teo: verify');
});

it('shows the finished document for reduced motion', () => {
  reduced = true;
  const view = render(() => <DocumentAgentDemo />);
  expect(
    view.getByRole('textbox', { name: 'Document body' }).textContent
  ).toContain('Teo: verify the invite flow.');
  vi.advanceTimersByTime(100);
  expect(vi.getTimerCount()).toBe(0);
});

it('shares the document with the chosen access and preserves it when reopened', () => {
  const view = render(() => <DocumentSharingDemo />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  const dialog = within(view.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('Email or group'), {
    target: { value: 'teo' },
  });
  fireEvent.change(dialog.getByLabelText('Access level'), {
    target: { value: 'Comment' },
  });
  fireEvent.click(dialog.getByRole('button', { name: 'Share' }));
  const access = view.container.querySelector('.product-share-access')!;
  expect(access.textContent).toContain('Teo Nys');
  expect(access.textContent).toContain('Comment');
  fireEvent.click(dialog.getByRole('button', { name: 'Close sharing' }));
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  expect(
    view.container.querySelector('.product-share-access')?.textContent
  ).toContain('Comment');
});
