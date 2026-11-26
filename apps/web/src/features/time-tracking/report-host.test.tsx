import { PROPERTY_OPTION_IDS } from '@property/identifiers';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import { OpenTaskRow } from './components/time-breakdown';
import type { TimeSummaryKey } from './components/time-summary-types';
import { REPORT_TASK_PARTS } from './report-host';
import { reportTask } from './tests/report-task';

const save = vi.hoisted(() => vi.fn());

vi.mock('@queries/properties/entity', () => ({
  useBulkSaveEntityPropertiesMutation: () => ({ mutateAsync: save }),
}));
vi.mock('./task-timer-count', () => ({
  TaskTimerCount: () => null,
}));

afterEach(() => {
  cleanup();
  save.mockReset();
});

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

it('leads a task row with its priority then its status, which show without offering a change', () => {
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
  expect(shownStatus()).toBe('Task: In progress');
  expect(status.getAttribute('aria-disabled')).toBe('true');
  expect(priority.getAttribute('aria-disabled')).toBe('true');

  fireEvent.click(status);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(save).not.toHaveBeenCalled();
  expect(onOpen).toHaveBeenCalledOnce();

  fireEvent.click(priority);
  fireEvent.click(screen.getByText('Draft the plan'));
  expect(onOpen).toHaveBeenCalledTimes(3);
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
