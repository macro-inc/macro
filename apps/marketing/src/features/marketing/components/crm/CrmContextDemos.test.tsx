import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrmConnectedWorkDemo } from './CrmConnectedWorkDemo';
import { CrmEnrichmentDemo } from './CrmEnrichmentDemo';

let visible: IntersectionObserverCallback;
let reduced = false;
beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('matchMedia', () => ({
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        visible = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  expect(fetch).not.toHaveBeenCalled();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setVisible(isIntersecting: boolean) {
  visible(
    [{ isIntersecting } as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
}

it('adds enrichment while visible and leaves the completed company information readable', () => {
  const view = render(() => <CrmEnrichmentDemo />);
  vi.advanceTimersByTime(10000);
  expect(view.queryByText('Design services')).toBeNull();
  setVisible(true);
  vi.advanceTimersByTime(2800);
  expect(view.getByText('Design services')).toBeTruthy();
  setVisible(false);
  vi.advanceTimersByTime(10000);
  expect(view.queryByText('24 employees')).toBeNull();
  setVisible(true);
  vi.advanceTimersByTime(2800);
  expect(view.getByText('24 employees')).toBeTruthy();
  expect(view.getByRole('status').textContent).toBe(
    'Company information added'
  );
  expect(vi.getTimerCount()).toBe(0);
});

it('lets a visitor open the same company from a document and chat without playback taking over', () => {
  const view = render(() => <CrmConnectedWorkDemo />);
  setVisible(true);
  fireEvent.click(view.getByRole('button', { name: 'Customer team' }));
  const record = within(
    view.getByRole('complementary', { name: 'Linked customer record' })
  );
  expect(record.queryByRole('heading', { name: 'The Meadow' })).toBeNull();
  vi.advanceTimersByTime(10000);
  expect(record.queryByRole('heading', { name: 'The Meadow' })).toBeNull();
  fireEvent.click(
    view.getByRole('button', { name: 'Open The Meadow customer record' })
  );
  expect(record.getByRole('heading', { name: 'The Meadow' })).toBeTruthy();
  expect(record.getByText('Dana Whitfield')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Rollout plan' }));
  expect(
    view.getByRole('heading', { name: 'Thursday’s walkthrough' })
  ).toBeTruthy();
  expect(record.getByRole('heading', { name: 'The Meadow' })).toBeTruthy();
  expect(vi.getTimerCount()).toBe(0);
});

it('shows both completed examples immediately for reduced motion', () => {
  reduced = true;
  const enrichment = render(() => <CrmEnrichmentDemo />);
  expect(enrichment.getByText('24 employees')).toBeTruthy();
  const linked = render(() => <CrmConnectedWorkDemo />);
  expect(linked.getByRole('heading', { name: 'The Meadow' })).toBeTruthy();
  expect(vi.getTimerCount()).toBe(0);
});
