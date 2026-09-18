import type { QueryAnswer, QueryDefinition, QueryProposal, QuerySchema } from '../core/query';

export type QueryCapabilities = {
  generate(input: { prompt: string; sql: string; schema: QuerySchema }): Promise<QueryProposal>;
  read(sql: string): Promise<QueryAnswer>;
};

export type QueryComposerOptions = QueryCapabilities & {
  initial: QueryDefinition;
  schema: () => QuerySchema;
};
