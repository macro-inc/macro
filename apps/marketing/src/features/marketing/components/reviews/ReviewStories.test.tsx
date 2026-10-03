import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GithubHomeHero, PrLinkDemo, ReviewInboxDemo } from './ReviewStories';

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

const REQUEST = 'Keep the invited team through sign-up #482';
const home = (view: ReturnType<typeof render>) =>
  within(view.getByRole('complementary', { name: 'Home' }));

it('delivers a review request to Home, opens the pull request, then marks it done', () => {
  const view = render(() => <ReviewInboxDemo />);
  expect(home(view).queryByRole('button', { name: REQUEST })).toBeNull();
  visible(true);
  vi.advanceTimersByTime(900);
  const request = home(view).getByRole('button', { name: REQUEST });
  expect(within(request).getByRole('img', { name: 'Unread' })).toBeTruthy();
  expect(home(view).getByText('Last few minutes')).toBeTruthy();
  vi.advanceTimersByTime(2000);
  expect(
    view.getByRole('heading', { name: 'Keep the invited team through sign-up' })
  ).toBeTruthy();
  expect(view.getByText('launch-team/web#482')).toBeTruthy();
  expect(view.getByText('src/invite/accept-invite.ts:42')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Open on GitHub' })).toBeTruthy();
  expect(within(request).queryByRole('img', { name: 'Unread' })).toBeNull();
  vi.advanceTimersByTime(2600);
  expect(home(view).queryByRole('button', { name: REQUEST })).toBeNull();
  expect(view.getByRole('status').textContent).toContain('Marked as done');
  expect(
    home(view)
      .getByRole('button', { name: 'engineers' })
      .getAttribute('aria-current')
  ).toBe('page');
  fireEvent.click(view.getByRole('button', { name: 'Undo' }));
  expect(home(view).getByRole('button', { name: REQUEST })).toBeTruthy();
  vi.advanceTimersByTime(30000);
  expect(vi.getTimerCount()).toBe(0);
});

it('shows the review request open, without a cursor, for reduced motion', () => {
  reduced = true;
  const view = render(() => <ReviewInboxDemo />);
  expect(
    home(view)
      .getByRole('button', { name: REQUEST })
      .getAttribute('aria-current')
  ).toBe('page');
  expect(view.getByText('src/invite/accept-invite.ts:42')).toBeTruthy();
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('lets a visitor open Home items, filter bots, and press E to mark a PR done', () => {
  const view = render(() => <GithubHomeHero />);
  expect(
    view.getByRole('heading', { name: 'Keep the invited team through sign-up' })
  ).toBeTruthy();
  fireEvent.click(view.getByRole('switch', { name: 'Hide bots (1)' }));
  expect(view.queryByText(/Bugbot reviewed/)).toBeNull();
  expect(view.getByText(/Expired invites go to the error page/)).toBeTruthy();
  fireEvent.click(
    home(view).getByRole('button', {
      name: 'Shorten the onboarding checklist #479',
    })
  );
  expect(
    view.getByRole('heading', { name: 'Shorten the onboarding checklist' })
  ).toBeTruthy();
  expect(view.getByText('Merged')).toBeTruthy();
  fireEvent.keyDown(
    view.getByRole('heading', { name: 'Shorten the onboarding checklist' }),
    { key: 'e' }
  );
  expect(
    home(view).queryByRole('button', {
      name: 'Shorten the onboarding checklist #479',
    })
  ).toBeNull();
  expect(view.getByRole('status').textContent).toContain('Marked as done');
  expect(
    home(view)
      .getByRole('button', { name: 'Next steps for our team' })
      .getAttribute('aria-current')
  ).toBe('page');
});

/** jsdom has no layout; give the overlays a box to measure. */
function layout() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 40,
    y: 120,
    left: 40,
    top: 120,
    right: 340,
    bottom: 144,
    width: 300,
    height: 24,
    toJSON: () => ({}),
  });
}

it('previews a pull request link on hover and follows it to merged', () => {
  layout();
  const view = render(() => <PrLinkDemo />);
  const link = view.getByRole('link', { name: REQUEST });
  expect(link.getAttribute('data-status')).toBe('open');
  expect(view.queryByRole('dialog')).toBeNull();
  visible(true);
  vi.advanceTimersByTime(2250);
  const card = view.getByRole('dialog', {
    name: 'Preview of launch-team/web#482',
  });
  expect(card.textContent).toContain('open');
  expect(card.textContent).toContain('+38');
  expect(card.textContent).toContain('12 passed');
  expect(view.container.querySelector('.demo-cursor')).toBeTruthy();
  vi.advanceTimersByTime(2200);
  expect(link.getAttribute('data-status')).toBe('merged');
  expect(card.textContent).toContain('merged');
  fireEvent.click(link);
  expect(
    view.getByRole('heading', { name: 'Keep the invited team through sign-up' })
  ).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: '#launch' }));
  expect(view.getByRole('log', { name: 'Channel launch' })).toBeTruthy();
});

it('opens the preview for a visitor who hovers the link', () => {
  layout();
  const view = render(() => <PrLinkDemo />);
  const link = view.getByRole('link', { name: REQUEST });
  fireEvent.mouseEnter(link);
  vi.advanceTimersByTime(50);
  expect(
    view.getByRole('dialog', { name: 'Preview of launch-team/web#482' })
  ).toBeTruthy();
  fireEvent.mouseLeave(link);
  expect(view.queryByRole('dialog', { hidden: true })).toBeNull();
  visible(true);
  vi.advanceTimersByTime(30000);
  expect(link.getAttribute('data-status')).toBe('open');
});
