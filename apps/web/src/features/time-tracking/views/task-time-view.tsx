import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, Show } from 'solid-js';
import { TaskTimeSheet } from './mobile/task-time-sheet';
import { TaskTimeDesktop } from './task-time-desktop';

export type TaskTimeViewProps = {
  taskId: string;
  /** The task's Time logged, in minutes. */
  minutes: number;
  /** Whether the viewer may log time: edit access on the task. */
  canEdit: boolean;
  /** The person who logged an entry: avatar and name. */
  person: (userId: string) => JSX.Element;
};

/** The Time pill and its panel: a popover on desktop, a sheet on touch. */
export function TaskTimeView(props: TaskTimeViewProps): JSX.Element {
  return (
    <Show when={isTouchDevice()} fallback={<TaskTimeDesktop {...props} />}>
      <TaskTimeSheet {...props} />
    </Show>
  );
}
