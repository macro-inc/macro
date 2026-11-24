import type { JSX } from 'solid-js';
import type { OpenReportTask } from '../../components/time-breakdown';
import type { PersonLabel } from '../../components/time-key-label';
import type { ProjectTimeClock } from '../../primitives/create-project-time';

/** A task someone picked. */
export type PickedTask = { id: string; name: string };

/** Asks for one task; the host supplies its task search. */
export type TaskPicker = (props: {
  onPick(task: PickedTask): void;
  onClose(): void;
}) => JSX.Element;

/**
 * Renders with whether the viewer can log time on a task (edit access, as the
 * server requires); undefined until the host knows.
 */
export type TaskEditAccess = (
  taskId: string,
  render: (canEdit: () => boolean | undefined) => JSX.Element
) => JSX.Element;

/** What the Time section in Tasks needs from the app around it. */
export type TasksTimeViewProps = {
  view: 'week' | 'team';
  clock: ProjectTimeClock;
  /** The calendar's Show weekends preference. */
  showWeekends: () => boolean;
  person: PersonLabel;
  onOpenTask: OpenReportTask;
  pickTask: TaskPicker;
  editAccess: TaskEditAccess;
  /** The control that shows the Tasks navigation where it is hidden. */
  navigation?: JSX.Element;
};
