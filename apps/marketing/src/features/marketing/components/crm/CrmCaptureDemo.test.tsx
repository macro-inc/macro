import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrmCaptureDemo } from './CrmCaptureDemo';

let visible: IntersectionObserverCallback;
let reduced = false;
beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
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
function setVisible(isIntersecting: boolean) {
  visible(
    [{ isIntersecting } as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
}

it('updates the shared company fields from the message and pauses offscreen', () => {
  const view = render(() => <CrmCaptureDemo />);
  const stage = view.getByLabelText('Deal stage') as HTMLSelectElement;
  const owner = view.getByLabelText('Company owner') as HTMLSelectElement;
  const notes = view.getByLabelText(
    'Company description'
  ) as HTMLTextAreaElement;
  vi.advanceTimersByTime(10000);
  expect(stage.value).toBe('Lead');
  expect(owner.value).toBe('');
  setVisible(true);
  vi.advanceTimersByTime(2800);
  expect(stage.value).toBe('Demo');
  setVisible(false);
  vi.advanceTimersByTime(10000);
  expect(owner.value).toBe('');
  setVisible(true);
  vi.advanceTimersByTime(1400);
  expect(owner.value).toBe('jacob');
  vi.advanceTimersByTime(5600);
  expect(notes.value).toBe(
    'Demo on Thursday. Alex is leading the rollout for The Meadow.'
  );
  expect(
    view.getByText(
      'Updated The Meadow: demo stage, assigned to you, and Alex’s role saved in the company notes.'
    )
  ).toBeTruthy();
  expect(
    view.queryByRole('button', { name: /replay|pause|play crm/i })
  ).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps user edits instead of overwriting them with the walkthrough', () => {
  const view = render(() => <CrmCaptureDemo />);
  setVisible(true);
  vi.advanceTimersByTime(2800);
  const notes = view.getByLabelText(
    'Company description'
  ) as HTMLTextAreaElement;
  fireEvent.focusIn(notes);
  fireEvent.input(notes, { target: { value: 'My own next steps.' } });
  vi.advanceTimersByTime(20000);
  expect(notes.value).toBe('My own next steps.');
  expect(
    (view.getByLabelText('Company owner') as HTMLSelectElement).value
  ).toBe('');
});

it('shows the completed record immediately with reduced motion', () => {
  reduced = true;
  const view = render(() => <CrmCaptureDemo />);
  setVisible(true);
  expect((view.getByLabelText('Deal stage') as HTMLSelectElement).value).toBe(
    'Demo'
  );
  expect(
    (view.getByLabelText('Company owner') as HTMLSelectElement).value
  ).toBe('jacob');
  expect(
    (view.getByLabelText('Company description') as HTMLTextAreaElement).value
  ).toBe('Demo on Thursday. Alex is leading the rollout for The Meadow.');
  vi.advanceTimersByTime(10000);
  expect(vi.getTimerCount()).toBe(0);
});

it('opens the linked email and returns to the same customer record', () => {
  const view = render(() => <CrmCaptureDemo />);
  fireEvent.click(
    view.getByRole('button', {
      name: 'Dana Whitfield Next steps for our team 9:41 AM',
    })
  );
  expect(
    view.getByRole('button', { name: 'Back to customer record' })
  ).toBeTruthy();
  expect(
    view.getByRole('heading', { name: 'Next steps for our team' })
  ).toBeTruthy();
  fireEvent.click(
    view.getByRole('button', { name: 'Back to customer record' })
  );
  expect((view.getByLabelText('Company name') as HTMLInputElement).value).toBe(
    'The Meadow'
  );
});
