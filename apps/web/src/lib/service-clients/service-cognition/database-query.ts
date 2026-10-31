import type { TModel } from '@core/component/AI/constant';
import type { ResultError } from '@core/util/result';
import { ResultAsync } from 'neverthrow';
import { cognitionApiServiceClient } from './client';
import type { DatabaseQuestionInput } from './database-query-prompt';

export type DatabaseGenerationFailure = {
  kind: 'service';
  errors: ResultError[];
};

/** The database endpoint owns discovery, SQL guidance, and the chart response contract. */
export function generateDatabaseQuery(
  input: DatabaseQuestionInput,
  model: TModel
): ResultAsync<unknown, DatabaseGenerationFailure> {
  return new ResultAsync(
    cognitionApiServiceClient.databaseQuery({ model, ...input })
  ).mapErr(
    (errors): DatabaseGenerationFailure => ({ kind: 'service', errors })
  );
}
