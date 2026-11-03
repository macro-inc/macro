import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { ResultAsync } from 'neverthrow';
import type { BoardGrouping } from './board-grouping';
import type { TimelineRange } from './timeline-range';
import type { DatabaseOpFailure } from './write-failure';

export type NewView = { name: string } & (
  | { layout: 'table' }
  | { layout: 'board'; groupBy: BoardGrouping }
  | { layout: 'timeline'; range: TimelineRange }
);

/** Whether a new view brings a column with it, which the table shows once it is read again. */
export function newViewNeedsColumn(view: NewView): boolean {
  return (
    (view.layout === 'board' && view.groupBy.kind === 'new-status') ||
    (view.layout === 'timeline' && view.range.kind === 'new-column')
  );
}

export type ViewCreation = {
  view: DatabaseView;
  needsColumn: boolean;
  save: () => ResultAsync<DatabaseView, DatabaseOpFailure>;
};
