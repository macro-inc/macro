import type { TModel } from '@core/component/AI/constant';
import type { ResultError } from '@core/util/result';
import { err, ok, type Result, ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import { cognitionApiServiceClient } from './client';
import {
  type DatabaseQuestionInput,
  databaseCompletionRequest,
} from './database-query-prompt';

export type DatabaseGenerationFailure =
  | { kind: 'service'; errors: ResultError[] }
  /** The model stopped before answering, in the service's words. */
  | { kind: 'interrupted'; reason: string };

/** A document question's structured answer, from read-only discovery tools. */
export function generateDatabaseQuery(
  input: DatabaseQuestionInput,
  model: TModel
): ResultAsync<unknown, DatabaseGenerationFailure> {
  return new ResultAsync(
    cognitionApiServiceClient.structuredCompletion({
      model,
      ...databaseCompletionRequest(input),
    })
  )
    .mapErr(
      (errors): DatabaseGenerationFailure => ({ kind: 'service', errors })
    )
    .andThen((response) =>
      match(response.outcome)
        .returnType<Result<unknown, DatabaseGenerationFailure>>()
        .with({ status: 'completed' }, ({ result }) => ok(result))
        .with({ status: 'interrupted' }, ({ reason }) =>
          err({ kind: 'interrupted', reason })
        )
        .exhaustive()
    );
}
