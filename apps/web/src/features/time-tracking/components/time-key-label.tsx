import { formatLocale, t } from '@app/lib/i18n';
import { parseISO } from 'date-fns';
import { type Component, type JSX, Match, Show, Switch } from 'solid-js';
import type { TimeSummaryKey } from './time-summary-types';

/** The person who logged time: avatar and name. */
export type PersonLabel = (userId: string) => JSX.Element;

/** A task a total is for, as the summary carries it. */
export type ReportTask = NonNullable<TimeSummaryKey['task']>;

/** What the host draws around a task's name, as the task's row in the Tasks list does. */
export type TaskLabelParts = {
  /** Priority then status, before the name. */
  Lead: Component<{ task: ReportTask }>;
  /** The viewer's running timer on the task, after the name. */
  Timer: Component<{ taskId: string }>;
};

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parseISO(date));
}

/** A task's name with the viewer's timer on it, for a name outside a summary. */
export function TaskName(props: {
  taskId: string;
  name: string | undefined;
  task: TaskLabelParts;
}): JSX.Element {
  return (
    <span class="flex min-w-0 items-center gap-1">
      <span class="min-w-0 truncate">
        {props.name || t('timeTracking.untitledTask')}
      </span>
      <props.task.Timer taskId={props.taskId} />
    </span>
  );
}

/** Who, what or when a total is for. */
export function TimeKeyLabel(props: {
  timeKey: TimeSummaryKey;
  person: PersonLabel;
  task: TaskLabelParts;
}): JSX.Element {
  return (
    <Switch>
      <Match when={props.timeKey.by === 'PERSON' && props.timeKey.userId}>
        {(userId) => props.person(userId())}
      </Match>
      <Match when={props.timeKey.by === 'TASK' && props.timeKey.taskId}>
        {(taskId) => (
          <TaskName
            taskId={taskId()}
            name={props.timeKey.task?.name}
            task={props.task}
          />
        )}
      </Match>
      <Match when={props.timeKey.by === 'DAY' && props.timeKey.date}>
        {(date) => <span class="truncate">{dayLabel(date())}</span>}
      </Match>
    </Switch>
  );
}

/**
 * A task's priority and status before its name, outside the row's own
 * button; nothing for a person, a day, or a task the summary could not read.
 */
export function TimeKeyLead(props: {
  timeKey: TimeSummaryKey;
  task: TaskLabelParts;
}): JSX.Element {
  return (
    <Show when={props.timeKey.by === 'TASK' && props.timeKey.task}>
      {(task) => <props.task.Lead task={task()} />}
    </Show>
  );
}

/** One identity per key, to remember which rows are open. */
export function timeKeyId(key: TimeSummaryKey): string {
  return `${key.by}:${key.userId ?? key.taskId ?? key.date ?? ''}`;
}
