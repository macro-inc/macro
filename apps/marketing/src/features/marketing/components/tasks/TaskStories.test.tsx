import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  TaskAgentChannelDemo,
  TaskFromChecklistDemo,
  TaskFromMessageDemo,
  TaskGithubDemo,
} from './TaskStories';

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

it('turns a message into a task with its title, assignee, and source channel', () => {
  const view = render(() => <TaskFromMessageDemo />);
  visible(true);
  vi.advanceTimersByTime(1300);
  expect(
    view.container.querySelector('[data-hovered="true"] [aria-label="Task"]')
  ).toBeTruthy();
  vi.advanceTimersByTime(1600);
  const title = view.getByRole('textbox', { name: 'New task title' });
  expect((title as HTMLInputElement).value).toBe(
    'Keep the invited team selected through sign-up'
  );
  expect(
    view.getAllByRole('button', { name: 'Change assignee' })[0].textContent
  ).toContain('Teo');
  vi.advanceTimersByTime(3200);
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Keep the invited team selected through sign-up'
  );
  expect(view.getByRole('button', { name: 'From launch' })).toBeTruthy();
  expect(
    view.getAllByRole('button', { name: 'Change priority' })[0].textContent
  ).toContain('High');
  vi.advanceTimersByTime(30000);
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps a visitor’s task draft instead of advancing over it', () => {
  const view = render(() => <TaskFromMessageDemo />);
  const buttons = view.getAllByRole('button', { name: 'Task' });
  fireEvent.click(buttons[buttons.length - 1]);
  const title = view.getByRole('textbox', { name: 'New task title' });
  fireEvent.input(title, {
    target: { value: 'Keep the invited workspace selected' },
  });
  reduce();
  visible(true);
  vi.advanceTimersByTime(30000);
  expect((title as HTMLInputElement).value).toBe(
    'Keep the invited workspace selected'
  );
  fireEvent.submit(view.getByRole('form', { name: 'Create task' }));
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Keep the invited workspace selected'
  );
});

it('shows the created task without a cursor for reduced motion', () => {
  reduced = true;
  const view = render(() => <TaskFromMessageDemo />);
  expect(view.getByRole('button', { name: 'From launch' })).toBeTruthy();
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('lets @Macro create assigned tasks from one channel message', () => {
  const view = render(() => <TaskAgentChannelDemo />);
  expect(view.queryByText('Own the launch checklist')).toBeNull();
  visible(true);
  vi.advanceTimersByTime(2600);
  const log = within(view.getByRole('log', { name: 'Channel launch' }));
  expect(log.getByText('Fix the team invite handoff')).toBeTruthy();
  expect(log.getByText('Final read of the launch announcement')).toBeTruthy();
  fireEvent.click(log.getByText('Own the launch checklist'));
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Own the launch checklist'
  );
});

it('converts a selected checklist into task links', () => {
  const view = render(() => <TaskFromChecklistDemo />);
  visible(true);
  vi.advanceTimersByTime(1300);
  fireEvent.click(view.getByRole('button', { name: 'Tasks' }));
  expect(
    view.getByText('Final read of the announcement').closest('button')
  ).toBeTruthy();
  vi.advanceTimersByTime(30000);
  expect(vi.getTimerCount()).toBe(0);
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
  expect(view.getByText('launch-team/web#482')).toBeTruthy();
});
