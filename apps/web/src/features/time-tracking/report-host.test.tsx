import { PROPERTY_OPTION_IDS } from '@property/identifiers';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import { OpenTaskRow } from './components/time-breakdown';
import type { TimeSummaryKey } from './components/time-summary-types';
import { REPORT_TASK_PARTS } from './report-host';
import { reportTask } from './tests/report-task';

vi.mock('@queries/properties/entity', () => ({
  useBulkSaveEntityPropertiesMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./task-timer-count', () => ({
  TaskTimerCount: () => null,
}));

afterEach(cleanup);

/** The status the row shows, as its glyph names it for the status button. */
function shownStatus(): string | null | undefined {
  return screen
    .getByRole('button', { name: 'Change status' })
    .querySelector('[role="img"]')
    ?.getAttribute('aria-label');
}

function taskKey(task: TimeSummaryKey['task']): TimeSummaryKey {
  return {
    by: 'TASK',
    userId: null,
    taskId: task?.id ?? null,
    date: null,
    task,
  };
}

function renderRow(task: TimeSummaryKey['task']) {
  const onOpen = vi.fn();
  render(() => (
    <OpenTaskRow
      timeKey={taskKey(task)}
      task={REPORT_TASK_PARTS}
      onOpen={onOpen}
    >
      <span>{task?.name}</span>
    </OpenTaskRow>
  ));
  return { onOpen };
}

it('draws a task row with its priority then its status, which change without opening the task', () => {
  const { onOpen } = renderRow(
    reportTask('task-a', 'Draft the plan', {
      status: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
      priority: PROPERTY_OPTION_IDS.PRIORITY.URGENT,
    })
  );

  const priority = screen.getByRole('button', { name: 'Change priority' });
  const status = screen.getByRole('button', { name: 'Change status' });
  expect(
    priority.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  expect(status.getAttribute('aria-disabled')).toBe('false');
  expect(shownStatus()).toBe('Task: In progress');

  fireEvent.click(status);
  fireEvent.click(priority);
  expect(onOpen).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText('Draft the plan'));
  expect(onOpen).toHaveBeenCalledOnce();
});

it('shows a completed task as completed', () => {
  renderRow(
    reportTask('task-a', 'Draft the plan', {
      status: PROPERTY_OPTION_IDS.STATUS.COMPLETED,
      completed: true,
    })
  );

  expect(shownStatus()).toBe('Task: Completed');
});

it('offers a viewer who can only view the task no change, and opens it instead', () => {
  const { onOpen } = renderRow(
    reportTask('task-a', 'Draft the plan', {
      status: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
      access: 'VIEW',
    })
  );

  const status = screen.getByRole('button', { name: 'Change status' });
  expect(status.getAttribute('aria-disabled')).toBe('true');
  expect(
    screen
      .getByRole('button', { name: 'Change priority' })
      .getAttribute('aria-disabled')
  ).toBe('true');

  fireEvent.click(status);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(onOpen).toHaveBeenCalledOnce();
});

it('follows a status changed on the task elsewhere', () => {
  const [task, setTask] = createStore(
    reportTask('task-a', 'Draft the plan', {
      status: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
    })
  );
  renderRow(task);
  expect(shownStatus()).toBe('Task: In progress');

  setTask(
    'properties',
    reportTask('task-a', 'Draft the plan', {
      status: PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
    }).properties
  );

  expect(shownStatus()).toBe('Task: In review');
});

it('draws no status or priority for a task the summary could not read', () => {
  renderRow(null);

  expect(screen.queryByRole('button', { name: 'Change status' })).toBeNull();
});
