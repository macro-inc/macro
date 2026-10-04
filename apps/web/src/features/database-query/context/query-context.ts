import type { ResultAsync } from 'neverthrow';
import type {
  QueryAnswer,
  QueryDefinition,
  QueryFailure,
  QueryProposal,
  QuerySchema,
} from '../core/query';

export type QueryCapabilities = {
  generate(input: {
    prompt: string;
    sql: string;
    schema: QuerySchema;
  }): ResultAsync<QueryProposal, QueryFailure>;
  read(
    sql: string,
    context?: {
      /** An explicit document source limits user-table dependencies to this database. */
      databaseId?: string;
      /** Last verified source, reused when the actual query reads this database. */
      source?: QuerySchema;
    }
  ): ResultAsync<QueryAnswer, QueryFailure>;
};

export type QueryComposerOptions = QueryCapabilities & {
  initial: QueryDefinition;
  schema: () => QuerySchema;
  /** Failures quote the engine's own words only where SQL is shown. */
  showSql: boolean;
};
