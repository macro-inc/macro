import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
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
  projectTaskBoardLocalPositions,
  projectTaskBoardPlacements,
  type TaskBoardLocalPosition,
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
  compareTasks?: (left: string, right: string) => number;
}) {
  const [pending, setPending] = createSignal<ReadonlySet<string>>(new Set());
  const [error, setError] = createSignal<{ scope: string; text: string }>();
  const [placements, setPlacements] = createSignal<readonly Placement[]>([]);
  const [positions, setPositions] = createSignal<
    readonly TaskBoardLocalPosition[]
  >([]);
  const resetPositions = () => setPositions([]);
  createEffect(on(options.scope, resetPositions, { defer: true }));
  const currentPlacements = createMemo(() =>
    placements().filter(
      (placement) =>
        placement.scope === options.scope() && !!options.task(placement.task.id)
    )
  );
  const columns = createMemo(() =>
    projectTaskBoardLocalPositions(
      projectTaskBoardPlacements(
        options.columns(),
        currentPlacements(),
        options.compareTasks
      ),
      positions()
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
    if (pending().has(move.id) || !options.actions.canEditTask(move.id)) {
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
    if (!canMove(request)) {
      return false;
    }

    const grouping = options.grouping();
    const scope = options.scope();
    const task =
      currentPlacements().find((placement) => placement.task.id === request.id)
        ?.task ?? options.task(request.id);

    if (!task) {
      return false;
    }

    const previous = currentPlacements().find(
      (item) => item.task.id === request.id
    );
    const previousPosition = positions().find((item) => item.id === request.id);
    const position: TaskBoardLocalPosition = { ...request };
    setPositions((items) => [
      ...items.filter((item) => item.id !== request.id),
      position,
    ]);
    const placement: Placement = {
      task: movedTask(task, grouping, request),
      previousGroupKeys: taskBoardGroupKeys(task, grouping),
      grouping,
      scope,
      confirmed: false,
    };
    setPlacements((items) => [
      ...items.filter((item) => item.task.id !== request.id),
      placement,
    ]);

    setPending((ids) => new Set([...ids, request.id]));
    setError(undefined);

    try {
      await options.actions.save(request, grouping);
      setPlacements((items) =>
        items.map((item) =>
          item === placement
            ? { ...item, confirmed: true, confirmedColumns: options.columns() }
            : item
        )
      );

      return true;
    } catch {
      setPositions((items) => {
        const retained = items.filter((item) => item !== position);

        if (previousPosition && options.scope() === scope) {
          retained.push(previousPosition);
        }

        return retained;
      });
      setPlacements((items) => {
        const retained = items.filter((item) => item !== placement);

        if (previous) {
          retained.push(previous);
        }

        return retained;
      });
      setError({
        scope,
        text: 'Could not move task. Refresh or try again.',
      });
      return false;
    } finally {
      setPending((ids) => new Set([...ids].filter((id) => id !== request.id)));
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
    pending: (id: string) => pending().has(id),
    resetPositions,
    error: currentError,
  };
}
