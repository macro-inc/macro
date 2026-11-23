import type { DatabaseSqlFailure } from '@core/database-sql/driver';
import type {
  Cell,
  Outcome,
  ReadDescription,
  Row,
} from '@core/database-sql/generated/types';
import { createReplaceableReader } from '@core/util/create-replaceable-reader';
import type { CacheHost } from '@graphql-cache/host/types';
import type { PeopleSqlRequest } from '@graphql-cache/people/generated';
import { isStaleHydrationScopeError } from '@graphql-cache/protocol';
import type { QueryAccount } from '@queries/auth/account-scope';
import { loadContactCheckpoint } from '@queries/contacts/backfill';
import {
  assertContactCacheScope,
  ContactDirectoryScopeError,
  readContactCacheScope,
} from '@queries/contacts/cache-scope';
import { err, ok, ResultAsync } from 'neverthrow';

export type LocalPeopleSqlHost = Pick<
  CacheHost,
  | 'people'
  | 'disabled'
  | 'currentStorageGeneration'
  | 'readQuery'
  | 'onCacheGenerationChanged'
>;
export type LocalSqlInput = {
  account: QueryAccount;
  host: LocalPeopleSqlHost | undefined;
  input: PeopleSqlRequest['input'];
  description?: ReadDescription;
};

export type LocalSqlFailure = Extract<
  DatabaseSqlFailure,
  { kind: 'rejected' | 'scope-changed' }
>;
function refused(message: string): never {
  throw new Error(message);
}
function failure(error: unknown): LocalSqlFailure {
  if (
    error instanceof ContactDirectoryScopeError ||
    isStaleHydrationScopeError(error)
  )
    return {
      kind: 'scope-changed',
      message: 'Contact cache scope changed; reopen the query',
    };
  return {
    kind: 'rejected',
    message: error instanceof Error ? error.message : 'Local people SQL failed',
  };
}

/** Synchronization supplies records; execution never uses a network query endpoint. */
export async function readLocalSql(
  request: LocalSqlInput,
  signal: AbortSignal
): Promise<Outcome> {
  signal.throwIfAborted();
  const { host, account, input, description } = request;
  if (!host?.people || host.disabled)
    refused('Local people SQL is unavailable on this client');
  const generation = await readContactCacheScope(host, account.userId, signal);
  if (!generation) throw new ContactDirectoryScopeError();
  // Sample completeness before starting the read: a later page cannot make an
  // earlier aggregate or negative lookup complete retroactively.
  const checkpoint = loadContactCheckpoint(account.userId, generation);
  if (checkpoint.completedAt === null)
    refused(
      'Contacts are still synchronizing; retry when synchronization completes'
    );
  const result = await host.people.readSql({
    scope: { identity: account.userId, storageGeneration: generation },
    input,
  });
  await assertContactCacheScope(host, account.userId, generation, signal);
  if (loadContactCheckpoint(account.userId, generation).completedAt === null)
    refused('Contact synchronization changed; retry the query');
  if (result.kind === 'unsupported')
    refused('Local people SQL is unavailable on this client');
  if (result.kind === 'incomplete')
    refused('Cached contacts are incomplete; retry after synchronization');
  if (result.kind === 'resultTooLarge')
    refused(
      'The SQL result is too large; select fewer columns or use a smaller LIMIT'
    );
  const outcome = result.outcome;
  if (description) {
    const sameColumns =
      outcome.columns.length === description.columns.length &&
      outcome.columns.every((column, index) => {
        const expected = description.columns[index];
        return (
          column.name === expected.name &&
          column.kind === expected.kind &&
          (column.column ?? undefined) === (expected.column ?? undefined) &&
          (column.table ?? undefined) === (expected.table ?? undefined)
        );
      });
    if (
      !sameColumns ||
      outcome.readTables.length !== description.readTables.length ||
      outcome.readTables.some(
        (table) => !description.readTables.includes(table)
      )
    )
      refused('Database schema changed; refresh and retry the read');
  }
  signal.throwIfAborted();
  return outcome;
}

/** One physical native operation and one replaceable pending query per observer. */
export function createLocalSqlReader(read: typeof readLocalSql = readLocalSql) {
  const queue = createReplaceableReader(read);
  return {
    read: (input: LocalSqlInput, signal: AbortSignal) =>
      ResultAsync.fromPromise(queue.read(input, signal), failure),
    dispose: queue.dispose,
  };
}
export type LocalSqlReader = ReturnType<typeof createLocalSqlReader>;

/** Only the current bounded key set may enter the ordinary join fold. */
export function localPeopleRows(outcome: Outcome) {
  if (
    outcome.truncated ||
    outcome.rowIds.length !== outcome.rows.length ||
    outcome.columns.some((column) => !column.column)
  )
    return err<Row[], LocalSqlFailure>({
      kind: 'rejected',
      message: 'Invalid bounded people lookup',
    });
  const rows: Row[] = outcome.rows.map((values, index) => {
    const cells: Record<string, Cell> = {};
    outcome.columns.forEach((column, index) => {
      const cell = values[index];
      if (column.column && cell) cells[column.column] = cell;
    });
    return { id: outcome.rowIds[index], cells };
  });
  return ok<Row[], LocalSqlFailure>(rows);
}
