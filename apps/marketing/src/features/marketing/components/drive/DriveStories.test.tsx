import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DriveArrivalsGraphic,
  DriveFileTypesGraphic,
  DriveViewsGraphic,
} from './DriveGraphics';

let visibility: IntersectionObserverCallback;
let reducedMotion = false;

beforeEach(() => {
  reducedMotion = false;
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('matchMedia', () => ({
    matches: reducedMotion,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        visibility = callback;
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const show = () =>
  visibility(
    [
      {
        isIntersecting: true,
        intersectionRatio: 1,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver
  );
const rows = (container: HTMLElement) =>
  [...container.querySelectorAll('.drive-row-name')].map(
    (row) => row.textContent
  );

it('adds the email attachment to Drive, then the file from the channel', () => {
  const view = render(() => <DriveArrivalsGraphic />);
  show();
  expect(rows(view.container)).not.toContain('Brand guidelines.pdf');
  vi.advanceTimersByTime(1300);
  expect(rows(view.container)[0]).toBe('Brand guidelines.pdf');
  vi.advanceTimersByTime(1700);
  expect(rows(view.container).slice(0, 2)).toEqual([
    'Customer demo.mp4',
    'Brand guidelines.pdf',
  ]);
});

it('shows both arrivals at once with reduced motion', () => {
  reducedMotion = true;
  const view = render(() => <DriveArrivalsGraphic />);
  show();
  expect(rows(view.container).slice(0, 2)).toEqual([
    'Customer demo.mp4',
    'Brand guidelines.pdf',
  ]);
});

it('opens each kind of file from its tab', () => {
  const view = render(() => <DriveFileTypesGraphic />);
  expect(view.getByText('Page 3 of 18')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Launch deck.pptx' }));
  expect(view.getByText('Slide 2 of 12')).toBeTruthy();
  expect(view.queryByText('Page 3 of 18')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Customer demo.mp4' }));
  expect(view.getByText('31:05')).toBeTruthy();
});

it('switches the same files between folders and a database', () => {
  const view = render(() => <DriveViewsGraphic />);
  expect(view.getByText('Customers')).toBeTruthy();
  expect(view.queryByText('Added by')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Database' }));
  expect(view.getByText('Added by')).toBeTruthy();
  expect(view.getByText('Launch budget.xlsx')).toBeTruthy();
  expect(
    view.getByRole('button', { name: 'Database' }).getAttribute('aria-pressed')
  ).toBe('true');
});
