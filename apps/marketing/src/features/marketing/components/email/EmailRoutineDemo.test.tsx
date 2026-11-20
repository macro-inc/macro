import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailRoutineDemo } from './EmailRoutineDemo';

let visibility: IntersectionObserverCallback;
let reducedMotion = false;

beforeEach(() => {
  reducedMotion = false;
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
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
  expect(fetch).not.toHaveBeenCalled();
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
const email = 'Read Renewing for the full team';
const notification = 'Important customer email';

it('delivers the email, then the channel message, then the push notification', () => {
  const view = render(() => <EmailRoutineDemo />);
  show();
  expect(view.queryByRole('button', { name: email })).toBeNull();
  vi.advanceTimersByTime(1200);
  expect(view.getByRole('button', { name: email })).toBeTruthy();
  expect(view.queryByText(/New from Austin Barron/)).toBeNull();
  vi.advanceTimersByTime(1500);
  expect(view.getByText(/New from Austin Barron/)).toBeTruthy();
  expect(view.queryByText(notification)).toBeNull();
  vi.advanceTimersByTime(1100);
  expect(view.getByText(notification)).toBeTruthy();
});

it('shows the finished result at once with reduced motion', () => {
  reducedMotion = true;
  const view = render(() => <EmailRoutineDemo />);
  show();
  expect(view.getByRole('button', { name: email })).toBeTruthy();
  expect(view.getByText(/New from Austin Barron/)).toBeTruthy();
  expect(view.getByText(notification)).toBeTruthy();
});

it('lets the visitor reply in the channel and stops the walkthrough', () => {
  const view = render(() => <EmailRoutineDemo />);
  show();
  vi.advanceTimersByTime(1200);
  const input = view.getByRole('textbox', { name: 'Message #customers' });
  fireEvent.pointerDown(input);
  fireEvent.input(input, { target: { value: 'Sending the contract now.' } });
  fireEvent.click(view.getByRole('button', { name: 'Send demo message' }));
  expect(view.getByText('Sending the contract now.')).toBeTruthy();
  vi.advanceTimersByTime(10000);
  expect(view.queryByText(notification)).toBeNull();
});
