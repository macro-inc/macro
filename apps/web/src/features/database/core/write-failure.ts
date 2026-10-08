import type {
  DatabaseOpsError,
  DatabaseSchemaErrorCode,
} from '@service-storage/databases';
import type { GraphqlEntityMutationErrorCode } from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';
import type { DatabaseSqlFailure } from '../../../lib/core/database-sql/driver';
import type { ResultError } from '../../../lib/core/util/result';

/** A grid value the column it is written to cannot take. */
export type DatabaseCellFailure =
  | { kind: 'read-only-column' }
  | { kind: 'not-a-number' }
  /** A relation's cells are rows, edited as a relation. */
  | { kind: 'relation-as-entity' }
  /** A multi-valued cell that is not the grid's JSON array of values. */
  | { kind: 'malformed-list' }
  /** An entity column that names no kind of entity, so a bare id cannot be written to it. */
  | { kind: 'untyped-entity' }
  /** The cell holds an option its column's catalog lacks. */
  | { kind: 'unavailable-option' };

/** Why a grid write did not land, or may not have. */
export type DatabaseWriteFailure =
  | DatabaseCellFailure
  /** A new column's first value needs a fresh read of the table. */
  | { kind: 'needs-refresh' }
  /** A mention was picked for a column of another type. */
  | { kind: 'type-mismatch' }
  /** Settling a new column's type from its first value was refused. */
  | { kind: 'type-refused'; errors: ResultError<DatabaseSchemaErrorCode>[] }
  /** The service refused the write, or never answered it. */
  | { kind: 'ops'; error: DatabaseOpsError }
  /** A new row may have been saved before its answer was lost. */
  | { kind: 'outcome-unknown' }
  /** The table is no longer in its database. */
  | { kind: 'table-unavailable' }
  /** The table's schema could not be read again. */
  | { kind: 'schema-unreachable' }
  /** The service answered the write with something other than rows. */
  | { kind: 'unexpected-result' };

/** Why an option or view op did not land. */
export type DatabaseOpFailure =
  | { kind: 'ops'; error: DatabaseOpsError }
  | { kind: 'unexpected-result' }
  /** A number option relabelled with something that is not a number. */
  | { kind: 'not-a-number' }
  /** A colour the palette has no swatch for. */
  | { kind: 'unknown-color' };

/** What an option, view or card change that did not land says, for `subject` ("this option"). */
export function databaseOpMessage(
  failure: DatabaseOpFailure,
  subject: string
): string {
  return match(failure)
    .returnType<string>()
    .with({ kind: 'ops' }, ({ error }) =>
      match(error.code)
        .with('INVALID_OP', () => error.refusal?.message ?? error.message)
        .with('FORBIDDEN', () => `You can’t change ${subject}.`)
        .with(
          'NOT_FOUND',
          'GONE',
          () => `${capitalized(subject)} is no longer available.`
        )
        .with(
          'NETWORK_ERROR',
          () => 'Your change could not be sent. Check your connection.'
        )
        .otherwise(() => `Could not change ${subject}. Try again.`)
    )
    .with(
      { kind: 'unexpected-result' },
      () => 'The database answered the change with something else.'
    )
    .with(
      { kind: 'not-a-number' },
      () => `${capitalized(subject)} needs a number for its label.`
    )
    .with(
      { kind: 'unknown-color' },
      () => `${capitalized(subject)} cannot take that colour.`
    )
    .exhaustive();
}

function capitalized(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** Why the table's rows could not be read again. */
export type DatabaseReadFailure =
  | DatabaseSqlFailure
  | { kind: 'table-unavailable' };

/** What the grid says about a write that did not land. */
export function databaseWriteMessage(failure: DatabaseWriteFailure): string {
  return match(failure)
    .returnType<string>()
    .with({ kind: 'read-only-column' }, () => 'This property is read-only.')
    .with(
      { kind: 'not-a-number' },
      () =>
        'This column expects a number. Your entry is kept so you can correct it.'
    )
    .with(
      { kind: 'relation-as-entity' },
      () => 'This column holds related records; edit it as a relation.'
    )
    .with(
      { kind: 'malformed-list' },
      () => 'This value could not be read. Refresh and try again.'
    )
    .with(
      { kind: 'untyped-entity' },
      () =>
        'This column does not say what it links to. Choose a mention instead.'
    )
    .with(
      { kind: 'unavailable-option' },
      () =>
        'This cell has an option that is no longer available. Refresh and try again.'
    )
    .with(
      { kind: 'needs-refresh' },
      () => 'Refresh this table before entering its first value.'
    )
    .with(
      { kind: 'type-mismatch' },
      () =>
        'This column has a different type. Choose a matching mention or add a new column.'
    )
    .with({ kind: 'type-refused' }, ({ errors }) =>
      match(errors[0])
        .with({ code: 'INVALID_SCHEMA' }, ({ message }) => message)
        .otherwise(() => 'Could not set the column type. Your entry is kept.')
    )
    .with({ kind: 'ops' }, ({ error }) =>
      match(error.code)
        .with('INVALID_OP', () => error.message)
        .with('FORBIDDEN', () => 'You can’t edit this table.')
        .with('CONFLICT', () => 'This table changed. Refresh and try again.')
        .with('NOT_FOUND', 'GONE', () => 'This table is no longer available.')
        .with(
          'NETWORK_ERROR',
          () => 'Your change could not be sent. Check your connection.'
        )
        .otherwise(() => 'The database could not apply that change.')
    )
    .with(
      { kind: 'outcome-unknown' },
      () =>
        'This row may already be saved. Check the latest rows before creating it again. Your draft is kept here.'
    )
    .with(
      { kind: 'table-unavailable' },
      () => 'This table is no longer available.'
    )
    .with(
      { kind: 'schema-unreachable' },
      () =>
        'This table could not be read again. Check your connection; your entry is kept.'
    )
    .with(
      { kind: 'unexpected-result' },
      () => 'The database answered the edit with something else.'
    )
    .exhaustive();
}

/** What the grid says about rows it could not read. */
export function databaseReadMessage(failure: DatabaseReadFailure): string {
  return match(failure)
    .returnType<string>()
    .with({ kind: 'engine' }, { kind: 'crash' }, ({ message }) => message)
    .with(
      { kind: 'fetch' },
      () => 'The rows could not be loaded. Check your connection.'
    )
    .with(
      { kind: 'read-only' },
      { kind: 'cancelled' },
      () => 'Try refreshing the table.'
    )
    .with(
      { kind: 'table-unavailable' },
      () => 'This table is no longer available.'
    )
    .exhaustive();
}

/** Why renaming or deleting a database did not land. */
export type DatabaseEntityFailure =
  | { kind: 'empty-name' }
  /** The service refused, in its own words. */
  | {
      kind: 'refused';
      errorCode: GraphqlEntityMutationErrorCode;
      message: string;
    }
  | { kind: 'unreachable' };

export function databaseEntityMessage(
  failure: DatabaseEntityFailure,
  action: 'rename' | 'delete'
): string {
  return match(failure)
    .returnType<string>()
    .with({ kind: 'empty-name' }, () => 'Give your database a name.')
    .with(
      { kind: 'refused', errorCode: 'FORBIDDEN' },
      () => `You can’t ${action} this database.`
    )
    .with(
      { kind: 'refused', errorCode: 'NOT_FOUND' },
      () => 'This database is no longer available.'
    )
    .with({ kind: 'refused' }, ({ message }) => message)
    .with({ kind: 'unreachable' }, () =>
      match(action)
        .with('rename', () => 'Could not rename this database.')
        .with('delete', () => 'Could not delete this database. Try again.')
        .exhaustive()
    )
    .exhaustive();
}
