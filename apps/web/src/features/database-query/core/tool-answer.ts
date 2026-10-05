import type { AnswerColumn } from '@core/database-sql/answer';
import type {
  QueryDatabaseResponse,
  ResultColumn,
} from '@service-cognition/generated/tools/types';
import type { QueryAnswer } from './query';

function toolColumn(column: ResultColumn): AnswerColumn {
  const options = column.options ?? [];
  const target = column.target ?? null;
  const relatedTable = column.relatedTable ?? null;
  if (!options.length && !target && !relatedTable)
    return { name: column.name, kind: column.kind };
  return {
    name: column.name,
    kind: column.kind,
    source: {
      markdown: false,
      options: options.map((option) => ({ ...option, color: null })),
      tag: false,
      target,
      relatedTable,
    },
  };
}

/** A QueryDatabase tool result as answers: the engine's typed cells, as the tool sends them. */
export function toolAnswers(response: QueryDatabaseResponse): QueryAnswer[] {
  const readTables = response.readVersions.map((table) => table.tableId);
  return response.results.map((result) => ({
    columns: result.columns.map(toolColumn),
    rows: result.rows,
    rowIds: result.rowIds,
    readTables,
    readDatabaseIds: [],
    truncatedTables: response.truncatedTables ?? [],
  }));
}
