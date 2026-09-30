import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AgentEmailReviewDemo,
  AgentTaskResultDemo,
} from '../agents/AgentStories';
import { CallTranscriptDemo } from '../calls/CallStories';
import { ChannelThreadDemo } from '../channels/ChannelStories';
import {
  DocumentAgentDemo,
  DocumentSharingDemo,
} from '../documents/DocumentStories';
import {
  ReviewDiscussionDemo,
  ReviewQueueDemo,
} from '../reviews/ReviewStories';
import { TaskFromMessageDemo, TaskOwnershipDemo } from '../tasks/TaskStories';

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

it('creates the task with the source channel and stops at a useful final state', () => {
  const view = render(() => <TaskFromMessageDemo />);
  vi.advanceTimersByTime(10000);
  expect(
    view.getByRole('button', { name: 'Create task from message' })
  ).toBeTruthy();
  visible(true);
  vi.advanceTimersByTime(4200);
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Fix the team invite handoff'
  );
  expect(view.getByRole('button', { name: 'From launch' })).toBeTruthy();
  expect(
    view.getAllByRole('button', { name: 'Change assignee' })[0].textContent
  ).toContain('Teo');
  vi.advanceTimersByTime(30000);
  expect(vi.getTimerCount()).toBe(0);
});

it('pauses offscreen and in a hidden tab, then preserves a visitor’s task edits', () => {
  const view = render(() => <TaskOwnershipDemo />);
  visible(true);
  vi.advanceTimersByTime(1400);
  expect(
    view.getAllByRole('button', { name: 'Change assignee' })[0].textContent
  ).toContain('Teo');
  visible(false);
  vi.advanceTimersByTime(10000);
  expect(
    view.getAllByRole('button', { name: 'Change priority' })[0].textContent
  ).toContain('Low');
  visible(true);
  hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(10000);
  expect(
    view.getAllByRole('button', { name: 'Change priority' })[0].textContent
  ).toContain('Low');
  hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  const title = view.getByRole('textbox', { name: 'Task title' });
  fireEvent.keyDown(title, { key: 'ArrowLeft' });
  title.innerText = 'Visitor’s task title';
  fireEvent.blur(title);
  reduce();
  vi.advanceTimersByTime(30000);
  expect(title.textContent).toBe('Visitor’s task title');
  expect(
    view.getAllByRole('button', { name: 'Change priority' })[0].textContent
  ).toContain('Low');
});

it('leaves the document editable and never replaces the visitor’s text', () => {
  const view = render(() => <DocumentAgentDemo />);
  visible(true);
  const body = view.getByRole('textbox', { name: 'Document body' });
  fireEvent.pointerDown(body);
  body.innerHTML = '<p>Our team’s revised launch plan.</p>';
  fireEvent.blur(body);
  reduce();
  vi.advanceTimersByTime(30000);
  expect(body.textContent).toContain('Our team’s revised launch plan.');
  expect(body.textContent).not.toContain('Teo: verify');
});

it('shows the finished document for reduced motion', () => {
  reduced = true;
  const view = render(() => <DocumentAgentDemo />);
  expect(
    view.getByRole('textbox', { name: 'Document body' }).textContent
  ).toContain('Teo: verify the invite flow.');
  vi.advanceTimersByTime(100);
  expect(vi.getTimerCount()).toBe(0);
});

it('shares the document with the chosen access and preserves it when reopened', () => {
  const view = render(() => <DocumentSharingDemo />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  const dialog = within(view.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('Email or group'), {
    target: { value: 'teo' },
  });
  fireEvent.change(dialog.getByLabelText('Access level'), {
    target: { value: 'Comment' },
  });
  fireEvent.click(dialog.getByRole('button', { name: 'Share' }));
  const access = view.container.querySelector('.product-share-access')!;
  expect(access.textContent).toContain('Teo Nys');
  expect(access.textContent).toContain('Comment');
  fireEvent.click(dialog.getByRole('button', { name: 'Close sharing' }));
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  expect(
    view.container.querySelector('.product-share-access')?.textContent
  ).toContain('Comment');
});

it('adds a reply to its original thread rather than a new channel message', () => {
  const view = render(() => <ChannelThreadDemo />);
  fireEvent.click(view.getByRole('button', { name: /2 replies/ }));
  const thread = view.container.querySelector('.sample-channel-thread')!;
  fireEvent.click(
    within(thread as HTMLElement).getAllByRole('button', {
      name: 'Reply to message',
    })[0]
  );
  const input = within(thread as HTMLElement).getByRole('textbox');
  input.textContent = 'Confirmed. Keep the invite flow first.';
  fireEvent.input(input);
  fireEvent.click(
    within(thread as HTMLElement).getByRole('button', {
      name: 'Send demo message',
    })
  );
  expect(
    within(thread as HTMLElement).getByText(
      'Confirmed. Keep the invite flow first.'
    )
  ).toBeTruthy();
  expect(
    view.container.querySelectorAll('.sample-channel-thread')
  ).toHaveLength(2);
});

it('opens an agent-created task in the ordinary editable task view', () => {
  reduced = true;
  const view = render(() => <AgentTaskResultDemo />);
  fireEvent.click(
    view.getByRole('button', { name: 'Review Thursday’s launch checks' })
  );
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Review Thursday’s launch checks'
  );
  expect(
    view.getAllByRole('button', { name: 'Change assignee' })[0]
  ).toBeTruthy();
});

it('keeps the edited agent email as the actual Sent artifact', () => {
  const view = render(() => <AgentEmailReviewDemo />);
  const subject = view.getByRole('textbox', { name: 'Subject' });
  fireEvent.input(subject, { target: { value: 'Thursday at 9 — confirmed' } });
  const body = view.getByRole('textbox', { name: 'Email body' });
  body.innerText = 'Thursday at 9 works for our follow-up. Julia will join us.';
  fireEvent.input(body);
  fireEvent.click(view.getByRole('button', { name: 'Send email' }));
  expect(
    view.getByRole('heading', { name: 'Thursday at 9 — confirmed' })
  ).toBeTruthy();
  expect(
    view.getByText('Thursday at 9 works for our follow-up.', { exact: false })
  ).toBeTruthy();
});

it('lets a visitor choose a transcript segment without being moved back by motion', () => {
  const view = render(() => <CallTranscriptDemo />);
  visible(true);
  const segment = view.getByRole('button', {
    name: 'Go to 1:24: Julia Westphal',
  });
  fireEvent.pointerDown(segment);
  fireEvent.click(segment);
  reduce();
  vi.advanceTimersByTime(20000);
  expect(segment.getAttribute('aria-pressed')).toBe('true');
});

it('combines review filters and search, opens the correct item, and preserves the queue', () => {
  const view = render(() => <ReviewQueueDemo />);
  fireEvent.click(view.getByRole('button', { name: 'All reviews' }));
  fireEvent.input(view.getByRole('searchbox'), {
    target: { value: 'announcement' },
  });
  fireEvent.click(
    view.getByRole('button', {
      name: 'Open review: Update the launch announcement',
    })
  );
  expect(
    view.getByRole('heading', { name: 'Update the launch announcement' })
  ).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Back to reviews' }));
  expect((view.getByRole('searchbox') as HTMLInputElement).value).toBe(
    'announcement'
  );
  expect(
    view.queryByRole('button', {
      name: 'Open review: Retry transient deploy failures',
    })
  ).toBeNull();
});

it('filters bot messages without removing the human review and its line context', () => {
  const view = render(() => <ReviewDiscussionDemo />);
  fireEvent.click(view.getByRole('checkbox', { name: 'Hide bots (1)' }));
  expect(view.queryByText('Preview available for this branch.')).toBeNull();
  expect(view.getByText('deploy/retry.ts · L6')).toBeTruthy();
  expect(view.getByText(/Only temporary registry failures/)).toBeTruthy();
});

it('keeps a supplied email draft intact for reduced motion', () => {
  reduced = true;
  const view = render(() => <AgentEmailReviewDemo />);
  expect(
    view.getByRole('textbox', { name: 'Email body' }).textContent
  ).toContain('Thursday at 9 works');
  expect(
    view.getByRole('textbox', { name: 'Email body' }).textContent
  ).not.toContain('Macro sales overview');
});
