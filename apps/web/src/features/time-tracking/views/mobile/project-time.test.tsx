import type {
  TimeSummaryFieldsFragment,
  TimeSummaryInput,
} from '@service-storage/graphql/generated/graphql';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Client } from '@urql/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TimeTrackingContextProvider } from '../../context/time-tracking-context';
import type { RunningTimerState } from '../../primitives/running-timer';
import { MobileProjectTime } from './project-time';

vi.mock('../../queries/time-tracking-changes', () => ({
  refreshOnTimeTrackingChanges: () => undefined,
}));

type Key = TimeSummaryFieldsFragment['thenTotals'][number]['key'];

const task = (taskId: string, name: string): Key => ({
  by: 'TASK',
  userId: null,
  taskId,
  date: null,
  task: { __typename: 'GraphqlSoupDocument', id: taskId, name },
});

const summary = (input: TimeSummaryInput): TimeSummaryFieldsFragment => ({
  from: input.from,
  to: input.to,
  totalMinutes: 135,
  taskCount: 2,
  scopeTaskCount: 3,
  complete: true,
  groups: [
    {
      key: {
        by: 'PERSON',
        userId: 'alice',
        taskId: null,
        date: null,
        task: null,
      },
      minutes: 90,
      taskCount: 2,
      rows: [
        { key: task('task-a', 'Draft the plan'), minutes: 60 },
        { key: task('task-b', 'Review the plan'), minutes: 30 },
      ],
    },
  ],
  thenTotals: [
    { key: task('task-a', 'Draft the plan'), minutes: 60 },
    { key: task('task-b', 'Review the plan'), minutes: 30 },
  ],
});

vi.mock('../../queries/time-summary', () => ({
  createTimeSummaryQuery: (input: () => TimeSummaryInput | undefined) => ({
    summary: () => {
      const value = input();
      return value ? summary(value) : undefined;
    },
    error: () => false,
    refetch: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('opens the stacked summary and a person to their tasks, and opens a task from it', async () => {
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
      <MobileProjectTime
        project={{ id: 'project-1', name: 'Launch plans' }}
        clock={{ today: () => '2026-11-24', weekStartsOn: () => 0 }}
        person={(userId) => <span>{userId}</span>}
        onOpenTask={onOpenTask}
      />
    </TimeTrackingContextProvider>
  ));

  const row = screen.getByRole('button', { name: /Logged in November/ });
  expect(row.textContent).toContain('2h 15m');
  fireEvent.click(row);

  await screen.findByRole('dialog', { name: 'Time' });
  expect(screen.getByText('By person')).toBeTruthy();
  expect(screen.getByText('Most time')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();

  const alice = screen.getByRole('button', { name: /alice/ });
  fireEvent.click(alice);
  expect(alice.getAttribute('aria-expanded')).toBe('true');
  const reviews = screen.getAllByRole('button', { name: /Review the plan/ });
  fireEvent.click(reviews[0] as HTMLElement);
  expect(onOpenTask).toHaveBeenCalledWith('task-b', {
    event: expect.any(MouseEvent),
  });
});
