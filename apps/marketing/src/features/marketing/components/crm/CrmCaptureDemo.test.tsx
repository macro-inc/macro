import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrmCaptureDemo } from './CrmCaptureDemo';

let intersections: IntersectionObserverCallback[];
let reduced = false;
beforeEach(() => {
  intersections = [];
  reduced = false;
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced;
    },
    addEventListener: vi.fn(),
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
const stage = (view: ReturnType<typeof render>) =>
  view.getByRole('button', { name: 'Change Stage' }).textContent;
const owner = (view: ReturnType<typeof render>) =>
  view.getByRole('button', { name: 'Change Owner' }).textContent;

it('lets Claude set the stage and owner, then answer in the Discussion thread', () => {
  const view = render(() => <CrmCaptureDemo />);
  expect(view.getByText(/just got off a call with Dana/)).toBeTruthy();
  expect(stage(view)).toContain('Lead');
  expect(owner(view)).toContain('Empty');
  vi.advanceTimersByTime(10000);
  expect(stage(view)).toContain('Lead');
  visible(true);
  vi.advanceTimersByTime(1900);
  expect(stage(view)).toContain('Demo');
  expect(owner(view)).toContain('Empty');
  visible(false);
  vi.advanceTimersByTime(10000);
  expect(owner(view)).toContain('Empty');
  visible(true);
  vi.advanceTimersByTime(1900);
  expect(owner(view)).toContain('Jacob');
  expect(view.queryByText(/The Meadow is in Demo/)).toBeNull();
  vi.advanceTimersByTime(1900);
  const thread = view.container.querySelector<HTMLElement>(
    '[data-thread-id="capture-request"]'
  );
  expect(
    within(thread!).getByText(/The Meadow is in Demo and you’re the owner/)
  ).toBeTruthy();
  expect(within(thread!).getByText('Agent')).toBeTruthy();
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('stops the walkthrough when a visitor takes over the record', () => {
  const view = render(() => <CrmCaptureDemo />);
  visible(true);
  vi.advanceTimersByTime(900);
  fireEvent.pointerDown(
    view.getByRole('group', {
      name: 'Claude updates The Meadow from a comment in its Discussion',
    })
  );
  vi.advanceTimersByTime(20000);
  expect(stage(view)).toContain('Lead');
  expect(owner(view)).toContain('Empty');
  expect(view.queryByText(/The Meadow is in Demo/)).toBeNull();
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('shows the updated record and the reply at once with reduced motion', () => {
  reduced = true;
  const view = render(() => <CrmCaptureDemo />);
  expect(stage(view)).toContain('Demo');
  expect(owner(view)).toContain('Jacob');
  expect(view.getByText(/The Meadow is in Demo/)).toBeTruthy();
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('posts a visitor’s comment and thread reply in the company Discussion', () => {
  const view = render(() => <CrmCaptureDemo />);
  const comment = view.getByRole('textbox', { name: 'Comment on company' });
  expect(comment.getAttribute('placeholder')).toBe('Leave a comment...');
  fireEvent.input(comment, { target: { value: 'Dana confirmed 12 seats.' } });
  fireEvent.keyDown(comment, { key: 'Enter' });
  expect(view.getByText('Dana confirmed 12 seats.')).toBeTruthy();
  const thread = view.container.querySelector<HTMLElement>(
    '[data-thread-id="capture-request"]'
  );
  fireEvent.click(within(thread!).getByRole('button', { name: 'Reply' }));
  const reply = view.getByRole('textbox', { name: 'Thread reply' });
  expect(reply.getAttribute('placeholder')).toBe('Send a reply');
  fireEvent.input(reply, { target: { value: 'On it.' } });
  fireEvent.keyDown(reply, { key: 'Enter' });
  expect(within(thread!).getByText('On it.')).toBeTruthy();
});
