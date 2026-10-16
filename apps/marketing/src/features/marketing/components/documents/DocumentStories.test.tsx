import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentOrganizationDemo } from './DocumentOrganizationDemo';
import { DocumentProjectDemo } from './DocumentProjectDemo';
import {
  DocumentAgentDemo,
  DocumentMentionsDemo,
  DocumentOfflineDemo,
} from './DocumentStories';

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
const body = (view: ReturnType<typeof render>) =>
  view.getByRole('textbox', { name: 'Document body' });

it('reads the sources before editing and keeps both collaborators in one paragraph', () => {
  const view = render(() => <DocumentAgentDemo />);
  const hit = view.container.querySelector('[data-search-hit="email"]');
  expect(view.queryByRole('textbox', { name: 'Message Macro' })).toBeNull();
  visible(true);
  vi.advanceTimersByTime(2600);
  expect(body(view).textContent).toContain('Add annual plans later');
  expect(view.getByText('Read thread')).toBeTruthy();
  vi.advanceTimersByTime(4200);
  expect(body(view).textContent).not.toContain('Add annual plans later');
  const agent = body(view).querySelector('[data-caret="claude"]');
  const human = body(view).querySelector('[data-caret="jacob"]');
  expect(agent).toBeTruthy();
  expect(human).toBeTruthy();
  expect(agent?.parentElement).toBe(human?.parentElement);
  expect(view.container.querySelector('[data-search-hit="email"]')).toBe(hit);
  vi.advanceTimersByTime(20000);
  expect(body(view).textContent).toContain('Annual plans get two months free');
  expect(body(view).textContent).toContain(
    'Link to the billing FAQ below the table.'
  );
  expect(view.getByRole('button', { name: 'Called 4 tools' })).toBeTruthy();
});

it('lets a visitor inspect the agent source and stops automatic changes', () => {
  const view = render(() => <DocumentAgentDemo />);
  visible(true);
  const hit = view.getByRole('button', {
    name: /Pricing changes.*Annual gets/,
  });
  hit.focus();
  fireEvent.pointerDown(hit);
  fireEvent.click(hit);
  expect(view.getByRole('region', { name: 'Linked source' })).toBeTruthy();
  vi.advanceTimersByTime(20000);
  fireEvent.click(view.getByRole('button', { name: 'Close split' }));
  expect(body(view).textContent).toContain('Add annual plans later');
  expect(document.activeElement).toBe(hit);
});

it('never replaces visitor edits after manual takeover or a motion change', () => {
  const view = render(() => <DocumentAgentDemo />);
  visible(true);
  const editor = body(view);
  fireEvent.pointerDown(editor);
  editor.innerHTML = '<p>Keep this draft.</p>';
  reduce();
  vi.advanceTimersByTime(30000);
  expect(editor.textContent).toBe('Keep this draft.');
});

it('shows the completed agent edit without animation for reduced motion', () => {
  reduced = true;
  const view = render(() => <DocumentAgentDemo />);
  expect(body(view).textContent).toContain('Annual plans get two months free');
  expect(body(view).textContent).toContain(
    'Link to the billing FAQ below the table.'
  );
  expect(view.queryByRole('textbox', { name: 'Message Macro' })).toBeNull();
});

it('merges an offline edit with the teammate edit on reconnect', () => {
  const view = render(() => <DocumentOfflineDemo />);
  expect(view.getByRole('status', { name: 'Offline' })).toBeTruthy();
  visible(true);
  vi.advanceTimersByTime(5100);
  expect(body(view).textContent).toContain('Add a screenshot of the new page.');
  expect(body(view).textContent).not.toContain('Julia has the email ready');
  vi.advanceTimersByTime(800);
  expect(view.getByRole('status', { name: 'Reconnecting' })).toBeTruthy();
  vi.advanceTimersByTime(10000);
  expect(view.queryByRole('status')).toBeNull();
  expect(body(view).textContent).toContain(
    'Julia has the email ready. Send it tomorrow. Add a screenshot'
  );
});

it('keeps the same edited document when opening it through a tag', () => {
  const view = render(() => <DocumentOrganizationDemo />);
  fireEvent.click(view.getByRole('button', { name: /Website brief/ }));
  const editor = body(view);
  editor.append(document.createTextNode(' Keep the free plan.'));
  fireEvent.click(view.getByRole('button', { name: 'Launch' }));
  expect(view.getByRole('button', { name: /Pricing changes/ })).toBeTruthy();
  expect(
    view.getByRole('button', { name: /Update pricing page/ })
  ).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: /Website brief/ }));
  expect(body(view)).toBe(editor);
  expect(editor.textContent).toContain('Keep the free plan.');
  vi.advanceTimersByTime(20000);
  expect(body(view)).toBe(editor);
});

it('filters the folder and navigates a nested folder', () => {
  const view = render(() => <DocumentOrganizationDemo />);
  fireEvent.input(
    view.getByRole('searchbox', { name: 'Search this collection' }),
    { target: { value: 'writing' } }
  );
  expect(view.getByRole('button', { name: /Writing guidelines/ })).toBeTruthy();
  expect(view.queryByRole('button', { name: /Website brief/ })).toBeNull();
  fireEvent.input(
    view.getByRole('searchbox', { name: 'Search this collection' }),
    { target: { value: '' } }
  );
  fireEvent.click(view.getByRole('button', { name: /Images/ }));
  expect(
    view.getByRole('button', { name: /Screenshot checklist/ })
  ).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Back to Website folder' }));
  expect(view.getByRole('button', { name: /Website brief/ })).toBeTruthy();
});

it('opens sources beside the doc and restores focus without losing edits', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  const view = render(() => <DocumentProjectDemo />);
  const editor = body(view);
  fireEvent.pointerDown(editor);
  editor.append(document.createTextNode(' Keep this sentence.'));
  const email = view.getByRole('button', { name: 'Pricing changes' });
  email.focus();
  fireEvent.click(email);
  const source = within(view.getByRole('region', { name: 'Linked source' }));
  expect(source.getByText(/People keep asking/)).toBeTruthy();
  expect(
    view.container.querySelector('.doc-source-original')?.hasAttribute('inert')
  ).toBe(false);
  const close = source.getByRole('button', { name: 'Close split' });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: 'Escape' });
  expect(view.queryByRole('region', { name: 'Linked source' })).toBeNull();
  expect(document.activeElement).toBe(email);
  expect(body(view)).toBe(editor);
  expect(editor.textContent).toContain('Keep this sentence.');
});

it('keeps email and task splits open together without remounting the doc', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1232);
  const view = render(() => <DocumentMentionsDemo />);
  const editor = body(view);
  editor.append(document.createTextNode(' Keep this edit.'));
  fireEvent.click(
    within(editor).getByRole('button', { name: 'Pricing changes' })
  );
  const email = view.getByRole('region', { name: 'Linked email' });
  fireEvent.click(
    within(editor).getByRole('button', { name: /Update pricing page/ })
  );
  expect(view.getByRole('region', { name: 'Linked email' })).toBe(email);
  expect(
    within(view.getByRole('region', { name: 'Linked task' })).getByText(
      'Check the page on mobile'
    )
  ).toBeTruthy();
  expect(body(view)).toBe(editor);
  fireEvent.click(view.getByRole('button', { name: 'Close task split' }));
  expect(view.getByRole('region', { name: 'Linked email' })).toBe(email);
  fireEvent.click(view.getByRole('button', { name: 'Close email split' }));
  expect(body(view).textContent).toContain('Keep this edit.');
  fireEvent.click(within(editor).getByRole('button', { name: 'website' }));
  expect(
    within(view.getByRole('region', { name: 'Linked channel' })).getByText(
      'got it, i’ll take the pricing page'
    )
  ).toBeTruthy();
});

it('keeps source playback stopped after closing a split', () => {
  const view = render(() => <DocumentMentionsDemo />);
  visible(true);
  vi.advanceTimersByTime(2600);
  expect(view.getByRole('region', { name: 'Linked email' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Close email split' }));
  vi.advanceTimersByTime(20000);
  expect(view.queryByRole('region', { name: 'Linked email' })).toBeNull();
  expect(view.queryByRole('region', { name: 'Linked task' })).toBeNull();
});

it('compacts completed tool calls and lets the visitor reopen them', () => {
  const view = render(() => <DocumentAgentDemo />);
  visible(true);
  vi.advanceTimersByTime(20000);
  const toggle = view.getByRole('button', { name: 'Called 4 tools' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(view.getByRole('region', { name: 'Tool calls' })).toBeTruthy();
});

it('keeps the document share controls interactive', () => {
  const view = render(() => <DocumentProjectDemo />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  const dialog = within(view.getByRole('dialog'));
  fireEvent.input(dialog.getByLabelText('Email or group'), {
    target: { value: 'teo' },
  });
  fireEvent.change(dialog.getByLabelText('Permission'), {
    target: { value: 'comment' },
  });
  fireEvent.click(dialog.getByRole('button', { name: /Share/ }));
  expect(
    (view.getByLabelText('Access for Teo') as HTMLSelectElement).value
  ).toBe('comment');
  fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(view.queryByRole('dialog')).toBeNull();
});
