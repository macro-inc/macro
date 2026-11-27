import { match } from 'ts-pattern';

export type DriveViewMode = 'list' | 'grid' | 'columns';

export type DriveRootBrowseMode = 'browse' | 'all';

export type DriveSortDirection = 'asc' | 'desc';

export type GridMoveDirection =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'home'
  | 'end';

export function parseDriveViewMode(value: unknown): DriveViewMode {
  if (value === 'grid' || value === 'columns') return value;
  return 'list';
}

export function parseDriveRootBrowseMode(value: unknown): DriveRootBrowseMode {
  if (value === 'all') return 'all';
  return 'browse';
}

/**
 * Computes the next focused index for 2D keyboard navigation in a responsive
 * grid layout. Clamps cleanly at the grid edges without wrapping unexpectedly.
 */
export function gridNextIndex(
  currentIndex: number,
  total: number,
  columns: number,
  direction: GridMoveDirection
): number {
  if (total <= 0) return -1;
  const cols = Math.max(1, Math.floor(columns));
  const clamped = currentIndex < 0 ? 0 : Math.min(currentIndex, total - 1);

  return match(direction)
    .with('home', () => 0)
    .with('end', () => total - 1)
    .with('left', () => (currentIndex < 0 ? 0 : Math.max(0, clamped - 1)))
    .with('right', () =>
      currentIndex < 0 ? 0 : Math.min(total - 1, clamped + 1)
    )
    .with('up', () => {
      if (currentIndex < 0) return 0;
      return clamped - cols >= 0 ? clamped - cols : clamped;
    })
    .with('down', () => {
      if (currentIndex < 0) return 0;
      const target = clamped + cols;
      if (target < total) return target;
      const currentRow = Math.floor(clamped / cols);
      const lastRow = Math.floor((total - 1) / cols);
      return currentRow < lastRow ? total - 1 : clamped;
    })
    .exhaustive();
}
