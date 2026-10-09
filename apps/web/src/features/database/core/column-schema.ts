import type { DatabaseOpsError } from '@service-storage/databases';
import type { DataType } from '@service-storage/generated/schemas/dataType';
import type { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { match, P } from 'ts-pattern';
import type { OpColumnKind } from '../../../lib/core/database-sql/generated/types';
import type { DatabaseEntityType } from './column-inference';

/** The refusal's own words, when the service refused the batch. */
function refusalMessage(error: DatabaseOpsError): string | undefined {
  return error?.code === 'INVALID_OP'
    ? (error.refusal?.message ?? error.message)
    : undefined;
}

/** What the tabs say when a table rename was refused. */
export function tableRenameMessage(error: DatabaseOpsError): string {
  return (
    refusalMessage(error) ??
    'Could not rename this table. Its name may have changed. Check your connection, or reopen Rename table and try again.'
  );
}

/** What the tabs say when deleting a table was refused. */
export function tableDeleteMessage(error: DatabaseOpsError): string {
  return (
    refusalMessage(error) ??
    'Could not delete this table. Check your connection and try again.'
  );
}

/** What the create dialog says when the service refused a new table. */
export function tableCreateMessage(error: DatabaseOpsError): string {
  return (
    refusalMessage(error) ??
    'Could not create this table. Check your connection and try again.'
  );
}

/** What the tabs say when a new tab order was refused. */
export function tableOrderMessage(error: DatabaseOpsError): string {
  return match(error.code)
    .with(
      'NETWORK_ERROR',
      () => 'Could not move this table. Check your connection and try again.'
    )
    .otherwise(
      () => 'Could not move this table. The tables may have changed; try again.'
    );
}

/** A schema change the service applies or refuses. */
export type DatabaseSchemaChange<Value = void> = ResultAsync<
  Value,
  DatabaseOpsError
>;

/** What the grid says when the service refused a schema change. */
export function columnSchemaMessage(error: DatabaseOpsError): string {
  return match(error)
    .with(
      { code: 'INVALID_OP' },
      ({ refusal, message }) => refusal?.message ?? message
    )
    .with(
      { code: 'CONFLICT' },
      () => 'This table changed. Refresh and try again.'
    )
    .with({ code: 'FORBIDDEN' }, () => 'You can’t change this table.')
    .with(
      { code: P.union('NOT_FOUND', 'GONE') },
      () => 'This table is no longer available.'
    )
    .with(
      { code: 'NETWORK_ERROR' },
      () => 'Your change could not be sent. Check your connection.'
    )
    .otherwise(() => 'This column could not be updated. Try again.');
}

/** A type a column can become; a relation's rows live in this database. */
export type DatabaseColumnKind =
  | Exclude<OpColumnKind, { type: 'relation' }>
  | { type: 'relation'; table: string };

/** A type change the server validates against every stored value. */
export type DatabaseColumnTypeChange = {
  to: DatabaseColumnKind;
  /** The table version the type menu's dry run read. */
  baseVersion?: number;
};

/** A type some values do not fit, written to a new column beside the original instead. */
export type DatabaseColumnConversion = {
  to: DatabaseColumnKind;
  /** The type's name in the menu, e.g. `Number`, or a related table's name. */
  label: string;
  /** The original column's name, as the menu showed it. */
  columnName: string;
};

/**
 * The name of the column a conversion adds: the original's, then the type,
 * numbered from 2 while the table has it, ignoring case and spaces around.
 */
export function convertedColumnName(
  name: string,
  label: string,
  takenNames: readonly string[]
): string {
  const taken = new Set(takenNames.map((taken) => taken.trim().toLowerCase()));
  const base = `${name} (${label})`;
  let candidate = base;
  for (let suffix = 2; taken.has(candidate.trim().toLowerCase()); suffix++)
    candidate = `${base} ${suffix}`;
  return candidate;
}

/** What changing a column to one type would do to its values. */
export type DatabaseColumnCast =
  | { verdict: 'safe' }
  | {
      verdict: 'checked';
      /** Cells whose value would not convert. */
      failures: number;
      /** What is wrong with them, e.g. `3 values aren't numbers`. */
      summary: string | undefined;
      examples: string[];
    }
  | { verdict: 'never'; reason: string };

/** A type the menu offers; `relation` stands for every related table. */
type DatabaseColumnCastTarget = {
  dataType: DataType;
  isMultiSelect: boolean;
  specificEntityType?: DatabaseEntityType;
  relation: boolean;
};

/** How the dry run names a column kind. */
export function castTargetOf(
  kind: DatabaseColumnKind
): DatabaseColumnCastTarget {
  const plain = (dataType: DataType, isMultiSelect = false) => ({
    dataType,
    isMultiSelect,
    relation: false,
  });
  return match(kind)
    .returnType<DatabaseColumnCastTarget>()
    .with({ type: 'text' }, () => plain('STRING'))
    .with({ type: 'number' }, () => plain('NUMBER'))
    .with({ type: 'boolean' }, () => plain('BOOLEAN'))
    .with({ type: 'date' }, () => plain('DATE'))
    .with({ type: 'link' }, () => plain('LINK'))
    .with({ type: 'select' }, ({ multi }) => plain('SELECT_STRING', multi))
    .with({ type: 'select_number' }, ({ multi }) =>
      plain('SELECT_NUMBER', multi)
    )
    .with({ type: 'tag' }, () => plain('TAG', true))
    .with({ type: 'entity' }, ({ target, multi }) => ({
      ...plain('ENTITY', multi),
      specificEntityType: target,
    }))
    .with({ type: 'relation' }, () => ({
      dataType: 'ENTITY',
      isMultiSelect: true,
      relation: true,
    }))
    .exhaustive();
}

export type DatabaseColumnCasts =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      /** The table version the dry run read. */
      version: number;
      casts: { target: DatabaseColumnCastTarget; cast: DatabaseColumnCast }[];
    };

/** A column's dry run, read while `open` holds. */
export type DatabaseColumnCastsSource = (
  columnId: string,
  open: Accessor<boolean>
) => Accessor<DatabaseColumnCasts>;

/** The dry run's answer for one menu choice, once it has one. */
export function castFor(
  casts: DatabaseColumnCasts,
  to: DatabaseColumnKind
): DatabaseColumnCast | undefined {
  if (casts.status !== 'ready') return undefined;
  const wanted = castTargetOf(to);
  return casts.casts.find(
    ({ target }) =>
      target.relation === wanted.relation &&
      (wanted.relation ||
        (target.dataType === wanted.dataType &&
          target.isMultiSelect === wanted.isMultiSelect &&
          target.specificEntityType === wanted.specificEntityType))
  )?.cast;
}
