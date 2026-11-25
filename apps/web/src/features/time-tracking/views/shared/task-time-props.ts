import type { EntryPerson } from '../../components/entry-list';

export type TaskTimeViewProps = {
  taskId: string;
  /** The task's Time logged, in minutes. */
  minutes: number;
  /** Whether the viewer may log time: edit access on the task. */
  canEdit: boolean;
  /** Who logged an entry: avatar and name. */
  person: EntryPerson;
};
