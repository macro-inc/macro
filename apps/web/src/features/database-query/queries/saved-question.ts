import type { ResultAsync } from 'neverthrow';
import type {
  QueryDefinition,
  QueryFailure,
  SavedQuestion,
} from '../core/query';

export type SaveQuestionSql = (input: {
  sql: string;
  databaseId?: string;
}) => ResultAsync<string, QueryFailure>;

/** Save a new question's SQL as a query and keep only its id with the presentation. */
export function saveQuestion(input: {
  definition: QueryDefinition;
  save: SaveQuestionSql;
}): ResultAsync<SavedQuestion, QueryFailure> {
  const { sql, ...presentation } = input.definition;
  return input
    .save({
      sql,
      ...(input.definition.databaseId
        ? { databaseId: input.definition.databaseId }
        : {}),
    })
    .map((queryId) => ({ ...presentation, queryId }));
}
