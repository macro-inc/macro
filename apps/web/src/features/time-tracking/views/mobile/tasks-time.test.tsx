import type {
  TimeSummaryFieldsFragment,
  TimeSummaryInput,
} from '@service-storage/graphql/generated/graphql';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Client } from '@urql/core';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TimeTrackingContextProvider } from '../../context/time-tracking-context';
import type { RunningTimerState } from '../../primitives/running-timer';
import { TasksTimeMobile } from './tasks-time';

vi.mock('../../queries/time-tracking-changes', () => ({
  refreshOnTimeTrackingChanges: () => undefined,
}));
vi.mock('@components/app/mobile/float-regions/FloatRegion', () => ({
  FloatRegion: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@components/app/mobile/PickerSheet', () => ({
  PickerSheet: {
    Root: (props: ParentProps<{ open: boolean }>) => (
      <Show when={props.open}>
        <div role="dialog">{props.children}</div>
      </Show>
    ),
    Body: (props: ParentProps) => <>{props.children}</>,
  },
}));
vi.mock('@components/app/mobile/MobileDrawer', () => ({
  MobileDrawer: { Title: (props: ParentProps) => <h2>{props.children}</h2> },
}));
vi.mock('./task-time-sheet', () => ({
  TaskTimeSheet: (props: {
    taskId: string;
    open?: boolean;
    canEdit: boolean;
  }) => (
    <Show when={props.open}>
      <p>
        Time sheet for {props.taskId}
        {props.canEdit ? ', editable' : ''}
      </p>
    </Show>
  ),
}));

const inputs = vi.hoisted(() => [] as TimeSummaryInput[]);
vi.mock('../../queries/time-summary', () => ({
  createTimeSummaryQuery: (input: () => TimeSummaryInput | undefined) => ({
    summary: (): TimeSummaryFieldsFragment | undefined => {
      const value = input();
      if (!value) return undefined;
      inputs.push(value);
      return {
        from: value.from,
        to: value.to,
        totalMinutes: 90,
        taskCount: 1,
        scopeTaskCount: null,
        complete: true,
        groups: [
          {
            key: {
              by: 'DAY',
              userId: null,
              taskId: null,
              date: '2026-11-23',
              task: null,
            },
            minutes: 90,
            taskCount: 1,
            rows: [
              {
                key: {
                  by: 'TASK',
                  userId: null,
                  taskId: 'task-a',
                  date: null,
                  task: {
                    __typename: 'GraphqlSoupDocument',
                    id: 'task-a',
                    name: 'Draft the plan',
                  },
                },
                minutes: 90,
              },
            ],
          },
        ],
        thenTotals: [],
      };
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
  inputs.length = 0;
});

it('lists the week by day and logs time on a picked task through its sheet', async () => {
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
      <TasksTimeMobile
        view="week"
        clock={{ today: () => '2026-11-24', weekStartsOn: () => 0 }}
        showWeekends={() => true}
        person={(userId) => <span>{userId}</span>}
        onOpenTask={onOpenTask}
        editAccess={(_taskId, render) => render(() => true)}
        pickTask={(picker) => (
          <button
            type="button"
            onClick={() => picker.onPick({ id: 'task-b', name: 'Review' })}
          >
            Pick Review
          </button>
        )}
      />
    </TimeTrackingContextProvider>
  ));

  expect(inputs.at(-1)).toMatchObject({
    scope: 'MINE',
    from: '2026-11-22',
    to: '2026-11-28',
    groupBy: 'DAY',
    thenBy: 'TASK',
  });
  expect(screen.getByRole('region', { name: 'Mon, Nov 23' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Draft the plan/ }));
  expect(onOpenTask).toHaveBeenCalledWith('task-a', {
    event: expect.any(MouseEvent),
  });

  fireEvent.click(screen.getByRole('button', { name: 'Log time' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Pick Review' }));
  expect(
    await screen.findByText('Time sheet for task-b, editable')
  ).toBeTruthy();
});
