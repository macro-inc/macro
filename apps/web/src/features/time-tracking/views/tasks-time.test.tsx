import type {
  TimeEntryFieldsFragment,
  TimeSummaryFieldsFragment,
  TimeSummaryInput,
} from '@service-storage/graphql/generated/graphql';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import type { Client } from '@urql/core';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TimeTrackingContextProvider } from '../context/time-tracking-context';
import type { RunningTimerState } from '../primitives/running-timer';
import * as summaryModule from '../queries/time-summary';
import { TasksTimeDesktop } from './tasks-time';

const taskTime = vi.hoisted(() => ({
  pending: false,
  failed: false,
  hasOlder: false,
  showOlder: vi.fn(),
  refetch: vi.fn(() => Promise.resolve()),
}));
const log = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const startTimer = vi.hoisted(() => vi.fn());

vi.mock('../queries/time-tracking-changes', () => ({
  refreshOnTimeTrackingChanges: () => undefined,
}));
vi.mock('./shared/timer-actions', () => ({
  createTimerActions: () => ({ start: startTimer, stop: vi.fn() }),
}));

const entry = (
  date: string,
  minutes: number,
  userId = 'alice',
  note = 'Planning'
): TimeEntryFieldsFragment => ({
  id: `entry-${date}-${userId}`,
  taskId: 'task-a',
  userId,
  date,
  minutes,
  note,
  startedAt: null,
  endedAt: null,
  source: 'MANUAL',
  createdAt: `${date}T09:00:00.000Z`,
  updatedAt: `${date}T09:00:00.000Z`,
  canEdit: true,
});

vi.mock('../primitives/create-task-time', () => ({
  createTaskTime: (taskId: () => string | undefined) => ({
    entries: () =>
      taskId() === 'task-a' && !taskTime.failed
        ? [
            entry('2026-11-23', 60),
            entry('2026-11-23', 120, 'bob', 'Bob reviewing'),
          ]
        : [],
    pending: () => taskTime.pending,
    failed: () => taskTime.failed,
    refetch: taskTime.refetch,
    hasOlder: () => taskTime.hasOlder,
    olderPending: () => false,
    showOlder: taskTime.showOlder,
    log,
    update,
    remove: vi.fn(),
  }),
}));

type Key = TimeSummaryFieldsFragment['thenTotals'][number]['key'];
const day = (date: string): Key => ({
  by: 'DAY',
  userId: null,
  taskId: null,
  date,
  task: null,
});

const summaryState = vi.hoisted(() => ({ withoutTaskA: false }));

function summaryFor(input: TimeSummaryInput): TimeSummaryFieldsFragment {
  if (input.scope === 'MINE' && summaryState.withoutTaskA)
    return {
      from: input.from,
      to: input.to,
      totalMinutes: 0,
      taskCount: 0,
      scopeTaskCount: null,
      complete: true,
      groups: [],
      thenTotals: [],
    };
  const groups =
    input.scope === 'TEAM'
      ? [
          {
            key: {
              by: 'PERSON' as const,
              userId: 'alice',
              taskId: null,
              date: null,
              task: null,
            },
            minutes: 90,
            taskCount: 1,
            rows: [{ key: day('2026-11-23'), minutes: 90 }],
          },
          {
            key: {
              by: 'PERSON' as const,
              userId: 'bob',
              taskId: null,
              date: null,
              task: null,
            },
            minutes: 0,
            taskCount: 0,
            rows: [],
          },
        ]
      : [
          {
            key: {
              by: 'TASK' as const,
              userId: null,
              taskId: 'task-a',
              date: null,
              task: {
                __typename: 'GraphqlSoupDocument' as const,
                id: 'task-a',
                name: 'Draft the plan',
              },
            },
            minutes: 105,
            taskCount: 1,
            rows: [
              { key: day('2026-11-23'), minutes: 60 },
              { key: day('2026-11-24'), minutes: 30 },
              { key: day('2026-11-29'), minutes: 15 },
            ],
          },
        ];
  return {
    from: input.from,
    to: input.to,
    totalMinutes: 105,
    taskCount: 1,
    scopeTaskCount: null,
    complete: true,
    groups,
    thenTotals: [
      { key: day('2026-11-23'), minutes: 60 },
      { key: day('2026-11-24'), minutes: 30 },
      { key: day('2026-11-29'), minutes: 15 },
    ],
  };
}

const inputs = vi.hoisted(() => [] as TimeSummaryInput[]);
vi.mock('../queries/time-summary', async () => {
  const { createSignal } = await import('solid-js');
  const [version, setVersion] = createSignal(0);
  return {
    /** A new summary object for the same week, as a refetch gives. */
    bumpSummary: () => setVersion((value) => value + 1),
    createTimeSummaryQuery: (input: () => TimeSummaryInput | undefined) => ({
      summary: () => {
        version();
        const value = input();
        if (!value) return undefined;
        inputs.push(value);
        return summaryFor(value);
      },
      error: () => false,
      refetch,
    }),
  };
});
const bumpSummary = () =>
  (summaryModule as unknown as { bumpSummary(): void }).bumpSummary();

beforeEach(() => {
  log.mockResolvedValue(ok({ kind: 'committed', data: undefined }));
});
afterEach(() => {
  cleanup();
  log.mockReset();
  update.mockReset();
  refetch.mockClear();
  startTimer.mockReset();
  taskTime.showOlder.mockReset();
  taskTime.pending = false;
  taskTime.failed = false;
  taskTime.refetch.mockClear();
  taskTime.hasOlder = false;
  summaryState.withoutTaskA = false;
  inputs.length = 0;
});

function renderWeek(
  view: 'week' | 'team',
  options: { showWeekends?: boolean; canEdit?: boolean | undefined } = {}
) {
  const onOpenTask = vi.fn();
  render(() => (
    <TimeTrackingContextProvider
      value={{
        client: () => ({}) as Client,
        cacheHost: () => undefined,
        viewerId: () => 'alice',
        runningTimer: {} as RunningTimerState,
      }}
    >
      <TasksTimeDesktop
        view={view}
        clock={{ today: () => '2026-11-24', weekStartsOn: () => 1 }}
        showWeekends={() => options.showWeekends ?? false}
        person={(userId) => <span>{userId}</span>}
        onOpenTask={onOpenTask}
        editAccess={(_taskId, render) =>
          render(() => ('canEdit' in options ? options.canEdit : true))
        }
        pickTask={(picker) => (
          <button
            type="button"
            onClick={() =>
              picker.onPick({ id: 'task-b', name: 'Review the plan' })
            }
          >
            Pick Review the plan
          </button>
        )}
      />
    </TimeTrackingContextProvider>
  ));
  return { onOpenTask };
}

it('reads My week by task and day, Monday to Friday with weekends hidden', () => {
  renderWeek('week');

  expect(inputs.at(-1)).toEqual({
    scope: 'MINE',
    from: '2026-11-23',
    to: '2026-11-27',
    groupBy: 'TASK',
    thenBy: 'DAY',
  });
  const grid = screen.getByRole('table', { name: 'My week' });
  expect(
    within(grid)
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
  ).toEqual([
    'Task',
    'Mon 23',
    'Tue 24',
    'Wed 25',
    'Thu 26',
    'Fri 27',
    'Total',
  ]);
  const row = within(grid).getByRole('row', { name: /Draft the plan/ });
  const cells = within(row).getAllByRole('cell');
  expect(cells.map((cell) => cell.textContent)).toEqual([
    '1h',
    '30m',
    '–',
    '–',
    '–',
    '1h 30m',
  ]);
  expect(
    within(row).getByRole('button', {
      name: /^Draft the plan, Mon, Nov 23: 1h$/,
    })
  ).toBeTruthy();
});

it('logs a length typed into an empty cell on that task and day', async () => {
  renderWeek('week');

  fireEvent.click(
    screen.getByRole('button', { name: /^Draft the plan, Wed, Nov 25/ })
  );
  const input = await screen.findByRole('textbox', { name: 'Length to log' });
  fireEvent.input(input, { target: { value: '45m' } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);

  expect(log).toHaveBeenCalledWith({
    date: '2026-11-25',
    minutes: 45,
    note: null,
    startedAt: null,
    endedAt: null,
  });
  await waitFor(() => expect(refetch).toHaveBeenCalled());
});

it('opens the entries of a cell with time and adds to them, never overwriting', async () => {
  renderWeek('week');

  fireEvent.click(
    screen.getByRole('button', { name: /^Draft the plan, Mon, Nov 23/ })
  );
  expect(await screen.findByText('Planning')).toBeTruthy();
  const input = screen.getByRole('textbox', { name: 'Length to log' });
  fireEvent.input(input, { target: { value: '15m' } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);

  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({ date: '2026-11-23', minutes: 15 })
  );
  expect(update).not.toHaveBeenCalled();
});

it('keeps an open cell and its draft when the week reads again', async () => {
  renderWeek('week');

  const cell = screen.getByRole('button', {
    name: /^Draft the plan, Tue, Nov 24/,
  });
  fireEvent.click(cell);
  const input = await screen.findByRole('textbox', { name: 'Length to log' });
  fireEvent.input(input, { target: { value: '20m' } });

  bumpSummary();

  expect(screen.getByRole('textbox', { name: 'Length to log' })).toBe(input);
  expect((input as HTMLInputElement).value).toBe('20m');
  expect(
    screen.getByRole('button', { name: /^Draft the plan, Tue, Nov 24/ })
  ).toBe(cell);
});

it('lists a view-only task’s entries without a length to log', async () => {
  renderWeek('week', { canEdit: false });

  fireEvent.click(
    screen.getByRole('button', { name: /^Draft the plan, Mon, Nov 23/ })
  );
  expect(await screen.findByText('Planning')).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Length to log' })).toBeNull();
});

it('steps a week at a time and comes back to this week', () => {
  renderWeek('week');

  expect(screen.getByText(/^Nov 23\s–\s29$/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
  expect(inputs.at(-1)).toMatchObject({
    from: '2026-11-16',
    to: '2026-11-20',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
  expect(inputs.at(-1)).toMatchObject({
    from: '2026-11-30',
    to: '2026-12-04',
  });
  fireEvent.click(screen.getByRole('button', { name: 'This week' }));
  expect(inputs.at(-1)).toMatchObject({
    from: '2026-11-23',
    to: '2026-11-27',
  });
  expect(screen.queryByRole('button', { name: 'This week' })).toBeNull();
});

it('opens a task from its name', () => {
  const { onOpenTask } = renderWeek('week');

  fireEvent.click(screen.getByRole('button', { name: 'Draft the plan' }));

  expect(onOpenTask).toHaveBeenCalledWith('task-a', {
    event: expect.any(MouseEvent),
  });
});

it('puts a picked task on the sheet and starts a timer on a picked task', async () => {
  renderWeek('week');

  fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Pick Review the plan' })
  );
  expect(
    within(screen.getByRole('table', { name: 'My week' })).getByRole('row', {
      name: /Review the plan/,
    })
  ).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Pick Review the plan' })
  );
  expect(startTimer).toHaveBeenCalledWith('task-b');
});

it('reads Team by person and day, read-only, with weekends when shown', () => {
  renderWeek('team', { showWeekends: true });

  expect(inputs.at(-1)).toMatchObject({
    scope: 'TEAM',
    groupBy: 'PERSON',
    thenBy: 'DAY',
  });
  const grid = screen.getByRole('table', { name: 'Team' });
  expect(within(grid).getAllByRole('columnheader')).toHaveLength(9);
  expect(within(grid).getByRole('row', { name: /bob/ })).toBeTruthy();
  expect(within(grid).queryAllByRole('button')).toHaveLength(0);
});

it('lists only the viewer’s entries in a cell, the ones it adds up', async () => {
  renderWeek('week');

  fireEvent.click(
    screen.getByRole('button', { name: /^Draft the plan, Mon, Nov 23/ })
  );
  expect(await screen.findByText('Planning')).toBeTruthy();
  expect(screen.queryByText('Bob reviewing')).toBeNull();
});

it('offers older entries when a cell lists less than it adds up to', async () => {
  taskTime.hasOlder = true;
  renderWeek('week');

  fireEvent.click(
    screen.getByRole('button', { name: /^Draft the plan, Tue, Nov 24: 30m$/ })
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Show older entries' })
  );
  expect(taskTime.showOlder).toHaveBeenCalled();
});

it('says so while a cell’s entries load, with the length field ready', async () => {
  taskTime.pending = true;
  renderWeek('week', { canEdit: undefined });

  fireEvent.click(
    screen.getByRole('button', { name: /^Draft the plan, Wed, Nov 25/ })
  );
  expect(await screen.findByRole('status')).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'Length to log' })).toBeTruthy();
});

it('keeps a row written in on the sheet once its time is gone', async () => {
  renderWeek('week');

  fireEvent.click(
    screen.getByRole('button', { name: /^Draft the plan, Mon, Nov 23/ })
  );
  const input = await screen.findByRole('textbox', { name: 'Length to log' });
  fireEvent.input(input, { target: { value: '15m' } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  await waitFor(() => expect(refetch).toHaveBeenCalled());

  summaryState.withoutTaskA = true;
  bumpSummary();

  const grid = screen.getByRole('table', { name: 'My week' });
  expect(
    within(grid).getByRole('row', { name: /Draft the plan/ })
  ).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'Length to log' })).toBe(input);
});

it('says when a cell’s entries could not be read and reads them again on Try again', async () => {
  taskTime.failed = true;
  renderWeek('week');

  fireEvent.click(
    screen.getByRole('button', { name: /^Draft the plan, Mon, Nov 23/ })
  );
  expect(
    await screen.findByText('Could not load the time logged')
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(taskTime.refetch).toHaveBeenCalled();
});

it('names a week in another year with its year', () => {
  renderWeek('week');

  for (let step = 0; step < 6; step += 1)
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));

  expect(screen.getByText(/^Jan 4\s–\s10, 2027$/)).toBeTruthy();
});
