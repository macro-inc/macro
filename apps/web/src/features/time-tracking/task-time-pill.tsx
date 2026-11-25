import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, Show } from 'solid-js';
import { ENTRY_PERSON } from './entry-person';
import { TaskTimerCount } from './task-timer-count';
import { TimeTrackingProvider } from './time-tracking-provider';
import { TaskTimeSheet } from './views/mobile/task-time-sheet';
import type { TaskTimeViewProps } from './views/shared/task-time-props';
import { TaskTimeDesktop } from './views/task-time-desktop';

/**
 * A task's Time pill and panel, wired to the app: a popover on desktop, a
 * bottom sheet on touch.
 */
export function TaskTimePill(props: {
  taskId: string;
  minutes: number;
  canEdit: boolean;
}): JSX.Element {
  const view: TaskTimeViewProps = {
    get taskId() {
      return props.taskId;
    },
    get minutes() {
      return props.minutes;
    },
    get canEdit() {
      return props.canEdit;
    },
    person: ENTRY_PERSON,
  };
  return (
    <TimeTrackingProvider>
      <Show when={isTouchDevice()} fallback={<TaskTimeDesktop {...view} />}>
        <TaskTimeSheet {...view} />
      </Show>
      <TaskTimerCount taskId={props.taskId} />
    </TimeTrackingProvider>
  );
}
