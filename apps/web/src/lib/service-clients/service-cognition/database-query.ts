import { DEFAULT_MODEL } from '@core/component/AI/constant';
import {
  parseQueryProposal,
  QueryActionError,
  QueryOutcomeUnknownError,
} from '../../../features/database-query/core/query';
import { cognitionApiServiceClient } from './client';
import {
  type DatabaseAssistantInput,
  databaseCompletionRequest,
} from './database-query-prompt';
import { summarizeDatabaseActivity } from './database-tool-activity';

/** Live document questions discover accessible sources using strictly read-only tools. */
export async function generateDatabaseQuery(input: DatabaseAssistantInput) {
  const result = await cognitionApiServiceClient.structuredCompletion({
    model: DEFAULT_MODEL,
    ...databaseCompletionRequest(input, 'question'),
  });
  if (result.isErr())
    throw new Error(
      result.error[0]?.message ?? 'AI could not answer. Please try again.'
    );
  return parseQueryProposal(result.value.result);
}

/** The editing surface has scoped database tools and server-authored execution receipts. */
export async function runDatabaseAssistant(input: DatabaseAssistantInput) {
  const result = await cognitionApiServiceClient.structuredCompletion({
    model: DEFAULT_MODEL,
    ...databaseCompletionRequest(input, 'assistant'),
  });
  if (result.isErr()) {
    const failure = result.error[0];
    if (
      failure &&
      ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'GONE', 'CONFLICT'].includes(
        failure.code
      )
    )
      throw new Error(failure.message);
    throw new QueryOutcomeUnknownError(
      'The assistant’s final response was not received. Some changes may have been saved. Check the table before making another request.'
    );
  }
  const actionSummary = summarizeDatabaseActivity(
    result.value.toolActivity ?? []
  );
  try {
    const proposal = parseQueryProposal(result.value.result);
    return { ...proposal, ...(actionSummary ? { actionSummary } : {}) };
  } catch (error) {
    if (actionSummary)
      throw new QueryActionError(
        actionSummary,
        error instanceof Error ? error.message : String(error)
      );
    throw error;
  }
}
