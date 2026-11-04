import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskProjectView } from './TaskProjectView';
import {
  TaskAgentChannelDemo,
  TaskFromMessageDemo,
  TaskGithubDemo,
} from './TaskStories';
import { createTaskProject } from './taskProject';

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
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
    }),
  });
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
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
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

it('turns a message into a task with its title, assignee, and source channel', () => {
  const view = render(() => <TaskFromMessageDemo />);
  visible(true);
  vi.advanceTimersByTime(1500);
  expect(
    view.container.querySelector('[data-hovered="true"] [aria-label="Task"]')
  ).toBeTruthy();
  vi.advanceTimersByTime(1600);
  const title = view.getByRole('textbox', { name: 'New task title' });
  expect((title as HTMLInputElement).value).toBe(
    'Prepare the customer proposal'
  );
  expect(
    view.getAllByRole('button', { name: 'Change assignee' })[0].textContent
  ).toContain('Julia');
  vi.advanceTimersByTime(1500);
  expect(view.getByRole('menu')).toBeTruthy();
  expect(view.getByRole('menuitem', { name: 'High' })).toBeTruthy();
  vi.advanceTimersByTime(2300);
  expect(view.queryByRole('menu')).toBeNull();
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Prepare the customer proposal'
  );
  expect(view.getByRole('button', { name: 'From sales' })).toBeTruthy();
  expect(
    view.getAllByRole('button', { name: 'Change priority' })[0].textContent
  ).toContain('High');
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  fireEvent.pointerDown(view.getByRole('textbox', { name: 'Task title' }));
  vi.advanceTimersByTime(30000);
});

it('keeps a visitor’s task draft instead of advancing over it', () => {
  const view = render(() => <TaskFromMessageDemo />);
  const buttons = view.getAllByRole('button', { name: 'Task' });
  fireEvent.click(buttons[buttons.length - 1]);
  const title = view.getByRole('textbox', { name: 'New task title' });
  fireEvent.input(title, {
    target: { value: 'Include two pricing options' },
  });
  reduce();
  visible(true);
  vi.advanceTimersByTime(30000);
  expect((title as HTMLInputElement).value).toBe('Include two pricing options');
  fireEvent.submit(view.getByRole('form', { name: 'Create task' }));
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Include two pricing options'
  );
});

it('shows the created task without a cursor for reduced motion', () => {
  reduced = true;
  const view = render(() => <TaskFromMessageDemo />);
  expect(view.getByRole('button', { name: 'From sales' })).toBeTruthy();
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('types Jacob’s requests into the composer before sending them', () => {
  const view = render(() => <TaskAgentChannelDemo />);
  const input = view.getByRole('textbox', { name: 'Message #sales' });
  const log = within(view.getByRole('log', { name: 'Channel sales' }));
  visible(true);
  vi.advanceTimersByTime(1400);
  expect(input.textContent).toContain('@Macro');
  expect(log.queryByText(/make tasks for this proposal/)).toBeNull();
  advanceTo(() => log.queryByText(/make tasks for this proposal/));
  expect(input.textContent).toBe('');
  expect(log.getByText(/make tasks for this proposal/)).toBeTruthy();
  advanceTo(() =>
    view
      .queryByRole('textbox', { name: 'Thread reply' })
      ?.textContent?.includes('Julia')
  );
  const threadInput = view.getByRole('textbox', { name: 'Thread reply' });
  expect(threadInput.textContent).toContain('Julia');
  expect(threadInput.textContent).not.toContain('@Macro');
  expect(
    log.queryByText(/Julia will draft/, { selector: 'article p' })
  ).toBeNull();
  fireEvent.pointerDown(threadInput);
  threadInput.textContent = 'Keep my draft';
  fireEvent.input(threadInput);
  vi.advanceTimersByTime(30000);
  expect(threadInput.textContent).toBe('Keep my draft');
  expect(
    log.queryByText(/Julia will draft/, { selector: 'article p' })
  ).toBeNull();
});

it('lets @Macro create assigned tasks from one channel message', () => {
  const view = render(() => <TaskAgentChannelDemo />);
  expect(view.queryByText('Draft the customer proposal')).toBeNull();
  visible(true);
  vi.advanceTimersByTime(8000);
  const log = within(view.getByRole('log', { name: 'Channel sales' }));
  expect(log.getByText('Draft the customer proposal')).toBeTruthy();
  expect(
    log
      .getByText('Created and assigned both tasks.')
      .closest('.sample-thread-replies')
      ?.closest('[data-thread-id]')
      ?.getAttribute('data-thread-id')
  ).toBe('make-tasks');
  expect(view.queryByRole('button', { name: 'Close source' })).toBeNull();
  expect(log.getByText('Review the pricing')).toBeTruthy();
  fireEvent.click(log.getByText('Review the pricing'));
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Review the pricing'
  );
});

it('moves the task to In Review, then Completed, as its pull request changes', () => {
  const view = render(() => <TaskGithubDemo />);
  visible(true);
  vi.advanceTimersByTime(1100);
  expect(
    view.getAllByRole('button', { name: 'Change status' })[0].textContent
  ).toContain('In Review');
  vi.advanceTimersByTime(4500);
  expect(
    view.getAllByRole('button', { name: 'Change status' })[0].textContent
  ).toContain('Completed');
  expect(view.getByText('company/website#491')).toBeTruthy();
});

it('opens the linked brief and returns through its inline task mention without completing the work', () => {
  const view = render(() => <TaskFromMessageDemo />);
  visible(true);
  vi.advanceTimersByTime(10000);
  const link = view.getByRole('button', {
    name: 'Prepare the customer proposal',
  });
  expect(link.classList.contains('sample-task-mention-inline')).toBe(true);
  expect(link.classList.contains('dummy-entity-link')).toBe(false);
  fireEvent.pointerDown(link);
  fireEvent.click(link);
  expect(
    view.getAllByRole('button', { name: 'Change status' })[0].textContent
  ).toContain('Not Started');
  expect(
    view.getByRole('textbox', { name: 'Task description' }).textContent
  ).toContain('They need a proposal by Friday.');
  const documentLink = view.getByRole('button', { name: 'Customer brief' });
  expect(
    documentLink.querySelector('.demo-inline-mention.mention-document')
  ).toBeTruthy();
});

it('changes the existing proposal task to Julia after an explicit request', () => {
  const view = render(() => <TaskAgentChannelDemo />);
  visible(true);
  advanceTo(() => view.queryByText('The proposal is now assigned to Julia.'));
  expect(
    view
      .getByText('The proposal is now assigned to Julia.')
      .closest('.sample-thread-replies')
      ?.closest('[data-thread-id]')
      ?.getAttribute('data-thread-id')
  ).toBe('make-tasks');
  const followup = view.getByText(
    'Julia will draft the proposal instead. Can you update the task?'
  );
  expect(
    followup
      .closest('.sample-thread-replies')
      ?.closest('[data-thread-id]')
      ?.getAttribute('data-thread-id')
  ).toBe('make-tasks');
  expect(view.container.querySelectorAll('[data-thread-id]')).toHaveLength(1);
  fireEvent.click(
    view.getAllByRole('button', { name: 'Draft the customer proposal' })[0]
  );
  expect(
    view.getAllByRole('button', { name: 'Change assignee' })[0].textContent
  ).toContain('Julia');
});

it('keeps edits to the linked brief and reflects its new name on the task', () => {
  const w = createTaskProject();
  const view = render(() => <TaskProjectView workspace={w} />);
  fireEvent.click(view.getByRole('button', { name: 'Customer brief' }));
  const title = view.getByRole('textbox', { name: 'Document title' });
  Object.defineProperty(title, 'innerText', {
    value: 'Customer scope',
    configurable: true,
  });
  fireEvent.blur(title);
  const body = view.getByRole('textbox', { name: 'Document body' });
  body.innerHTML = '<p>Include the mobile signup flow.</p>';
  fireEvent.blur(body);
  fireEvent.click(view.getByRole('button', { name: 'Back to task' }));
  const link = view.getByRole('button', { name: 'Customer scope' });
  expect(
    link.querySelector('.demo-inline-mention.mention-document')
  ).toBeTruthy();
  fireEvent.click(link);
  expect(
    view.getByRole('textbox', { name: 'Document title' }).textContent
  ).toBe('Customer scope');
  expect(
    view.getByRole('textbox', { name: 'Document body' }).textContent
  ).toContain('Include the mobile signup flow.');
});

it('does not perform the scripted reassignment after the visitor takes over', () => {
  const view = render(() => <TaskAgentChannelDemo />);
  visible(true);
  vi.advanceTimersByTime(8000);
  fireEvent.pointerDown(
    view.getByRole('group', {
      name: 'Ask Macro to create tasks and change an owner',
    })
  );
  reduce();
  vi.advanceTimersByTime(20000);
  expect(view.queryByText('The proposal is now assigned to Julia.')).toBeNull();
});

it('pauses an offscreen or hidden walkthrough without losing its place', () => {
  const view = render(() => <TaskFromMessageDemo />);
  visible(true);
  vi.advanceTimersByTime(1300);
  visible(false);
  vi.advanceTimersByTime(20000);
  expect(view.queryByRole('form', { name: 'Create task' })).toBeNull();
  hidden = true;
  visible(true);
  vi.advanceTimersByTime(20000);
  expect(view.queryByRole('form', { name: 'Create task' })).toBeNull();
  hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(1700);
  expect(view.getByRole('form', { name: 'Create task' })).toBeTruthy();
});

it('preserves edits when opening a source and returning with Escape', async () => {
  const view = render(() => (
    <TaskProjectView workspace={createTaskProject()} />
  ));
  const title = view.getByRole('textbox', { name: 'Task title' });
  Object.defineProperty(title, 'innerText', {
    value: 'Prepare the final plan',
    configurable: true,
  });
  fireEvent.blur(title);
  fireEvent.click(view.getByRole('button', { name: 'From sales' }));
  expect(view.getByRole('log', { name: 'Channel sales' })).toBeTruthy();
  fireEvent.keyDown(view.getByRole('button', { name: 'Close source' }), {
    key: 'Escape',
  });
  await Promise.resolve();
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Prepare the final plan'
  );
  expect(document.activeElement).toBe(
    view.getByRole('button', { name: 'From sales' })
  );
});

it('finishes a partially played conversation in reduced motion without duplicate messages', () => {
  const view = render(() => <TaskAgentChannelDemo />);
  visible(true);
  vi.advanceTimersByTime(5000);
  reduce();
  reduce();
  vi.advanceTimersByTime(20000);
  const log = view.getByRole('log', { name: 'Channel sales' });
  expect(log.querySelectorAll('article')).toHaveLength(4);
  expect(log.querySelectorAll('[data-thread-id]')).toHaveLength(1);
  expect(
    within(log).getAllByText('Created and assigned both tasks.')
  ).toHaveLength(1);
  expect(
    within(log).getAllByText('The proposal is now assigned to Julia.')
  ).toHaveLength(1);
  expect(view.queryByRole('textbox', { name: 'Thread reply' })).toBeNull();
});

it('resumes the same agent draft after leaving view without skipping or duplicating messages', () => {
  const view = render(() => <TaskAgentChannelDemo />);
  visible(true);
  vi.advanceTimersByTime(1400);
  const input = view.getByRole('textbox', { name: 'Message #sales' });
  const draft = input.textContent;
  visible(false);
  vi.advanceTimersByTime(20000);
  expect(input.textContent).toBe(draft);
  expect(view.queryByText('Created and assigned both tasks.')).toBeNull();
  visible(true);
  advanceTo(() => view.queryByText('The proposal is now assigned to Julia.'));
  expect(
    view.getByRole('log', { name: 'Channel sales' }).querySelectorAll('article')
  ).toHaveLength(4);
  expect(view.getByText('The proposal is now assigned to Julia.')).toBeTruthy();
});

function advanceTo(reached: () => unknown) {
  for (let elapsed = 0; elapsed < 30000 && !reached(); elapsed += 50)
    vi.advanceTimersByTime(50);
  expect(!!reached()).toBe(true);
}
