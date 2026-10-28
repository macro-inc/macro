/** A database-wide search's answers, grouped by table, each with the text it matched. */
import type { DatabaseViewColumn } from './database-view';
import {
  type DatabaseRow,
  formatCellValue,
  rowTitle,
  rowValue,
  titleColumn,
} from './table';

/** The value a record matched in, cut down around the match. */
export type DatabaseSearchExcerpt = {
  /** Absent when the match is in the record's title. */
  columnName?: string;
  before: string;
  match: string;
  after: string;
};

export type DatabaseSearchMatch = {
  rowId: string;
  title: string;
  /** Absent when the term sits in markup the shown text leaves out. */
  excerpt?: DatabaseSearchExcerpt;
};

export type DatabaseSearchGroup = {
  tableId: string;
  tableName: string;
  matches: DatabaseSearchMatch[];
  /** Matches past the ones listed. */
  more: number;
};

/** One table's rows as its search query answered them. */
export type DatabaseSearchAnswer = {
  tableId: string;
  tableName: string;
  columns: DatabaseViewColumn[];
  rows: DatabaseRow[];
};

const MATCHES_PER_TABLE = 20;
const CONTEXT = 24;

function excerpt(
  column: DatabaseViewColumn,
  text: string,
  term: string,
  isTitle: boolean
): DatabaseSearchExcerpt | undefined {
  const start = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
  if (start < 0) return undefined;
  const end = start + term.length;
  const from = Math.max(0, start - CONTEXT);
  const to = Math.min(text.length, end + CONTEXT * 2);
  return {
    ...(isTitle ? {} : { columnName: column.name }),
    before: `${from > 0 ? '…' : ''}${text.slice(from, start)}`,
    match: text.slice(start, end),
    after: `${text.slice(end, to)}${to < text.length ? '…' : ''}`,
  };
}

/**
 * The answers as the search lists them: tables in order, those with no match
 * left out. A match shows the title column's text when the term is there,
 * else the first other column holding it.
 */
export function databaseSearchGroups(
  term: string,
  answers: readonly DatabaseSearchAnswer[]
): DatabaseSearchGroup[] {
  const text = term.trim();
  return answers.flatMap((answer) => {
    if (!answer.rows.length) return [];
    const title = titleColumn(answer.columns) ?? answer.columns[0];
    const ordered = title
      ? [title, ...answer.columns.filter((column) => column !== title)]
      : answer.columns;
    const matches = answer.rows.slice(0, MATCHES_PER_TABLE).map((row) => {
      const found = ordered
        .map((column) =>
          excerpt(
            column,
            formatCellValue(column, rowValue(row, column.id)),
            text,
            column === title
          )
        )
        .find((candidate) => candidate !== undefined);
      return {
        rowId: row.rowId,
        title: rowTitle(row, answer.columns),
        ...(found ? { excerpt: found } : {}),
      };
    });
    return [
      {
        tableId: answer.tableId,
        tableName: answer.tableName,
        matches,
        more: answer.rows.length - matches.length,
      },
    ];
  });
}
