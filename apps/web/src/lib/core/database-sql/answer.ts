/** The engine's outcome as an answer: typed cells, and what renders each result column. */

import type { ColumnDetail } from '@service-storage/generated/schemas/columnDetail';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type {
  Catalog,
  Cell,
  Column,
  EntityKind,
  Outcome,
  OutcomeKind,
} from './generated/types';

/** A select option as an answer shows it. */
export type AnswerOption = { id: string; label: string; color: string | null };

/** The table column a result column's values were read from. */
export type AnswerSource = {
  /** A table's text property holds markdown. */
  markdown: boolean;
  /** The column's options, for a select column. */
  options: AnswerOption[];
  /** Tags always show their colour. */
  tag: boolean;
  /** What entity ids point at; rows of another table for a relation. */
  target: EntityKind | null;
  /** The table a relation's rows belong to, or a `row_id`'s rows. */
  relatedTable: string | null;
};

export type AnswerColumn = {
  name: string;
  kind: OutcomeKind;
  source?: AnswerSource;
};

export type DatabaseSqlAnswer = {
  columns: AnswerColumn[];
  rows: (Cell | null)[][];
  /** For a row-shaped result, the row behind each result row. */
  rowIds: string[];
  /** The tables read, so a caller can watch them for changes. */
  readTables: string[];
  /** The databases those tables belong to. */
  readDatabaseIds: string[];
  /** The tables read, by name, when the read hit the row cap. */
  truncatedTables: string[];
};

function answerSource(
  column: Column,
  detail: ColumnDetail | undefined
): AnswerSource {
  const kind = column.kind;
  const colors = new Map(
    (detail?.definition.property_options ?? []).map((option) => [
      option.id,
      option.color,
    ])
  );
  const link =
    detail?.column.config?.kind === 'link' ? detail.column.config : undefined;
  return {
    markdown:
      kind.kind === 'text' &&
      detail?.definition.definition.data_type === 'STRING',
    options:
      kind.kind === 'select'
        ? kind.options.map((option) => ({
            id: option.id,
            label: option.label,
            color: colors.get(option.id) ?? null,
          }))
        : [],
    tag: detail?.definition.definition.data_type === 'TAG',
    target: kind.kind === 'entity' ? kind.target : null,
    relatedTable: link ? link.table_id : null,
  };
}

/** A `row_id` column reads rows of its own table. */
function rowSource(table: string): AnswerSource {
  return {
    markdown: false,
    options: [],
    tag: false,
    target: null,
    relatedTable: table,
  };
}

export function databaseSqlAnswer(
  outcome: Outcome,
  catalog: Catalog,
  databases: readonly DatabaseDetail[]
): DatabaseSqlAnswer {
  const tables = new Map(
    databases.flatMap((database) =>
      database.tables.map((table) => [table.table.id, table] as const)
    )
  );
  const source = (definition: string) => {
    for (const table of catalog.tables) {
      const column = table.columns.find(
        (candidate) => candidate.id === definition
      );
      if (column)
        return answerSource(
          column,
          tables
            .get(table.id)
            ?.columns.find(
              (candidate) => candidate.definition.definition.id === definition
            )
        );
    }
  };
  const read = outcome.readTables.flatMap((id) => {
    const table = tables.get(id);
    return table ? [table] : [];
  });
  return {
    columns: outcome.columns.map((column) => {
      const found = column.table
        ? rowSource(column.table)
        : column.column
          ? source(column.column)
          : undefined;
      return {
        name: column.name,
        kind: column.kind,
        ...(found ? { source: found } : {}),
      };
    }),
    rows: outcome.rows,
    rowIds: outcome.rowIds,
    readTables: outcome.readTables,
    readDatabaseIds: [...new Set(read.map((table) => table.table.database_id))],
    truncatedTables: outcome.truncated
      ? read.map((table) => table.table.name)
      : [],
  };
}
