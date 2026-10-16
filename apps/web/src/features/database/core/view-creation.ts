import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { ResultAsync } from 'neverthrow';
import type { BoardGrouping } from './board-grouping';
import type { DatabaseOpFailure } from './write-failure';

export type NewView = { name: string } & (
  | { layout: 'table' }
  | { layout: 'board'; groupBy: BoardGrouping }
);

export type ViewCreation = {
  view: DatabaseView;
  needsColumn: boolean;
  save: () => ResultAsync<DatabaseView, DatabaseOpFailure>;
};
