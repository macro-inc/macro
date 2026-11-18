import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
} from 'solid-js';
import type { TaskBoardActions } from '../context/task-board';
import {
  isTaskBoardMove,
  type TaskBoardColumn,
  type TaskBoardGrouping,
  type TaskBoardMove,
  type TaskBoardTask,
  taskBoardGroupKeys,
} from '../core/task-board';
import {
  movedTask,
  placementMatches,
  projectTaskBoardPlacements,
  type TaskBoardPlacement,
} from '../core/task-board-optimism';

type Placement = TaskBoardPlacement & {
  confirmedColumns?: readonly TaskBoardColumn[];
};
/** Owns temporary placements; shared mutations still own property values and rollback. */
export function createTaskBoard(options: {
  grouping: Accessor<TaskBoardGrouping>;
  scope: Accessor<string>;
  columns: Accessor<readonly TaskBoardColumn[]>;
  task(id: string): TaskBoardTask | undefined;
  actions: TaskBoardActions;
  compareTasks?: (left: TaskBoardTask, right: TaskBoardTask) => number;
  /** Resolve a restricted date picker before changing placement or writing. */
  prepareMove?: (
    move: TaskBoardMove,
    grouping: TaskBoardGrouping
  ) => Promise<TaskBoardMove | undefined>;
}) {
  const [pending, setPending] = createSignal<string[]>([]);
  const [error, setError] = createSignal<{ scope: string; text: string }>();
  const [placements, setPlacements] = createSignal<readonly Placement[]>([]);
  const currentPlacements = createMemo(() =>
    placements().filter(
      (placement) =>
        placement.scope === options.scope() && !!options.task(placement.task.id)
    )
  );
  const columns = createMemo(() =>
    projectTaskBoardPlacements(
      options.columns(),
      currentPlacements(),
      options.compareTasks
    )
  );

  createEffect(() => {
    const retained = placements().filter((placement) => {
      if (!placement.confirmed) {
        return true;
      }

      // Completed overrides must not mask edits made in another view.
      if (placement.scope !== options.scope()) {
        return false;
      }

      // A local cache projection is not acknowledgement of a committed write.
      if (options.columns() === placement.confirmedColumns) {
        return true;
      }

      const current = options.task(placement.task.id);

      if (!current) {
        return false;
      }

      const expected = taskBoardGroupKeys(placement.task, placement.grouping);
      const actual = taskBoardGroupKeys(current, placement.grouping);
      const valuesMatch =
        expected.length === actual.length &&
        expected.every((key) => actual.includes(key));

      return !valuesMatch || !placementMatches(options.columns(), placement);
    });

    if (retained.length !== placements().length) {
      setPlacements(retained);
    }
  });

  const canMove = (move: TaskBoardMove) => {
    if (pending().includes(move.id) || !options.actions.canEditTask(move.id)) {
      return false;
    }

    const task =
      currentPlacements().find((placement) => placement.task.id === move.id)
        ?.task ?? options.task(move.id);
    const grouping = options.grouping();

    if (!isTaskBoardMove(task, grouping, move)) {
      return false;
    }

    const destinationExists = options
      .columns()
      .some((column) => column.id === move.toLane);

    if (!destinationExists) {
      return false;
    }

    return options.actions.canMoveTo(grouping, move.toLane);
  };

  const move = async (request: TaskBoardMove): Promise<boolean> => {
    if (!canMove(request)) return false;
    const grouping = options.grouping();
    const scope = options.scope();
    const task =
      currentPlacements().find((placement) => placement.task.id === request.id)
        ?.task ?? options.task(request.id);
    if (!task) return false;
    const previous = currentPlacements().find(
      (item) => item.task.id === request.id
    );
    let placement: Placement | undefined;
    setPending((ids) => [...ids, request.id]);
    setError(undefined);
    try {
      const resolved = options.prepareMove
        ? await options.prepareMove(request, grouping)
        : request;
      if (
        !resolved ||
        scope !== options.scope() ||
        !options.actions.canEditTask(request.id) ||
        !options.actions.canMoveTo(grouping, resolved.toLane)
      )
        return false;
      placement = {
        task: movedTask(task, grouping, resolved),
        previousGroupKeys: taskBoardGroupKeys(task, grouping),
        grouping,
        scope,
        confirmed: false,
      };
      const pendingPlacement = placement;
      setPlacements((items) => [
        ...items.filter((item) => item.task.id !== request.id),
        pendingPlacement,
      ]);
      await options.actions.save(resolved, grouping);
      setPlacements((items) =>
        items.map((item) =>
          item === pendingPlacement
            ? { ...item, confirmed: true, confirmedColumns: options.columns() }
            : item
        )
      );
      return true;
    } catch {
      if (placement)
        setPlacements((items) => {
          const retained = items.filter((item) => item !== placement);
          if (previous) retained.push(previous);
          return retained;
        });
      setError({ scope, text: 'Could not move task. Refresh or try again.' });
      return false;
    } finally {
      setPending((ids) => ids.filter((id) => id !== request.id));
    }
  };

  const currentError = () => {
    const current = error();

    if (current?.scope !== options.scope()) {
      return undefined;
    }

    return current?.text;
  };

  return {
    columns,
    canMove,
    move,
    pending: (id: string) => pending().includes(id),
    error: currentError,
  };
}
