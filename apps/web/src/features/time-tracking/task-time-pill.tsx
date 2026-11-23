import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName } from '@core/user/displayName';
import { tryMacroId } from '@core/user/macroId';
import type { JSX } from 'solid-js';
import { TimeTrackingProvider } from './time-tracking-provider';
import { TaskTimeView } from './views/task-time-view';

function Person(props: { userId: string }): JSX.Element {
  const name = () => getDisplayName(tryMacroId(props.userId));
  return (
    <span class="flex min-w-0 items-center gap-1.5">
      <UserIcon id={props.userId} name={name()} size="sm" suppressClick />
      <span class="max-w-28 truncate text-ink-muted">{name()}</span>
    </span>
  );
}

/** A task's Time pill and panel, wired to the app. */
export function TaskTimePill(props: {
  taskId: string;
  minutes: number;
  canEdit: boolean;
}): JSX.Element {
  return (
    <TimeTrackingProvider>
      <TaskTimeView
        taskId={props.taskId}
        minutes={props.minutes}
        canEdit={props.canEdit}
        person={(userId) => <Person userId={userId} />}
      />
    </TimeTrackingProvider>
  );
}
