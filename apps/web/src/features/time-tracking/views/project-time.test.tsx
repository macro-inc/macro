import type {
  TimeSummaryFieldsFragment,
  TimeSummaryInput,
} from '@service-storage/graphql/generated/graphql';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { Client } from '@urql/core';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { TimeTrackingContextProvider } from '../context/time-tracking-context';
import type { RunningTimerState } from '../primitives/running-timer';
import { ProjectTimeDesktop } from './project-time';

const inputs = vi.hoisted(() => [] as TimeSummaryInput[]);
/** Periods whose read fails; a failed read keeps the last answer, as urql does. */
const failing = vi.hoisted(() => new Set<string>());
/** Projects whose read has not answered; urql keeps the last answer meanwhile. */
const loading = vi.hoisted(() => new Set<string>());
const readTimeExport = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ alert: vi.fn(), failure: vi.fn() }));

vi.mock('@core/component/Toast/Toast', () => ({ toast }));
vi.mock('../queries/time-tracking-changes', () => ({
  refreshOnTimeTrackingChanges: () => undefined,
}));
vi.mock('../queries/time-export', () => ({ readTimeExport }));

type Key = TimeSummaryFieldsFragment['thenTotals'][number]['key'];

const person = (userId: string): Key => ({
  by: 'PERSON',
  userId,
  taskId: null,
  date: null,
  task: null,
});
const task = (taskId: string, name: string): Key => ({
  by: 'TASK',
  userId: null,
  taskId,
  date: null,
  task: { __typename: 'GraphqlSoupDocument', id: taskId, name },
});

function summaryFor(input: TimeSummaryInput): TimeSummaryFieldsFragment {
  const base = {
    from: input.from,
    to: input.to,
    taskCount: 2,
    scopeTaskCount: 3,
    complete: input.from !== '2026-10-01',
  };
  if (!input.thenBy) {
    return { ...base, totalMinutes: 50, groups: [], thenTotals: [] };
  }
  const draft = task('task-a', 'Draft the plan');
  const review = task('task-b', 'Review the plan');
  if (input.groupBy === 'TASK') {
    return {
      ...base,
      totalMinutes: 135,
      groups: [
        {
          key: draft,
          minutes: 105,
          taskCount: 1,
          rows: [
            { key: person('alice'), minutes: 60 },
            { key: person('bob'), minutes: 45 },
          ],
        },
      ],
      thenTotals: [],
    };
  }
  return {
    ...base,
    totalMinutes: 135,
    groups: [
      {
        key: person('alice'),
        minutes: 90,
        taskCount: 2,
        rows: [
          { key: draft, minutes: 60 },
          { key: review, minutes: 30 },
        ],
      },
      {
        key: person('bob'),
        minutes: 45,
        taskCount: 1,
        rows: [{ key: draft, minutes: 45 }],
      },
    ],
    thenTotals: [
      { key: draft, minutes: 105 },
      { key: review, minutes: 30 },
    ],
  };
}

vi.mock('../queries/time-summary', () => ({
  createTimeSummaryQuery: (input: () => TimeSummaryInput | undefined) => {
    let last: TimeSummaryFieldsFragment | undefined;
    return {
      summary: () => {
        const value = input();
        if (!value) return undefined;
        inputs.push(value);
        if (failing.has(value.from) || loading.has(String(value.projectId)))
          return last;
        last = summaryFor(value);
        return last;
      },
      error: () => failing.has(input()?.from ?? ''),
      refetch: vi.fn(),
    };
  },
}));

afterEach(() => {
  cleanup();
  inputs.length = 0;
  failing.clear();
  loading.clear();
  readTimeExport.mockReset();
  toast.alert.mockReset();
  toast.failure.mockReset();
});

function renderTime(projectId: () => string = () => 'project-1') {
  const onOpenTask = vi.fn();
  const save = vi.fn(() => Promise.resolve({ saved: true }));
  render(() => (
    <TimeTrackingContextProvider
      value={{
        client: () => ({}) as Client,
        cacheHost: () => undefined,
        viewerId: () => 'alice',
        runningTimer: {} as RunningTimerState,
      }}
    >
      <ProjectTimeDesktop
        project={{ id: projectId(), name: 'Launch plans' }}
        clock={{ today: () => '2026-11-24', weekStartsOn: () => 1 }}
        person={(userId) => <span>{userId}</span>}
        onOpenTask={onOpenTask}
        save={save}
      />
    </TimeTrackingContextProvider>
  ));
  return { onOpenTask, save };
}

it('shows the three figures and opens a person to their tasks', () => {
  const { onOpenTask } = renderTime();

  expect(screen.getByText('Logged in November')).toBeTruthy();
  expect(screen.getByText('2h 15m')).toBeTruthy();
  expect(screen.getByText('50m')).toBeTruthy();
  expect(screen.getByText('2 of 3')).toBeTruthy();
  expect(inputs).toContainEqual({
    scope: 'PROJECT',
    projectId: 'project-1',
    from: '2026-11-01',
    to: '2026-11-30',
    groupBy: 'PERSON',
    thenBy: 'TASK',
  });
  expect(inputs).toContainEqual({
    scope: 'PROJECT',
    projectId: 'project-1',
    from: '2026-11-23',
    to: '2026-11-29',
    groupBy: 'DAY',
  });

  const alice = screen.getByRole('button', { name: /alice/ });
  expect(alice.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Review the plan')).toBeNull();
  fireEvent.click(alice);
  expect(alice.getAttribute('aria-expanded')).toBe('true');

  fireEvent.click(screen.getByRole('button', { name: /Review the plan/ }), {
    shiftKey: true,
  });
  expect(onOpenTask).toHaveBeenCalledWith('task-b', {
    event: expect.objectContaining({ shiftKey: true }),
  });
});

it('reads the breakdown again by task, with the people under each task', () => {
  const { onOpenTask } = renderTime();

  fireEvent.click(screen.getByRole('radio', { name: 'Task' }));

  expect(inputs.at(-1)).toMatchObject({ groupBy: 'TASK', thenBy: 'PERSON' });
  fireEvent.click(screen.getByRole('button', { name: /^Draft the plan/ }));
  expect(screen.getByText('bob')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open Draft the plan' }));
  expect(onOpenTask).toHaveBeenCalledWith('task-a', {
    event: expect.any(MouseEvent),
  });
});

it('exports the period as CSV and says when entries were left out', async () => {
  readTimeExport.mockResolvedValue(
    ok({ csv: 'Date,Person\n', rows: 10000, complete: false })
  );
  const { save } = renderTime();

  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

  await waitFor(() => expect(toast.alert).toHaveBeenCalledOnce());
  expect(readTimeExport).toHaveBeenCalledWith(
    {
      scope: 'project',
      projectId: 'project-1',
      from: '2026-11-01',
      to: '2026-11-30',
    },
    expect.any(AbortSignal)
  );
  expect(save).toHaveBeenCalledWith(
    '\uFEFFDate,Person\n',
    'macro-time-launch-plans-2026-11-01-to-2026-11-30.csv'
  );
  expect(toast.alert).toHaveBeenCalledWith(
    'Exported 10,000 entries and left the rest out: there are more than one export holds.'
  );
});

it('says when the export failed', async () => {
  readTimeExport.mockResolvedValue(err({ kind: 'failed' }));
  const { save } = renderTime();

  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

  await waitFor(() =>
    expect(toast.failure).toHaveBeenCalledWith(
      'Could not export the time. Try again.'
    )
  );
  expect(save).not.toHaveBeenCalled();
});

it('never shows the last period under the name of a new one whose read failed', async () => {
  failing.add('2026-10-01');
  renderTime();
  expect(screen.getByText('2h 15m')).toBeTruthy();

  fireEvent.keyDown(screen.getByRole('button', { name: /^Period:/ }), {
    key: 'Enter',
  });
  fireEvent.keyDown(
    await screen.findByRole('menuitem', { name: 'Last month' }),
    { key: 'Enter' }
  );

  await screen.findByText('Logged in October');
  expect(screen.queryByText('2h 15m')).toBeNull();
  expect(screen.queryByText('alice')).toBeNull();
  expect(screen.getByText('Could not load the time logged')).toBeTruthy();
  expect(screen.getByText('Try again')).toBeTruthy();
});

it('changes the period and says when the project held more tasks than a report counts', async () => {
  renderTime();

  fireEvent.keyDown(screen.getByRole('button', { name: /^Period:/ }), {
    key: 'Enter',
  });
  fireEvent.keyDown(
    await screen.findByRole('menuitem', { name: 'Last month' }),
    { key: 'Enter' }
  );

  await waitFor(() =>
    expect(inputs.at(-1)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    })
  );
  expect(screen.getByText('Logged in October')).toBeTruthy();
  expect(
    screen.getByText(
      'This project has more tasks than one report can count, so these totals leave some of them out.'
    )
  ).toBeTruthy();
});

it('never shows the totals of one project while another one loads', () => {
  const [projectId, setProjectId] = createSignal('project-1');
  loading.add('project-2');
  renderTime(projectId);
  expect(screen.getByText('2h 15m')).toBeTruthy();

  setProjectId('project-2');

  expect(screen.queryByText('2h 15m')).toBeNull();
  expect(screen.queryByText('alice')).toBeNull();
});
