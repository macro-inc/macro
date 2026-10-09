import type { TaskBoardColumn } from './task-board';

/** Only reveal a loaded destination membership, never a guessed partial-page position. */
export function taskBoardRevealIndices(
  columns: readonly TaskBoardColumn[],
  columnId: string,
  taskId: string
): { column: number; row: number } | undefined {
  const column = columns.findIndex((item) => item.id === columnId);
  if (column < 0) return undefined;
  const row = columns[column].tasks.findIndex((task) => task.id === taskId);
  return row < 0 ? undefined : { column, row };
}
