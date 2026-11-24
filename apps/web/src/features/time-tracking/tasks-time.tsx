import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, Show, Suspense } from 'solid-js';
import {
  ReportPerson,
  TaskEditAccess,
  TaskSearch,
  useReportClock,
  useShowWeekends,
} from './report-host';
import { TimeTrackingProvider } from './time-tracking-provider';
import { TasksTimeMobile } from './views/mobile/tasks-time';
import type { TasksTimeViewProps } from './views/shared/tasks-time-props';
import { TasksTimeDesktop } from './views/tasks-time';

/**
 * The Time section of Tasks: My week or Team. The host mounts it only with
 * `enable-time-tracking` on.
 */
export function TasksTime(props: {
  view: 'week' | 'team';
  onOpenTask(
    task: { id: string },
    options?: EntityDetailNavigationOptions
  ): boolean;
  navigation?: JSX.Element;
}): JSX.Element {
  const base: Omit<TasksTimeViewProps, 'pickTask'> = {
    get view() {
      return props.view;
    },
    get navigation() {
      return props.navigation;
    },
    clock: useReportClock(),
    showWeekends: useShowWeekends(),
    person: (userId) => <ReportPerson userId={userId} />,
    onOpenTask: (taskId, options) => {
      props.onOpenTask({ id: taskId }, options);
    },
    editAccess: (taskId, render) => (
      <TaskEditAccess taskId={taskId}>{render}</TaskEditAccess>
    ),
  };
  return (
    <Suspense>
      <TimeTrackingProvider>
        <Show
          when={isTouchDevice()}
          fallback={
            <TasksTimeDesktop
              {...base}
              pickTask={(picker) => (
                <TaskSearch onPick={picker.onPick} onClose={picker.onClose} />
              )}
            />
          }
        >
          <TasksTimeMobile
            {...base}
            pickTask={(picker) => (
              <TaskSearch
                presentation="sheet"
                onPick={picker.onPick}
                onClose={picker.onClose}
              />
            )}
          />
        </Show>
      </TimeTrackingProvider>
    </Suspense>
  );
}
