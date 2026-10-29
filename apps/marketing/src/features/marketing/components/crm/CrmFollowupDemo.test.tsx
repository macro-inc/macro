import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrmFollowupDemo } from './CrmFollowupDemo';
import { CrmRecordDemo } from './CrmRecordDemo';

let observe: IntersectionObserverCallback;
let reduced = false;
beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') && reduced,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: HTMLElement) {
        if (target.classList.contains('crm-demo-frame'))
          observe = this.callback;
      }
      disconnect() {}
      unobserve() {}
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
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
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
  observe(
    [
      {
        isIntersecting: value,
        intersectionRatio: value ? 1 : 0,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver
  );
}

it('reads every source in chat without automatically opening a second workspace', () => {
  const view = render(() => <CrmFollowupDemo />);
  visible(true);
  for (const delay of [1200, 1800, 1800, 1800, 1800, 1800, 1800]) {
    vi.advanceTimersByTime(delay);
    expect(view.queryByRole('region', { name: 'Customer context' })).toBeNull();
    expect(view.getByRole('region', { name: 'Follow-up agent' })).toBeTruthy();
  }
  expect(
    view.getByText('Read task: Verify folder uploads in production')
  ).toBeTruthy();
  expect(
    view.getByText('Read pull request #248: Fix folder uploads')
  ).toBeTruthy();
  vi.advanceTimersByTime(1800);
  expect(
    view.getByRole<HTMLInputElement>('textbox', { name: 'To' }).value
  ).toBe('Ava Chen <ava@parlorstudio.example>');
  expect(view.getByText('Next steps')).toBeTruthy();
});

it('pauses the chat walkthrough offscreen', () => {
  const view = render(() => <CrmFollowupDemo />);
  visible(true);
  vi.advanceTimersByTime(1200);
  visible(false);
  vi.advanceTimersByTime(20000);
  expect(view.queryByRole('textbox', { name: 'Email body' })).toBeNull();
  visible(true);
  vi.advanceTimersByTime(12600);
  expect(view.getByRole('textbox', { name: 'Email body' })).toBeTruthy();
});

it('opens every cited source and preserves an edited draft when returning', () => {
  reduced = true;
  const view = render(() => <CrmFollowupDemo />);
  const subject = view.getByRole<HTMLInputElement>('textbox', {
    name: 'Subject',
  });
  fireEvent.input(subject, { target: { value: 'Thursday at 9' } });
  const body = view.getByRole('textbox', { name: 'Email body' });
  body.textContent = 'Hi Ava, I’ll confirm after Teo finishes the check.';
  fireEvent.input(body);
  for (const name of [
    'Thursday demo',
    'prep call',
    'team chat',
    'production verification',
    'setup guide',
  ]) {
    fireEvent.click(view.getByRole('button', { name }));
    expect(view.getByRole('region', { name: 'Customer context' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Back to follow-up' }));
    expect(view.getByRole('textbox', { name: 'Subject' })).toBe(subject);
    expect(subject.value).toBe('Thursday at 9');
    expect(view.getByRole('textbox', { name: 'Email body' })).toBe(body);
    expect(body.textContent).toBe(
      'Hi Ava, I’ll confirm after Teo finishes the check.'
    );
  }
  fireEvent.click(view.getByRole('link', { name: 'Fix folder uploads #248' }));
  expect(
    view.getByRole('heading', { name: 'Fix folder uploads' })
  ).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Back to follow-up' }));
  expect(subject.value).toBe('Thursday at 9');
});

it('opens linked tasks and calls from the real company tabs', () => {
  reduced = true;
  const view = render(() => <CrmFollowupDemo />);
  fireEvent.click(view.getByRole('button', { name: 'Open Parlor Studio' }));
  fireEvent.click(view.getByRole('radio', { name: 'Tasks' }));
  fireEvent.click(
    view.getByRole('button', { name: /Verify folder uploads in production/ })
  );
  expect(
    view.container
      .querySelector('.crm-followup-demo')
      ?.getAttribute('data-source')
  ).toBe('task');
  fireEvent.click(view.getByRole('button', { name: 'Back to follow-up' }));
  fireEvent.click(view.getByRole('button', { name: 'Open Parlor Studio' }));
  fireEvent.click(view.getByRole('radio', { name: 'Calls' }));
  fireEvent.click(
    view.getByRole('button', { name: 'Thursday demo prep Yesterday' })
  );
  expect(
    view.container
      .querySelector('.crm-followup-demo')
      ?.getAttribute('data-source')
  ).toBe('call');
});

it('shows the same files and tasks in the preceding customer-record tour', () => {
  const view = render(() => <CrmRecordDemo />);
  visible(true);
  vi.advanceTimersByTime(5400);
  expect(view.getByLabelText('Company files').textContent).toContain(
    'Setup guide'
  );
  vi.advanceTimersByTime(2000);
  expect(view.getByLabelText('Company tasks').textContent).toContain(
    'Verify folder uploads in production'
  );
  fireEvent.click(view.getByRole('radio', { name: 'Files' }));
  vi.advanceTimersByTime(20000);
  expect(view.getByLabelText('Company files')).toBeTruthy();
});

it('populates customer sources and opens the selected task rather than the first task', () => {
  reduced = true;
  const view = render(() => <CrmFollowupDemo />);
  fireEvent.click(view.getByRole('button', { name: 'Open Parlor Studio' }));
  fireEvent.click(view.getByRole('radio', { name: 'Tasks' }));
  const tasks = view.getByLabelText('Company tasks');
  expect(tasks.querySelectorAll('.sample-record-task')).toHaveLength(4);
  expect(tasks.querySelectorAll('[aria-label="Task"]')).toHaveLength(4);
  fireEvent.click(
    view.getByRole('button', { name: /Confirm Thursday’s attendees/ })
  );
  expect(
    view.getByText(
      'Ask Ava for the three attendee names and send the calendar invite.'
    )
  ).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Back to follow-up' }));
  fireEvent.click(view.getByRole('button', { name: 'Open Parlor Studio' }));
  fireEvent.click(view.getByRole('radio', { name: 'Emails' }));
  expect(
    view.getByLabelText('Company emails').querySelectorAll('.sample-record-row')
  ).toHaveLength(4);
  fireEvent.click(view.getByRole('radio', { name: 'Files' }));
  expect(
    view.getByLabelText('Company files').querySelectorAll('button')
  ).toHaveLength(3);
});
