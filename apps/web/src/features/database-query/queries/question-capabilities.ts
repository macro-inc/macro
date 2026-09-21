import type { DatabaseDetail } from '@service-storage/databases';
import type { QueryCapabilities } from '../context/query-context';
import { toQuerySchema } from './query-source';

/** Resolve model-selected sources through the same permission-checked schema read as the UI. */
export function createQuestionCapabilities(
  input: QueryCapabilities & {
    describe: (databaseId: string) => Promise<DatabaseDetail>;
  }
): QueryCapabilities {
  return {
    read: async (sql, context) => {
      const answer = await input.read(sql);
      const databaseIds = answer.read_database_ids;
      if (!databaseIds) return answer;
      if (
        context?.databaseId &&
        databaseIds.some((id) => id !== context.databaseId)
      )
        throw new Error(
          'This query reads another database. Choose Automatic or change the source, then ask again.'
        );
      const databaseId = databaseIds.includes(context?.source?.databaseId ?? '')
        ? context?.source?.databaseId
        : databaseIds.toSorted()[0];
      if (!databaseId)
        return {
          ...answer,
          source: context?.databaseId
            ? context.source
            : { name: 'Automatic', tables: [] },
        };
      const knownSource = context?.source;
      const source =
        knownSource?.databaseId === databaseId &&
        (databaseIds.length > 1 ||
          answer.read_tables.every((id) =>
            knownSource.tables.some((table) => table.id === id)
          ))
          ? knownSource
          : toQuerySchema(await input.describe(databaseId));
      if (
        source.databaseId !== databaseId ||
        (databaseIds.length === 1 &&
          answer.read_tables.some(
            (id) => !source.tables.some((table) => table.id === id)
          ))
      )
        throw new Error(
          'The answer’s source tables could not be verified. Try again.'
        );
      return { ...answer, source };
    },
    generate: async (request) => {
      const proposal = await input.generate(request);
      const databaseId = proposal.databaseId ?? request.schema.databaseId;
      if (!databaseId) return proposal;
      if (request.schema.databaseId && databaseId !== request.schema.databaseId)
        throw new Error(
          'This answer needs a different database. Choose Automatic or change the source, then ask again.'
        );
      const detail = await input.describe(databaseId);
      if (detail.database.id !== databaseId)
        throw new Error(
          'The answer’s database could not be verified. Try again.'
        );
      return {
        ...proposal,
        source: toQuerySchema(detail, request.schema.focusTableId),
      };
    },
  };
}
