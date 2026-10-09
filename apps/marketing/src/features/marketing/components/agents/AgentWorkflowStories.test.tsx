import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import DummyWorkspace from '../workspace/DummyWorkspace';
import {
  AgentDeliverableStory,
  AgentFeedbackWorkflow,
  AgentMeetingStory,
  AgentTeamworkStory,
} from './AgentWorkflowStories';

let intersections: IntersectionObserverCallback[];
let reduced = false;
beforeEach(() => {
  intersections = [];
  reduced = false;
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
    }),
  });
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => false);
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
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});
function visible() {
  for (const callback of intersections)
    callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
}

it('opens real feedback sources and preserves edits to the generated brief', async () => {
  const view = render(() => (
    <AgentFeedbackWorkflow workspace={createDummyWorkspace('messages')} />
  ));
  expect(
    within(
      view.getByRole('log', { name: 'Channel product-feedback' })
    ).getAllByRole('listitem')
  ).toHaveLength(2);
  const card = view.getByRole('button', {
    name: 'Client file upload feedback',
  });
  card.focus();
  fireEvent.click(card);
  const body = view.getByRole('textbox', { name: 'Document body' });
  body.textContent = 'Keep the upload selection, including filenames.';
  fireEvent.blur(body);
  fireEvent.click(view.getByRole('button', { name: 'Back to conversation' }));
  await Promise.resolve();
  expect(document.activeElement).toBe(card);
  fireEvent.click(card);
  expect(
    view.getByRole('textbox', { name: 'Document body' }).textContent
  ).toContain('including filenames');
  fireEvent.click(
    view.getByRole('button', { name: 'Upload size guidance task' })
  );
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Add upload size guidance'
  );
  fireEvent.keyDown(
    view.getByRole('button', { name: 'Back to conversation' }),
    { key: 'Escape' }
  );
  fireEvent.click(view.getByRole('button', { name: 'customer-support' }));
  expect(view.getByText(/Beacon’s upload failed halfway/)).toBeTruthy();
});

it('connects meeting preparation to email, call notes, and the calendar', () => {
  const view = render(() => <AgentMeetingStory />);
  visible();
  vi.advanceTimersByTime(7000);
  expect(view.queryByRole('textbox', { name: 'Document body' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'latest email' }));
  expect(view.getByText(/We also need 12 clients/)).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Back to conversation' }));
  fireEvent.click(view.getByRole('button', { name: 'discovery call' }));
  expect(
    view.getByRole('textbox', { name: 'Document body' }).textContent
  ).toContain('Guest uploads were not discussed');
  fireEvent.click(view.getByRole('button', { name: 'Back to conversation' }));
  fireEvent.click(
    view.getByRole('button', { name: 'Beacon Studio Fri 9:30 AM' })
  );
  expect(
    view.getByRole('heading', { name: 'Beacon Studio · File uploads' })
  ).toBeTruthy();
});

it('shows human approval before the coding result and opens its review', () => {
  const view = render(() => <AgentTeamworkStory />);
  expect(view.queryByText(/build this\./)).toBeNull();
  expect(view.queryByRole('button', { name: 'Open session' })).toBeNull();
  visible();
  vi.advanceTimersByTime(2000);
  expect(view.getAllByText(/build this\./)).toHaveLength(1);
  expect(view.queryByRole('button', { name: 'Open session' })).toBeNull();
  vi.advanceTimersByTime(2000);
  fireEvent.click(
    view.getByRole('button', { name: /#248 · Improve the client upload flow/ })
  );
  expect(
    view.getByRole('heading', { name: 'Improve the client upload flow' })
  ).toBeTruthy();
  expect(view.queryByText('Merged')).toBeNull();
  fireEvent.keyDown(
    view.getByRole('button', { name: 'Back to conversation' }),
    { key: 'Escape' }
  );
  fireEvent.click(view.getByRole('button', { name: 'Open session' }));
  expect(
    view.getByRole('heading', { name: 'Build the client upload screen' })
  ).toBeTruthy();
});

it('lets a visitor inspect the design without autoplay taking over', async () => {
  const view = render(() => <AgentTeamworkStory />);
  visible();
  const image = view.getByRole('button', { name: 'Open upload screen mockup' });
  image.focus();
  fireEvent.pointerDown(image);
  fireEvent.click(image);
  vi.advanceTimersByTime(6000);
  expect(
    view.getByRole('img', {
      name: 'Client files mockup using Macro’s folder upload composer',
    })
  ).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Back to conversation' }));
  await Promise.resolve();
  expect(document.activeElement).toBe(image);
  expect(view.queryByRole('button', { name: 'Open session' })).toBeNull();
});

it('shows the completed collaboration without animation for reduced motion', () => {
  reduced = true;
  const view = render(() => <AgentTeamworkStory />);
  expect(view.getAllByText(/build this\./)).toHaveLength(2);
  expect(view.getByRole('button', { name: 'Open session' })).toBeTruthy();
  expect(
    view.queryByRole('heading', { name: 'Improve the client upload flow' })
  ).toBeNull();
});

it('uses the feedback workflow in the shared workspace and keeps navigation usable', () => {
  const view = render(() => <DummyWorkspace agentShowcase embedded />);
  expect(
    view.getByRole('log', { name: 'Channel product-feedback' })
  ).toBeTruthy();
  const navigation = within(
    view.getByRole('navigation', { name: 'Workspace navigation' })
  );
  fireEvent.click(navigation.getByRole('button', { name: 'Agents' }));
  expect(
    view.getByRole('heading', { name: 'What should we work on?' })
  ).toBeTruthy();
});

it('restores the agent showcase records when the sample is reset', () => {
  const view = render(() => <DummyWorkspace agentShowcase />);
  fireEvent.click(
    view.getByRole('button', { name: 'Client file upload feedback' })
  );
  const body = view.getByRole('textbox', { name: 'Document body' });
  body.textContent = 'Temporary local edit.';
  fireEvent.blur(body);
  fireEvent.click(view.getByRole('button', { name: 'Reset' }));
  fireEvent.click(
    view.getByRole('button', { name: 'Client file upload feedback' })
  );
  expect(
    view.getByRole('textbox', { name: 'Document body' }).textContent
  ).toContain('Upload recovery');
});

it('replies to Julia before visibly writing a substantive checklist', () => {
  const view = render(() => <AgentDeliverableStory />);
  const discussion = within(
    view.getByRole('log', { name: 'Document discussion' })
  );
  expect(discussion.getByText(/add a simple test checklist/)).toBeTruthy();
  expect(discussion.queryByText('Now')).toBeNull();
  const body = () => view.getByRole('textbox', { name: 'Document body' });
  expect(body().textContent).not.toContain('Before sharing with clients');
  visible();
  vi.advanceTimersByTime(1600);
  const reply = discussion.getByText(
    'Sure, Julia. I’ll add a short checklist to the document.'
  );
  const replyRow = reply.closest('article');
  expect(replyRow?.getAttribute('data-reply')).toBe('true');
  expect(body().textContent).not.toContain('Before sharing with clients');
  vi.advanceTimersByTime(2600);
  expect(body().textContent).toContain('Before sharing with clients');
  expect(body().textContent).toContain('Send a file');
  expect(body().textContent).not.toContain('Check that the client can see');
  vi.advanceTimersByTime(20000);
  expect(body().textContent).toContain(
    'Check that the client can see who is reviewing the file.'
  );
  expect(
    discussion.getByText(/Done, Julia. I added three checks/).closest('article')
  ).toBe(replyRow);
  expect(body().textContent).toContain('Guest uploads still need');
});

it('preserves a visitor’s edit when they take over the shared document', () => {
  const view = render(() => <AgentDeliverableStory />);
  visible();
  const body = view.getByRole('textbox', { name: 'Document body' });
  fireEvent.pointerDown(body);
  body.textContent = 'Keep our agreed scope.';
  fireEvent.blur(body);
  vi.advanceTimersByTime(6000);
  expect(body.textContent).toBe('Keep our agreed scope.');
});

it('shows the complete checklist and reply immediately with reduced motion', () => {
  reduced = true;
  const view = render(() => <AgentDeliverableStory />);
  expect(
    view.getByRole('textbox', { name: 'Document body' }).textContent
  ).toContain('Check that the client can see who is reviewing the file.');
});

it('keeps research rows stable and settles tools before revealing the answer', () => {
  const view = render(() => <AgentMeetingStory />);
  const first = view.container.querySelector('[data-tool-row]');
  expect(view.getByText('Checking tomorrow’s meetings…')).toBeTruthy();
  visible();
  vi.advanceTimersByTime(1300);
  expect(view.container.querySelector('[data-tool-row]')).toBe(first);
  expect(view.getByText('Reading the latest customer messages…')).toBeTruthy();
  vi.advanceTimersByTime(2600);
  expect(view.getByText('Reading the team’s conversation…')).toBeTruthy();
  expect(
    view
      .getByRole('region', { name: 'Tool calls' })
      .querySelectorAll('[data-tool-row]')
  ).toHaveLength(4);
  expect(view.queryByRole('button', { name: 'latest email' })).toBeNull();
  vi.advanceTimersByTime(1300);
  expect(
    view
      .getByRole('button', { name: 'Called 4 tools' })
      .getAttribute('aria-expanded')
  ).toBe('true');
  vi.advanceTimersByTime(700);
  expect(
    view
      .getByRole('button', { name: 'Called 4 tools' })
      .getAttribute('aria-expanded')
  ).toBe('false');
  expect(
    view.queryByRole('button', { name: 'Friday meeting brief' })
  ).toBeNull();
  vi.advanceTimersByTime(450);
  fireEvent.click(view.getByRole('button', { name: 'Friday meeting brief' }));
  expect(
    view.getByRole('textbox', { name: 'Document body' }).textContent
  ).toContain('guest uploads');
});

it('shows the complete meeting brief immediately for reduced motion', () => {
  reduced = true;
  const view = render(() => <AgentMeetingStory />);
  expect(
    view.getByRole('button', { name: 'Friday meeting brief' })
  ).toBeTruthy();
  expect(view.queryByText('Checking tomorrow’s meetings…')).toBeNull();
});

it('gives the visitor control of the meeting demo without continuing autoplay', () => {
  const view = render(() => <AgentMeetingStory />);
  visible();
  fireEvent.pointerDown(
    view.getByRole('textbox', { name: 'Message the agent' })
  );
  vi.advanceTimersByTime(6000);
  expect(
    view.queryByRole('button', { name: 'Friday meeting brief' })
  ).toBeNull();
});

it('follows the edit instead of chasing the discussion until the final reply', () => {
  const view = render(() => <AgentDeliverableStory />);
  const body = view.getByRole('textbox', { name: 'Document body' });
  const scroller = body.closest('.dummy-scroll') as HTMLElement;
  const log = view.getByRole('log', { name: 'Document discussion' });
  let replyBottom = 650;
  vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, 600, 500)
  );
  vi.spyOn(log, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, replyBottom - 180, 600, 180)
  );
  visible();
  vi.advanceTimersByTime(1700);
  const before = scroller.scrollTop;
  expect(before).toBeGreaterThan(0);
  replyBottom = 800;
  vi.advanceTimersByTime(2000);
  expect(scroller.scrollTop).toBe(before);
  expect(within(log).queryByText(/Done, Julia/)).toBeNull();
  vi.advanceTimersByTime(20000);
  expect(scroller.scrollTop).toBeGreaterThan(before);
});
