import { UserIcon } from '@core/component/UserIcon';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName } from '@core/user/displayName';
import { tryMacroId } from '@core/user/macroId';
import { type JSX, Show } from 'solid-js';
import { TaskTimerCount } from './task-timer-count';
import { TimeTrackingProvider } from './time-tracking-provider';
import { TaskTimeSheet } from './views/mobile/task-time-sheet';
import type { TaskTimeViewProps } from './views/shared/task-time-props';
import { TaskTimeDesktop } from './views/task-time-desktop';

function Person(props: { userId: string }): JSX.Element {
  const name = () => getDisplayName(tryMacroId(props.userId));
  return (
    <span class="flex min-w-0 items-center gap-1.5">
      <UserIcon id={props.userId} name={name()} size="sm" suppressClick />
      <span class="max-w-28 truncate text-ink-muted">{name()}</span>
    </span>
  );
}

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
    person: (userId) => <Person userId={userId} />,
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
