import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type { TaskBoardGrouping, TaskBoardMove } from '../core/task-board';
import {
  isTaskDueDateBucket,
  TASK_DUE_DATE_BUCKETS,
  type TaskCalendar,
  taskDateOnlyToIso,
  taskDueDateBucket,
  taskDueDatePickerBounds,
} from '../core/task-due-date';

type PendingDate = {
  move: TaskBoardMove;
  scope: string;
  calendar: TaskCalendar;
  value: string;
  finish(value: TaskBoardMove | undefined): void;
};

/** Resolves bucket drops before the board changes placement or saves a property. */
export function createTaskDeadlineMove(options: {
  calendar: Accessor<TaskCalendar>;
  scope: Accessor<string>;
}) {
  const [pending, setPending] = createSignal<PendingDate>();
  const cancel = () => {
    pending()?.finish(undefined);
    setPending(undefined);
  };
  createEffect(
    on(
      () => [options.scope(), options.calendar()] as const,
      ([scope, calendar]) => {
        const current = pending();
        if (
          current &&
          (scope !== current.scope || calendar !== current.calendar)
        )
          cancel();
      }
    )
  );
  onCleanup(cancel);
  const prepare = async (
    move: TaskBoardMove,
    grouping: TaskBoardGrouping
  ): Promise<TaskBoardMove | undefined> => {
    if (grouping !== 'due_date') return move;
    if (!isTaskDueDateBucket(move.toLane)) return;
    const calendar = options.calendar();
    if (move.toLane === 'no_due_date') return { ...move, dueDate: null };
    if (move.toLane === 'today' || move.toLane === 'tomorrow')
      return { ...move, dueDate: calendar.boundaries[move.toLane] };
    cancel();
    const bounds = taskDueDatePickerBounds(move.toLane, calendar);
    return new Promise((finish) =>
      setPending({
        move,
        calendar,
        scope: options.scope(),
        value: bounds.min ?? bounds.max ?? calendar.today,
        finish,
      })
    );
  };
  const picker = () => {
    const current = pending();
    if (!current || !isTaskDueDateBucket(current.move.toLane)) return;
    return {
      label:
        TASK_DUE_DATE_BUCKETS.find(
          (bucket) => bucket.id === current.move.toLane
        )?.label ?? '',
      ...taskDueDatePickerBounds(current.move.toLane, current.calendar),
      value: current.value,
    };
  };
  const apply = () => {
    const current = pending();
    if (!current) return;
    const dueDate = taskDateOnlyToIso(current.value, current.calendar.timeZone);
    if (
      !dueDate ||
      taskDueDateBucket(dueDate, current.calendar) !== current.move.toLane
    )
      return;
    current.finish({ ...current.move, dueDate });
    setPending(undefined);
  };
  return {
    prepare,
    picker,
    cancel,
    apply,
    select: (value: string) =>
      setPending((current) => (current ? { ...current, value } : undefined)),
  };
}
