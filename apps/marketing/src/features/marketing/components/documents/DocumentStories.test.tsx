import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DocumentAgentDemo,
  DocumentMentionsDemo,
  DocumentOfflineDemo,
  DocumentSharingDemo,
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

it('rewrites the intro and types the checklist while Jacob keeps writing', () => {
  const view = render(() => <DocumentAgentDemo />);
  expect(body(view).textContent).toContain('We’re introducing the team');
  visible(true);
  vi.advanceTimersByTime(2000);
  expect(body(view).textContent).not.toContain('We’re introducing the team');
  expect(body(view).textContent).toContain('Thursday we launch');
  expect(body(view).textContent).toContain('Dana’s team');
  vi.advanceTimersByTime(30000);
  expect(body(view).textContent).toContain('Jacob: confirm the launch checks.');
  expect(body(view).textContent).toContain(
    'Dana’s team gets a heads-up the night before.'
  );
  expect(vi.getTimerCount()).toBe(0);
});

it('leaves the document editable and never replaces the visitor’s text', () => {
  const view = render(() => <DocumentAgentDemo />);
  visible(true);
  const editor = body(view);
  fireEvent.pointerDown(editor);
  editor.innerHTML = '<p>Our team’s revised launch plan.</p>';
  fireEvent.blur(editor);
  reduce();
  vi.advanceTimersByTime(30000);
  expect(editor.textContent).toContain('Our team’s revised launch plan.');
  expect(editor.textContent).not.toContain('Teo: verify');
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('shows the finished document for reduced motion', () => {
  reduced = true;
  const view = render(() => <DocumentAgentDemo />);
  expect(body(view).textContent).toContain('Teo: verify the invite flow.');
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
  vi.advanceTimersByTime(100);
  expect(vi.getTimerCount()).toBe(0);
});

it('goes from offline to reconnecting to synced, with Julia’s edit merged', () => {
  const view = render(() => <DocumentOfflineDemo />);
  expect(view.getByRole('status', { name: 'Offline' })).toBeTruthy();
  expect(
    view.getByText("You're offline. Changes will sync when you reconnect.")
  ).toBeTruthy();
  visible(true);
  vi.advanceTimersByTime(3800);
  expect(body(view).textContent).toContain(
    'Pricing doesn’t change for existing teams.'
  );
  expect(body(view).textContent).not.toContain('Send it Thursday at 9.');
  vi.advanceTimersByTime(300);
  expect(view.getByRole('status', { name: 'Reconnecting' })).toBeTruthy();
  vi.advanceTimersByTime(30000);
  expect(view.queryByRole('status')).toBeNull();
  expect(body(view).textContent).toContain(
    'Send it Thursday at 9. Lead with the shared inbox. Pricing doesn’t change for existing teams.'
  );
  expect(vi.getTimerCount()).toBe(0);
});

it('shows the merged, synced document for reduced motion', () => {
  reduced = true;
  const view = render(() => <DocumentOfflineDemo />);
  expect(view.queryByRole('status')).toBeNull();
  expect(body(view).textContent).toContain('Send it Thursday at 9.');
  expect(body(view).textContent).toContain('existing teams.');
});

it('opens the mention menu and inserts a task, company, email, and channel', () => {
  const view = render(() => <DocumentMentionsDemo />);
  visible(true);
  vi.advanceTimersByTime(1100);
  // The scripted menu is decorative, so it sits in the aria-hidden overlay.
  const menu = within(
    view.getByRole('listbox', { name: 'Mentions', hidden: true })
  );
  expect(menu.getByText('People & Groups')).toBeTruthy();
  vi.advanceTimersByTime(900);
  expect(menu.getByText('Documents, Agents, & Tasks')).toBeTruthy();
  expect(
    menu.getByRole('option', { selected: true, hidden: true }).textContent
  ).toContain('Fix the team invite handoff');
  vi.advanceTimersByTime(30000);
  expect(view.queryByRole('listbox', { hidden: true })).toBeNull();
  const kinds = [
    ...body(view).querySelectorAll<HTMLElement>('[data-doc-mention]'),
  ].map((mention) => `${mention.dataset.docMention}:${mention.textContent}`);
  expect(kinds).toEqual(
    expect.arrayContaining([
      'task:Fix the team invite handoff',
      'company:The Meadow',
      'email:Team invites for The Meadow',
      'channel:launch',
    ])
  );
  expect(view.getByText('References (2)')).toBeTruthy();
  expect(vi.getTimerCount()).toBe(0);
});

it('shows every mention without the menu for reduced motion', () => {
  reduced = true;
  const view = render(() => <DocumentMentionsDemo />);
  expect(view.queryByRole('listbox', { hidden: true })).toBeNull();
  expect(body(view).textContent).toContain('when it ships.');
  expect(body(view).querySelectorAll('[data-doc-mention]').length).toBe(5);
});

it('opens the doc from #launch and shows the channel already has access', () => {
  const view = render(() => <DocumentSharingDemo />);
  expect(view.getByRole('log', { name: 'Channel launch' })).toBeTruthy();
  visible(true);
  vi.advanceTimersByTime(30000);
  const access = within(
    view.getByRole('region', { name: 'People with access' })
  );
  expect(access.getByText('Julia, Teo, Gabriel +1 other')).toBeTruthy();
  expect(
    (
      access.getByLabelText(
        'Access for Julia, Teo, Gabriel +1 other'
      ) as HTMLSelectElement
    ).value
  ).toBe('view');
  expect(view.getByText('Link sharing off')).toBeTruthy();
  expect(vi.getTimerCount()).toBe(0);
});

it('shares the doc with a person and keeps the access after closing', () => {
  const view = render(() => <DocumentSharingDemo />);
  fireEvent.click(
    view.container.querySelector('[data-demo-mention="plan"]') as HTMLElement
  );
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  const dialog = within(view.getByRole('dialog'));
  fireEvent.input(dialog.getByLabelText('Email or group'), {
    target: { value: 'teo' },
  });
  fireEvent.change(dialog.getByLabelText('Permission'), {
    target: { value: 'comment' },
  });
  fireEvent.click(dialog.getByRole('button', { name: /Share/ }));
  const people = () =>
    within(view.getByRole('region', { name: 'People with access' }));
  expect(people().getByText('Teo')).toBeTruthy();
  expect(
    (people().getByLabelText('Access for Teo') as HTMLSelectElement).value
  ).toBe('comment');
  fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(view.queryByRole('dialog')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  expect(
    (people().getByLabelText('Access for Teo') as HTMLSelectElement).value
  ).toBe('comment');
});
