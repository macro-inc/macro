import type {
  QueryAnswer,
  QueryDefinition,
  QueryProposal,
  QuerySchema,
} from '../core/query';

export type QueryCapabilities = {
  /** Keep mutation requests stable until their execution outcome is known. */
  generationCanWrite?: boolean;
  generate(input: {
    prompt: string;
    sql: string;
    schema: QuerySchema;
  }): Promise<QueryProposal>;
  read(
    sql: string,
    context?: {
      /** An explicit document source limits user-table dependencies to this database. */
      databaseId?: string;
      /** Last verified source, reused when the actual query reads this database. */
      source?: QuerySchema;
    }
  ): Promise<QueryAnswer>;
};

export type QueryComposerOptions = QueryCapabilities & {
  initial: QueryDefinition;
  schema: () => QuerySchema;
};
