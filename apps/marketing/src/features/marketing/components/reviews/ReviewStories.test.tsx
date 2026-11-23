import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  GithubConversationDemo,
  GithubPrHero,
  GithubTaskDemo,
} from './GithubWorkflow';

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
  vi.stubGlobal('scrollTo', vi.fn());
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

const REQUEST = 'Fix mobile sign-in #491';

it('changes files and closes the hero changes pane', () => {
  const view = render(() => <GithubPrHero />);
  fireEvent.click(view.getByRole('button', { name: /SignIn.test.tsx/ }));
  expect(
    view.getByLabelText('Changes to src/auth/SignIn.test.tsx').shadowRoot
      ?.textContent
  ).toContain('signs in at');
  fireEvent.click(view.getByRole('button', { name: 'Close the changes pane' }));
  expect(
    view.queryByRole('region', { name: 'Pull request changes' })
  ).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Changes' }));
  expect(
    view.getByRole('region', { name: 'Pull request changes' })
  ).toBeTruthy();
});

it('syncs the task after a confirmed merge and does not change its checklist', () => {
  const view = render(() => <GithubTaskDemo />);
  visible(true);
  vi.advanceTimersByTime(1800);
  expect(
    view.getAllByRole('button', { name: 'Change status' })[0].textContent
  ).toContain('In Review');
  fireEvent.click(view.getByRole('link', { name: REQUEST }));
  fireEvent.click(view.getByRole('button', { name: 'Merge' }));
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  expect(
    view.getAllByRole('button', { name: 'Change status' })[0].textContent
  ).toContain('In Review');
  fireEvent.click(view.getByRole('button', { name: 'Merge' }));
  fireEvent.click(view.getByRole('button', { name: 'Merge pull request' }));
  expect(
    view.getAllByRole('button', { name: 'Change status' })[0].textContent
  ).toContain('Completed');
  expect(
    view
      .getAllByRole('checkbox')
      .filter(
        (el) =>
          el.getAttribute('aria-checked') === 'true' ||
          (el as HTMLInputElement).checked
      )
  ).toHaveLength(2);
  vi.advanceTimersByTime(30000);
  expect(
    view.getByRole('heading', { name: 'Fix mobile sign-in' })
  ).toBeTruthy();
});

it('shows one coding-agent response with an openable session and PR', async () => {
  const view = render(() => <GithubConversationDemo agent />);
  visible(true);
  vi.advanceTimersByTime(10000);
  await Promise.resolve();
  expect(
    view.container.querySelectorAll('[data-magic-chip="mobile-sign-in"]')
  ).toHaveLength(1);
  expect(view.getByText('#491 · Fix mobile sign-in')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Open session' }));
  expect(view.getByText('Cursor · Fix mobile sign-in')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Changes' }));
  expect(
    view.getByRole('region', { name: 'Pull request changes' })
  ).toBeTruthy();
});

it('uses completed local states for reduced motion', () => {
  reduced = true;
  const view = render(() => <GithubTaskDemo />);
  expect(
    view.getAllByRole('button', { name: 'Change status' })[0].textContent
  ).toContain('Completed');
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('keeps Julia’s request and one completed Cursor PR response in the original bug thread', () => {
  const view = render(() => <GithubConversationDemo agent />);
  const thread = view.container.querySelector<HTMLElement>(
    '[data-thread-id="bug"]'
  )!;
  expect(
    within(thread).getByText(
      'sign-in button does nothing on my phone. desktop is fine'
    )
  ).toBeTruthy();
  expect(within(thread).getByText(/can you fix this/)).toBeTruthy();
  expect(view.container.querySelector('[data-thread-id="request"]')).toBeNull();
  visible(true);
  vi.advanceTimersByTime(1400);
  expect(thread.querySelectorAll('[data-agent="cursor"]')).toHaveLength(0);
  expect(within(thread).queryByText('#491 · Fix mobile sign-in')).toBeNull();
  vi.advanceTimersByTime(2800);
  expect(within(thread).getByText('#491 · Fix mobile sign-in')).toBeTruthy();
  expect(thread.querySelectorAll('[data-agent="cursor"]')).toHaveLength(1);
  expect(within(thread).queryByText(/more replies/)).toBeNull();
  vi.advanceTimersByTime(9900);
  expect(within(thread).queryByText('#491 · Fix mobile sign-in')).toBeNull();
  expect(within(thread).getByText(/can you fix this/)).toBeTruthy();
});
