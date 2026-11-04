import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DemoInteractionBoundary } from '../DemoInteractionBoundary';
import { EmailAccountsDemo } from './EmailAccountsDemo';
import { EmailAgenticEditingDemo } from './EmailAgenticEditingDemo';
import { EmailKeyboardDemo } from './EmailKeyboardDemo';

let visible: IntersectionObserverCallback;
let reduced = false;
const disconnect = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
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
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: HTMLElement) {
        if (
          target.matches(
            '.email-accounts-demo, .email-keyboard-demo, .email-editing-stage'
          )
        )
          visible = this.callback;
      }
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

it('adds a sample account, filters inboxes, and preserves a manual selection', () => {
  const view = render(() => <EmailAccountsDemo />);
  const accounts = within(view.getByRole('navigation', { name: 'Inboxes' }));
  expect(
    accounts.queryByRole('button', { name: 'jacob@gmail.com' })
  ).toBeNull();
  fireEvent.click(
    view.getByRole('button', { name: 'Connect another account' })
  );
  expect(
    accounts
      .getByRole('button', { name: 'All inboxes' })
      .getAttribute('aria-current')
  ).toBe('true');
  fireEvent.click(accounts.getByRole('button', { name: 'jacob@gmail.com' }));
  expect(
    view.getByRole('button', { name: 'Read Your table is confirmed' })
  ).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Read Thursday demo' })).toBeNull();
  setVisible(true);
  vi.advanceTimersByTime(20000);
  expect(
    accounts
      .getByRole('button', { name: 'jacob@gmail.com' })
      .getAttribute('aria-current')
  ).toBe('true');
  fireEvent.click(accounts.getByRole('button', { name: 'All inboxes' }));
  fireEvent.input(view.getByLabelText('Search across inboxes'), {
    target: { value: 'Thursday demo' },
  });
  fireEvent.click(view.getByRole('button', { name: 'Read Thursday demo' }));
  expect(view.getByText(/Thursday at 9 works for me/)).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Back to inbox' }));
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(1);
});

it('connects one inbox per click, then switches to an individual inbox and back', () => {
  const view = render(() => <EmailAccountsDemo />);
  const accounts = within(view.getByRole('navigation', { name: 'Inboxes' }));
  vi.advanceTimersByTime(20000);
  expect(
    accounts.queryByRole('button', { name: 'jacob@gmail.com' })
  ).toBeNull();
  setVisible(true);
  advanceTo(
    () =>
      view.container
        .querySelector('.email-accounts-demo')
        ?.getAttribute('data-step') === '2'
  );
  expect(
    view.container
      .querySelector('.email-accounts-demo')
      ?.getAttribute('data-step')
  ).toBe('2');
  expect(view.getByRole('status').textContent).toBe('Account connected');
  expect(
    accounts.getByRole('button', { name: 'jacob@gmail.com' })
  ).toBeTruthy();
  expect(
    accounts.queryByRole('button', { name: 'jacob@outlook.com' })
  ).toBeNull();
  setVisible(false);
  vi.advanceTimersByTime(20000);
  expect(view.getByRole('status')).toBeTruthy();
  setVisible(true);
  advanceTo(
    () =>
      view.container
        .querySelector('.email-accounts-demo')
        ?.getAttribute('data-step') === '4'
  );
  expect(
    accounts.getByRole('button', { name: 'jacob@outlook.com' })
  ).toBeTruthy();
  advanceTo(
    () =>
      accounts
        .getByRole('button', { name: 'jacob@gmail.com' })
        .getAttribute('aria-current') === 'true'
  );
  advanceTo(
    () =>
      view.container
        .querySelector('.email-accounts-demo')
        ?.getAttribute('data-step') === '7'
  );
  expect(
    accounts
      .getByRole('button', { name: 'All inboxes' })
      .getAttribute('aria-current')
  ).toBe('true');
  expect(
    accounts.getByRole('button', { name: 'jacob@outlook.com' })
  ).toBeTruthy();
  expect(vi.getTimerCount()).toBeGreaterThan(0);
});

it('navigates with J/K, opens threads and archives the selection through the empty state', () => {
  const view = render(() => <EmailKeyboardDemo />);
  const region = view.getByRole('region', {
    name: 'Try email keyboard shortcuts',
  });
  fireEvent.keyDown(region, { key: 'j' });
  expect(
    view
      .getByRole('button', { name: 'Read Quick review' })
      .getAttribute('aria-current')
  ).toBe('true');
  fireEvent.keyDown(region, { key: 'Enter' });
  expect(view.getByRole('heading', { name: 'Quick review' })).toBeTruthy();
  fireEvent.keyDown(region, { key: 'k' });
  expect(view.getByRole('heading', { name: 'Thursday demo' })).toBeTruthy();
  fireEvent.keyDown(region, { key: 'e' });
  expect(view.getByRole('heading', { name: 'Quick review' })).toBeTruthy();
  fireEvent.keyDown(region, { key: 'Escape' });
  expect(view.queryByRole('button', { name: 'Read Thursday demo' })).toBeNull();
  for (let count = 0; count < 13; count++)
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
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(14);
});

it('finishes keyboard playback and cleans up its timer', () => {
  const view = render(() => <EmailKeyboardDemo />);
  setVisible(true);
  vi.advanceTimersByTime(1400);
  expect(
    view
      .getByRole('button', { name: 'Read Quick review' })
      .getAttribute('aria-current')
  ).toBe('true');
  vi.advanceTimersByTime(7000);
  expect(view.queryByText('1 archived')).toBeNull();
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(13);
  expect(view.queryByRole('button', { name: /Play|Pause|Replay/ })).toBeNull();
  view.unmount();
  vi.advanceTimersByTime(20);
  expect(vi.getTimerCount()).toBe(0);
  expect(disconnect).toHaveBeenCalled();
});

it('shows all inboxes without autoplay for reduced motion', () => {
  reduced = true;
  const view = render(() => <EmailAccountsDemo />);
  setVisible(true);
  expect(view.getByRole('button', { name: 'jacob@gmail.com' })).toBeTruthy();
  vi.advanceTimersByTime(20);
  expect(vi.getTimerCount()).toBe(0);
});

it('shows the source context before the editable draft and preserves edits', () => {
  const view = render(() => <EmailAgenticEditingDemo />);
  expect(view.queryByRole('textbox', { name: 'Email body' })).toBeNull();
  setVisible(true);
  vi.advanceTimersByTime(2100);
  const input = view.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Message the email agent',
  });
  expect(input.value).toBe('Draft ');
  expect(view.queryByRole('link', { name: 'Demo call' })).toBeNull();
  advanceTo(() => view.queryByRole('link', { name: 'Demo call' }));
  expect(view.getByRole('link', { name: 'Demo call' })).toBeTruthy();
  expect(view.queryByRole('textbox', { name: 'Email body' })).toBeNull();
  vi.advanceTimersByTime(2200);
  expect(
    view.getByRole<HTMLInputElement>('textbox', { name: 'To' }).value
  ).toBe('Valentina <valentina@coparse.com>');
  expect(
    view.getByRole<HTMLInputElement>('textbox', { name: 'Cc' }).value
  ).toBe('Julia <julia@macro.com>');
  const body = view.getByRole('textbox', { name: 'Email body' });
  expect(body.getAttribute('contenteditable')).toBe('true');
  expect(body.textContent).toContain('Thursday at 9');
  fireEvent.pointerDown(view.getByLabelText('Subject'));
  fireEvent.input(view.getByLabelText('Subject'), {
    target: { value: 'Thursday meeting details' },
  });
  setVisible(false);
  setVisible(true);
  vi.advanceTimersByTime(20000);
  expect(
    view.getByRole<HTMLInputElement>('textbox', { name: 'Subject' }).value
  ).toBe('Thursday meeting details');
});

it('lets the visitor type and send their own request without waiting for autoplay', () => {
  const view = render(() => <EmailAgenticEditingDemo />);
  fireEvent.input(
    view.getByRole('textbox', { name: 'Message the email agent' }),
    { target: { value: 'Draft a follow-up for Thursday.' } }
  );
  fireEvent.click(view.getByRole('button', { name: 'Send demo message' }));
  expect(view.getByRole('textbox', { name: 'Email body' })).toBeTruthy();
  expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
});

it('stops the walkthrough when the visitor enters the demo', () => {
  const view = render(() => (
    <DemoInteractionBoundary>
      <EmailAccountsDemo />
    </DemoInteractionBoundary>
  ));
  setVisible(true);
  fireEvent.click(
    view.getByRole('button', {
      name: 'Interact with demo. Press Escape to return to page scrolling.',
    })
  );
  vi.advanceTimersByTime(20000);
  expect(
    view.container
      .querySelector('.email-accounts-demo')
      ?.getAttribute('data-step')
  ).toBe('0');
  expect(
    view.getByRole('button', { name: 'Connect another account' })
  ).toBeTruthy();
});

it('shows an editable draft immediately with reduced motion', () => {
  reduced = true;
  const view = render(() => <EmailAgenticEditingDemo />);
  setVisible(true);
  expect(
    view.getByRole('textbox', { name: 'Email body' }).textContent
  ).toContain('Thursday at 9 works');
  expect(
    view
      .getByRole('textbox', { name: 'Email body' })
      .getAttribute('contenteditable')
  ).toBe('true');
  vi.advanceTimersByTime(20);
  expect(vi.getTimerCount()).toBe(0);
});

function advanceTo(reached: () => unknown) {
  for (let elapsed = 0; elapsed < 30000 && !reached(); elapsed += 50)
    vi.advanceTimersByTime(50);
  expect(!!reached()).toBe(true);
}

it('keeps one operating pointer through account connection and removes it on takeover', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.matches('.email-accounts-mobile')) return new DOMRect();
      if (this.matches('.email-accounts-demo'))
        return new DOMRect(0, 0, 1000, 560);
      return new DOMRect(20, 20, 100, 32);
    }
  );
  const view = render(() => <EmailAccountsDemo />);
  setVisible(true);
  vi.advanceTimersByTime(1450);
  const pointer = view.container.querySelector('.demo-cursor');
  expect(pointer).toBeTruthy();
  expect(
    view.container
      .querySelector('.email-accounts-demo')
      ?.getAttribute('data-step')
  ).toBe('0');
  advanceTo(
    () =>
      view.container
        .querySelector('.email-accounts-demo')
        ?.getAttribute('data-step') === '2'
  );
  expect(view.container.querySelector('.demo-cursor')).toBe(pointer);
  fireEvent.pointerDown(
    view.getByRole('button', { name: 'Connect another account' })
  );
  vi.advanceTimersByTime(20000);
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
  expect(
    view.container
      .querySelector('.email-accounts-demo')
      ?.getAttribute('data-step')
  ).toBe('2');
});

it('opens the setup document from the draft without losing the visitor’s email edits', async () => {
  reduced = true;
  const view = render(() => <EmailAgenticEditingDemo />);
  const body = view.getByRole('textbox', { name: 'Email body' });
  body.textContent = 'Keep my edited email.';
  fireEvent.input(body);
  fireEvent.click(view.getAllByRole('link', { name: 'Setup plan' })[0]);
  expect(body.isConnected).toBe(true);
  expect(view.getByRole('textbox', { name: 'Email body' })).toBe(body);
  const title = await view.findByRole(
    'textbox',
    { name: 'Document title' },
    { timeout: 3000 }
  );
  expect(title.textContent).toBe('Setup plan');
  expect(
    view.getByRole('textbox', { name: 'Document body' }).textContent
  ).toContain('Connect your email inbox');
  fireEvent.click(view.getByRole('button', { name: 'Back to draft' }));
  expect(view.getByRole('textbox', { name: 'Email body' })).toBe(body);
  expect(body.textContent).toBe('Keep my edited email.');
});
