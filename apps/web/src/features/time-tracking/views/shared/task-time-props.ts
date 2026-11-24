import type { JSX } from 'solid-js';

export type TaskTimeViewProps = {
  taskId: string;
  /** The task's Time logged, in minutes. */
  minutes: number;
  /** Whether the viewer may log time: edit access on the task. */
  canEdit: boolean;
  /** The person who logged an entry: avatar and name. */
  person: (userId: string) => JSX.Element;
};
