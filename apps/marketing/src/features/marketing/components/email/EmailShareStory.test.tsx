import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { meetingReply } from '../../core/email-demo-story';
import { EmailShareStory } from './EmailShareStory';

let visibility: IntersectionObserverCallback;
let reduced = false;
beforeEach(() => {
  reduced = false;
  vi.useFakeTimers();
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
it('shares only after choosing a channel and keeps manual control', () => {
  const view = render(() => <EmailShareStory />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  const submit = view.getByRole('button', { name: 'Share to channel' });
  expect(submit.hasAttribute('disabled')).toBe(true);
  fireEvent.click(view.getByRole('button', { name: 'launch' }));
  expect(submit.hasAttribute('disabled')).toBe(false);
  fireEvent.click(submit);
  fireEvent.click(view.getByRole('button', { name: 'Show a new reply' }));
  expect(view.getByText(meetingReply)).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: '1 Email' }));
  visibility(
    [
      {
        isIntersecting: true,
        intersectionRatio: 1,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver
  );
  vi.advanceTimersByTime(30000);
  expect(view.getByRole('button', { name: 'Share' })).toBeTruthy();
});
it('plays email then share then chat once and leaves the new reply visible', () => {
  const view = render(() => <EmailShareStory />);
  const root = view.container.querySelector('.email-share-story')!;
  vi.advanceTimersByTime(10000);
  expect(root.getAttribute('data-stage')).toBe('0');
  visibility(
    [
      {
        isIntersecting: true,
        intersectionRatio: 1,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver
  );
  vi.advanceTimersByTime(1800);
  expect(root.getAttribute('data-stage')).toBe('1');
  vi.advanceTimersByTime(5000);
  expect(root.getAttribute('data-stage')).toBe('2');
  expect(view.getByText(meetingReply)).toBeTruthy();
  vi.advanceTimersByTime(30000);
  expect(view.getByText(meetingReply)).toBeTruthy();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it('shows the complete result immediately with reduced motion', () => {
  reduced = true;
  const view = render(() => <EmailShareStory />);
  expect(view.getByText(meetingReply)).toBeTruthy();
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});
