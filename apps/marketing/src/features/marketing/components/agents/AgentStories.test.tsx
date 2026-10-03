import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentEmailReviewDemo, AgentTaskResultDemo } from './AgentStories';

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
it('opens an agent-created task in the ordinary editable task view', () => {
  reduced = true;
  const view = render(() => <AgentTaskResultDemo />);
  fireEvent.click(
    view.getByRole('button', { name: 'Review Thursday’s launch checks' })
  );
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Review Thursday’s launch checks'
  );
  expect(
    view.getAllByRole('button', { name: 'Change assignee' })[0]
  ).toBeTruthy();
});

it('keeps the edited agent email as the actual Sent artifact', () => {
  const view = render(() => <AgentEmailReviewDemo />);
  const subject = view.getByRole('textbox', { name: 'Subject' });
  fireEvent.input(subject, { target: { value: 'Thursday at 9 — confirmed' } });
  const body = view.getByRole('textbox', { name: 'Email body' });
  body.innerText = 'Thursday at 9 works for our follow-up. Julia will join us.';
  fireEvent.input(body);
  fireEvent.click(view.getByRole('button', { name: 'Send email' }));
  expect(
    view.getByRole('heading', { name: 'Thursday at 9 — confirmed' })
  ).toBeTruthy();
  expect(
    view.getByText('Thursday at 9 works for our follow-up.', { exact: false })
  ).toBeTruthy();
});

it('keeps a supplied email draft intact for reduced motion', () => {
  reduced = true;
  const view = render(() => <AgentEmailReviewDemo />);
  expect(
    view.getByRole('textbox', { name: 'Email body' }).textContent
  ).toContain('Thursday at 9 works');
  expect(
    view.getByRole('textbox', { name: 'Email body' }).textContent
  ).not.toContain('Macro sales overview');
});
