import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrmEnrichmentDemo } from './CrmEnrichmentDemo';
import { CrmRecordDemo } from './CrmRecordDemo';

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
const section = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.sample-record-section h2')?.textContent ??
  'Overview';

it('adds a company from email that is already described, then the team’s note', () => {
  const view = render(() => <CrmEnrichmentDemo />);
  expect(view.getByText('Last Interaction')).toBeTruthy();
  expect(view.queryByText('Kestrel Robotics')).toBeNull();
  visible(true);
  vi.advanceTimersByTime(800);
  const row = view.container.querySelector<HTMLElement>(
    '[data-company-row="kestrel"]'
  );
  expect(row?.dataset.unread).toBe('true');
  expect(within(row!).getByText('10:08 AM')).toBeTruthy();
  visible(false);
  vi.advanceTimersByTime(10000);
  expect(view.queryByRole('textbox', { name: 'Company name' })).toBeNull();
  visible(true);
  vi.advanceTimersByTime(1700);
  expect(
    (view.getByRole('textbox', { name: 'Company name' }) as HTMLInputElement)
      .value
  ).toBe('Kestrel Robotics');
  expect(view.getByText(/autonomous inventory robots/)).toBeTruthy();
  expect(view.getByText('Last interacted 2 minutes ago')).toBeTruthy();
  expect(view.queryByText(/Priya runs ops/)).toBeNull();
  vi.advanceTimersByTime(2100);
  expect(view.getByText(/Priya runs ops/)).toBeTruthy();
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('shows the described company and note at once with reduced motion', () => {
  reduced = true;
  const view = render(() => <CrmEnrichmentDemo />);
  expect(view.getByText(/autonomous inventory robots/)).toBeTruthy();
  expect(view.getByText(/Priya runs ops/)).toBeTruthy();
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('tours Parlor Studio’s emails and calls, then returns to its Discussion', () => {
  const view = render(() => <CrmRecordDemo />);
  expect(view.getByText(/Ava wants to try folder uploads/)).toBeTruthy();
  visible(true);
  vi.advanceTimersByTime(1400);
  expect(section(view)).toBe('Emails');
  const emails = within(view.getByLabelText('Company emails'));
  expect(emails.getByText('Thursday demo')).toBeTruthy();
  expect(emails.getByText('Who is joining on Thursday')).toBeTruthy();
  vi.advanceTimersByTime(2000);
  expect(section(view)).toBe('Calls');
  expect(
    within(view.getByLabelText('Company calls')).getByText('Thursday demo prep')
  ).toBeTruthy();
  vi.advanceTimersByTime(2000);
  expect(section(view)).toBe('Files');
  expect(view.getByText('Setup guide')).toBeTruthy();
  vi.advanceTimersByTime(2000);
  expect(section(view)).toBe('Tasks');
  expect(view.getByText('Verify folder uploads in production')).toBeTruthy();
  vi.advanceTimersByTime(2000);
  expect(section(view)).toBe('Overview');
  expect(
    view.getByText(
      'Ava wants to try folder uploads at Thursday’s demo. Check the release with Teo before confirming. Julia is helping with setup.'
    )
  ).toBeTruthy();
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('keeps the visitor’s Emails tab selected while changing filters', () => {
  const view = render(() => <CrmRecordDemo />);
  fireEvent.click(
    view.getByRole('button', { name: /^Interact with Parlor Studio/ })
  );
  fireEvent.click(view.getByRole('radio', { name: 'Emails' }));
  const list = () => within(view.getByLabelText('Company emails'));
  expect(list().getByText('Who is joining on Thursday')).toBeTruthy();
  fireEvent.click(view.getByRole('radio', { name: 'Signal' }));
  expect(
    (view.getByRole('radio', { name: 'Signal' }) as HTMLInputElement).checked
  ).toBe(true);
  expect(list().getByText('Thursday demo')).toBeTruthy();
  fireEvent.click(view.getByRole('radio', { name: 'Me' }));
  expect(
    (view.getByRole('radio', { name: 'Me' }) as HTMLInputElement).checked
  ).toBe(true);
  expect(list().getByText('Thursday demo')).toBeTruthy();
  fireEvent.click(view.getByRole('radio', { name: 'All' }));
  expect(list().getByText('Who is joining on Thursday')).toBeTruthy();
  vi.advanceTimersByTime(20000);
  expect(section(view)).toBe('Emails');
});

it('lists the record’s team, files, and tasks', () => {
  const view = render(() => <CrmRecordDemo />);
  fireEvent.click(
    view.getByRole('button', { name: /^Interact with Parlor Studio/ })
  );
  fireEvent.click(view.getByRole('radio', { name: 'Team' }));
  const contacts = within(view.getByLabelText('Contacts'));
  expect(contacts.getByText('ava@parlorstudio.example')).toBeTruthy();
  fireEvent.input(view.getByRole('textbox', { name: 'Search contacts' }), {
    target: { value: 'priya' },
  });
  expect(view.getByText('No matching contacts.')).toBeTruthy();
  expect(view.queryByLabelText('Contacts')).toBeNull();
  fireEvent.click(view.getByRole('radio', { name: 'Files' }));
  expect(view.getByRole('button', { name: 'Setup guide Today' })).toBeTruthy();
  expect(view.getByText('Thursday demo agenda')).toBeTruthy();
  fireEvent.click(view.getByRole('radio', { name: 'Tasks' }));
  expect(
    within(view.getByLabelText('Company tasks')).getByText(
      'Verify folder uploads in production'
    )
  ).toBeTruthy();
});
