import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailAutoTagsDemo } from './EmailAutoTagsDemo';
import { EmailKeyboardDemo } from './EmailKeyboardDemo';

let visible: IntersectionObserverCallback;
let reduced = false;
const disconnect = vi.fn();
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
      disconnect = disconnect;
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

it('tags incoming mail, pauses offscreen and preserves manual tag edits', () => {
  const view = render(() => <EmailAutoTagsDemo />);
  vi.advanceTimersByTime(3000);
  expect(view.getByText('0 / 4 tagged')).toBeTruthy();
  setVisible(true);
  vi.advanceTimersByTime(2800);
  expect(view.getByText('1 / 4 tagged')).toBeTruthy();
  setVisible(false);
  vi.advanceTimersByTime(5000);
  expect(view.getByText('1 / 4 tagged')).toBeTruthy();
  fireEvent.click(
    view.getByRole('button', { name: 'Read Next steps for our team' })
  );
  fireEvent.click(
    view.getByRole('button', { name: 'Edit selected email tags' })
  );
  const menu = within(
    view.getByRole('group', { name: 'Tags for Next steps for our team' })
  );
  fireEvent.click(menu.getByRole('button', { name: 'Customers' }));
  fireEvent.click(menu.getByRole('button', { name: 'Launch' }));
  expect(
    menu.getByRole('button', { name: 'Customers' }).getAttribute('aria-pressed')
  ).toBe('false');
  expect(
    menu.getByRole('button', { name: 'Launch' }).getAttribute('aria-pressed')
  ).toBe('true');
  setVisible(true);
  vi.advanceTimersByTime(20000);
  expect(
    menu.getByRole('button', { name: 'Launch' }).getAttribute('aria-pressed')
  ).toBe('true');
});

it('navigates with J/K, opens threads and archives the selection through the empty state', () => {
  const view = render(() => <EmailKeyboardDemo />);
  const region = view.getByRole('region', {
    name: 'Try email keyboard shortcuts',
  });
  fireEvent.keyDown(region, { key: 'j' });
  expect(
    view
      .getByRole('button', { name: 'Read Launch announcement' })
      .getAttribute('aria-current')
  ).toBe('true');
  fireEvent.keyDown(region, { key: 'Enter' });
  expect(
    view.getByRole('heading', { name: 'Launch announcement' })
  ).toBeTruthy();
  fireEvent.keyDown(region, { key: 'k' });
  expect(
    view.getByRole('heading', { name: 'Next steps for our team' })
  ).toBeTruthy();
  fireEvent.keyDown(region, { key: 'e' });
  expect(
    view.getByRole('heading', { name: 'Launch announcement' })
  ).toBeTruthy();
  fireEvent.keyDown(region, { key: 'Escape' });
  expect(
    view.queryByRole('button', { name: 'Read Next steps for our team' })
  ).toBeNull();
  for (let count = 0; count < 3; count++)
    fireEvent.keyDown(region, { key: 'e' });
  expect(view.getByText('All caught up.')).toBeTruthy();
  fireEvent.keyDown(region, { key: 'j' });
  expect(view.getByText('All caught up.')).toBeTruthy();
});

it('does not capture page-wide, modified or composing keys', () => {
  const view = render(() => <EmailKeyboardDemo />);
  const region = view.getByRole('region', {
    name: 'Try email keyboard shortcuts',
  });
  fireEvent.keyDown(document.body, { key: 'e' });
  fireEvent.keyDown(region, { key: 'e', metaKey: true });
  fireEvent.keyDown(region, { key: 'e', isComposing: true });
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(4);
});

it('finishes keyboard playback and cleans up its timer', () => {
  const view = render(() => <EmailKeyboardDemo />);
  setVisible(true);
  vi.advanceTimersByTime(1400);
  expect(
    view.getByRole('heading', { name: 'Next steps for our team' })
  ).toBeTruthy();
  vi.advanceTimersByTime(7000);
  expect(view.getByText('1 archived')).toBeTruthy();
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(3);
  expect(view.queryByRole('button', { name: /Play|Pause|Replay/ })).toBeNull();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(disconnect).toHaveBeenCalled();
});

it('shows completed tagging without autoplay for reduced motion', () => {
  reduced = true;
  const view = render(() => <EmailAutoTagsDemo />);
  setVisible(true);
  expect(view.getByText('4 / 4 tagged')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Pause tagging demo' })).toBeNull();
  expect(view.getByText('4 / 4 tagged')).toBeTruthy();
});
